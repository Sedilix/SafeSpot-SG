import Toybox.Application;
import Toybox.Attention;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Position;
import Toybox.Sensor;
import Toybox.System;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

enum {
    MODE_IDLE,
    MODE_COUNTDOWN,
    MODE_SOS
}

// Owns sensor state, the SOS state machine, and the link to the SafeSpot server.
// A single 1 Hz timer drives the countdown, retries, heartbeats, and the
// heart-rate check. All alert sources (button, fall, heart rate) share one
// path: countdown -> send `alertEvent` -> retry until acknowledged.
class SafeSpotModel {

    var mode as Number = MODE_IDLE;
    var countdown as Number = 0;
    // What the current countdown / SOS will send: SOS_TRIGGER, FALL_DETECTED or HR_ALERT.
    var alertEvent as String = "SOS_TRIGGER";
    var sosAcked as Boolean = false;
    var cancelPending as Boolean = false;
    var checkInPending as Boolean = false;
    // "I'm OK" answered locally but not yet acknowledged by the server.
    var checkInOkPending as Boolean = false;

    var heartRate as Number? = null;
    var lat as Double? = null;
    var lng as Double? = null;
    var gpsAccuracy as Number = Position.QUALITY_NOT_AVAILABLE;
    var landmark as String? = null;
    var lastResponseCode as Number? = null;

    private var _timer as Timer.Timer;
    private var _ticks as Number = 0;
    private var _lastFixTime as Number? = null;
    // At most one request in flight: the phone proxy queue is tiny, and it
    // keeps SOS_TRIGGER / SOS_CANCEL ordered on the server. A request with no
    // callback after REQUEST_TIMEOUT_SECONDS is abandoned, so a lost callback
    // can't block every later send (including SOS).
    private var _inFlightType as String? = null;
    private var _inFlightSinceTick as Number = 0;
    private var _deviceId as String;

    private var _fall as FallDetector;
    private var _hrAbnormalSeconds as Number = 0;

    // Battery: GPS is duty-cycled when nothing is happening (see manageGps),
    // and the last fix is persisted at most once a minute instead of on every
    // 1 Hz update. The screen still redraws every second so heart rate stays live.
    private var _gpsOn as Boolean = false;
    private var _gpsOnSinceTick as Number = 0;
    private var _gpsNextTick as Number = 0;
    private var _gotGoodFix as Boolean = false;
    private var _lastPersistTick as Number = -1000;
    private var _hrQuietUntilTick as Number = 0;

    function initialize() {
        _deviceId = DeviceId.getOrCreate();
        _timer = new Timer.Timer();
        _fall = new FallDetector(Config.ACCEL_SAMPLE_RATE);
    }

    function start() as Void {
        setGps(true); // get a first fix straight away
        Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
        Sensor.enableSensorEvents(method(:onSensor));
        Sensor.registerSensorDataListener(method(:onAccel), {
            :period => 1,
            :accelerometer => {
                :enabled => true,
                :sampleRate => Config.ACCEL_SAMPLE_RATE
            }
        });
        _timer.start(method(:onTick), 1000, true);
        send("HEARTBEAT");
    }

    function stop() as Void {
        _timer.stop();
        setGps(false);
        Sensor.enableSensorEvents(null);
        Sensor.unregisterSensorDataListener();
    }

    // ── Button actions ───────────────────────────────────────────────────────

    // START: idle -> countdown; countdown -> send immediately; SOS -> resend.
    // START is *only* ever SOS, even during a caregiver check-in, so a senior in
    // distress can never reassure the caregiver by reflex.
    function onStartPressed() as Void {
        if (mode == MODE_IDLE) {
            startAlert("SOS_TRIGGER", Config.COUNTDOWN_SECONDS);
        } else if (mode == MODE_COUNTDOWN) {
            fireSos();
        } else {
            send(alertEvent);
        }
        WatchUi.requestUpdate();
    }

    // UP/DOWN while a caregiver check-in is pending: answer "I'm OK".
    function confirmCheckIn() as Boolean {
        if (!checkInPending || mode != MODE_IDLE) {
            return false;
        }
        checkInPending = false;
        checkInOkPending = true;
        buzz(200);
        send("CHECK_IN_OK");
        WatchUi.requestUpdate();
        return true;
    }

    // Only a transition into "pending" buzzes; repeated heartbeats must not nag.
    function noteCheckInRequested() as Void {
        if (!checkInPending && !checkInOkPending) {
            checkInPending = true;
            buzz(400);
        }
    }

    function cancelCountdown() as Void {
        mode = MODE_IDLE;
        if ("HR_ALERT".equals(alertEvent)) {
            _hrQuietUntilTick = _ticks + Config.HR_ALERT_COOLDOWN_SECONDS;
        }
        _hrAbnormalSeconds = 0;
        buzz(100);
        WatchUi.requestUpdate();
    }

    // "I'm OK" after an SOS went out: tell the caregiver dashboard to stand down.
    function cancelSos() as Void {
        mode = MODE_IDLE;
        sosAcked = false;
        cancelPending = true;
        _hrAbnormalSeconds = 0;
        _hrQuietUntilTick = _ticks + Config.HR_ALERT_COOLDOWN_SECONDS;
        send("SOS_CANCEL");
        WatchUi.requestUpdate();
    }

    // ── Timer / sensors ──────────────────────────────────────────────────────

    function onTick() as Void {
        _ticks++;
        if (mode == MODE_COUNTDOWN) {
            countdown--;
            if (countdown <= 0) {
                fireSos();
            } else {
                buzz(countdown <= 3 ? 400 : 150);
            }
        } else if (mode == MODE_SOS && !sosAcked) {
            if (_ticks % Config.SOS_RETRY_SECONDS == 0) {
                send(alertEvent);
            }
        } else if (cancelPending) {
            if (_ticks % Config.SOS_RETRY_SECONDS == 0) {
                send("SOS_CANCEL");
            }
        } else if (checkInOkPending) {
            if (_ticks % Config.SOS_RETRY_SECONDS == 0) {
                send("CHECK_IN_OK");
            }
        } else if (_ticks % (mode == MODE_SOS ? Config.SOS_UPDATE_SECONDS : Config.HEARTBEAT_SECONDS) == 0) {
            send("HEARTBEAT");
        }
        if (mode == MODE_IDLE) {
            checkHeartRate();
        }
        manageGps();
        WatchUi.requestUpdate(); // keeps the heart rate live
    }

    // Continuous GPS while anything time-critical is happening; otherwise a
    // fresh fix every GPS_FIX_PERIOD_SECONDS: on until one good fix (or
    // GPS_FIX_TIMEOUT_SECONDS of trying), then off until the next period.
    // GPS is the largest drain on the watch.
    private function manageGps() as Void {
        var urgent = mode != MODE_IDLE || checkInPending || checkInOkPending || cancelPending;
        if (urgent) {
            if (!_gpsOn) {
                setGps(true);
            }
            _gpsNextTick = _ticks; // resume duty-cycling from now once it's over
        } else if (_gpsOn) {
            if (_gotGoodFix || _ticks - _gpsOnSinceTick >= Config.GPS_FIX_TIMEOUT_SECONDS) {
                setGps(false);
                // Period measured from when this fix started, with a short
                // minimum rest so a slow fix indoors doesn't leave GPS on.
                var next = _gpsOnSinceTick + Config.GPS_FIX_PERIOD_SECONDS;
                _gpsNextTick = next > _ticks + Config.GPS_MIN_OFF_SECONDS ? next : _ticks + Config.GPS_MIN_OFF_SECONDS;
            }
        } else if (_ticks >= _gpsNextTick) {
            setGps(true);
        }
    }

    private function setGps(on as Boolean) as Void {
        if (on == _gpsOn) {
            return;
        }
        _gpsOn = on;
        if (on) {
            _gpsOnSinceTick = _ticks;
            _gotGoodFix = false;
            Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
        } else {
            Position.enableLocationEvents(Position.LOCATION_DISABLE, null);
        }
    }


    function onAccel(data as Sensor.SensorData) as Void {
        var accel = data.accelerometerData;
        if (accel == null) {
            return;
        }
        // Always feed the detector so `moving` stays current for the HR check.
        if (_fall.addSamples(accel.x, accel.y, accel.z) && mode == MODE_IDLE && !cancelPending) {
            startAlert("FALL_DETECTED", Config.ALERT_COUNTDOWN_SECONDS);
            WatchUi.requestUpdate();
        }
    }

    // Very low HR at any time, or very high HR while not moving, sustained
    // for HR_ALERT_SECONDS. Exercise raises HR legitimately, so a high reading
    // only counts during seconds the accelerometer says the wearer is still.
    private function checkHeartRate() as Void {
        var hr = heartRate;
        var abnormal = hr != null && hr > 0
            && (hr < Config.HR_LOW_BPM || (hr > Config.HR_HIGH_BPM && !_fall.moving));
        _hrAbnormalSeconds = abnormal ? _hrAbnormalSeconds + 1 : 0;
        if (_hrAbnormalSeconds >= Config.HR_ALERT_SECONDS && _ticks >= _hrQuietUntilTick && !cancelPending) {
            startAlert("HR_ALERT", Config.ALERT_COUNTDOWN_SECONDS);
        }
    }

    function onPosition(info as Position.Info) as Void {
        gpsAccuracy = info.accuracy;
        var loc = info.position;
        if (loc != null && info.accuracy != Position.QUALITY_NOT_AVAILABLE) {
            var deg = loc.toDegrees();
            lat = deg[0];
            lng = deg[1];
            _lastFixTime = Time.now().value();
            if (info.accuracy == Position.QUALITY_GOOD || info.accuracy == Position.QUALITY_USABLE) {
                _gotGoodFix = true;
            }
            // Flash writes are slow and wear the storage; the background
            // service only needs a reasonably recent position.
            if (_ticks - _lastPersistTick >= 60) {
                _lastPersistTick = _ticks;
                Application.Storage.setValue("last_lat", lat);
                Application.Storage.setValue("last_lng", lng);
                Application.Storage.setValue("last_pos_time", _lastFixTime);
            }
        }
    }

    function onSensor(info as Sensor.Info) as Void {
        heartRate = info.heartRate;
    }

    // ── Networking ───────────────────────────────────────────────────────────

    function onResponse(code as Number, data as Dictionary or String or Null) as Void {
        // After a timeout this may be a late reply to an abandoned request, so
        // `type` can be wrong. SOS/cancel acks are therefore confirmed from the
        // server's reported sosActive, not from `type` alone.
        var type = _inFlightType;
        _inFlightType = null;
        lastResponseCode = code;

        if (code == 200 && data instanceof Dictionary) {
            var lm = data["landmark"];
            if (lm instanceof String) {
                landmark = lm;
            }
            var req = data["checkInRequested"];
            if ("CHECK_IN_OK".equals(type)) {
                checkInOkPending = false;
                checkInPending = false;
            } else if (req == true) {
                noteCheckInRequested();
            } else if (req == false) {
                checkInPending = false; // answered elsewhere or expired on the server
            }
            var serverSos = data["sosActive"];
            if (alertEvent.equals(type) && mode == MODE_SOS && !sosAcked && serverSos == true) {
                sosAcked = true;
                buzz(1000);
            } else if ("SOS_CANCEL".equals(type) && serverSos == false) {
                cancelPending = false;
            }
        } else if ("CHECK_IN_OK".equals(type) && code >= 400 && code < 500) {
            checkInOkPending = false; // server rejected it; retrying can't help
        }
        WatchUi.requestUpdate();
    }

    function onBackgroundDataReceived(data as Dictionary) as Void {
        if (data["checkInRequested"] == true) {
            noteCheckInRequested();
            WatchUi.requestUpdate();
        }
    }

    private function startAlert(eventType as String, seconds as Number) as Void {
        mode = MODE_COUNTDOWN;
        alertEvent = eventType;
        countdown = seconds;
        cancelPending = false;
        _hrAbnormalSeconds = 0;
        wake();
        buzz(eventType.equals("SOS_TRIGGER") ? 300 : 1000);
    }

    private function fireSos() as Void {
        mode = MODE_SOS;
        sosAcked = false;
        buzz(800);
        send(alertEvent);
    }

    private function send(eventType as String) as Void {
        if (_inFlightType != null) {
            if (_ticks - _inFlightSinceTick < Config.REQUEST_TIMEOUT_SECONDS) {
                return; // the timer retries SOS/cancel; a skipped heartbeat doesn't matter
            }
            // No callback for too long: assume it's lost and stop showing the old status.
            lastResponseCode = Communications.NETWORK_REQUEST_TIMED_OUT;
        }

        var body = {
            "deviceId" => _deviceId,
            "eventType" => eventType,
            "timestamp" => Time.now().value(),
            "battery" => System.getSystemStats().battery.toNumber(),
            "sosActive" => (mode == MODE_SOS)
        } as Dictionary<Object, Object>;
        if (heartRate != null) {
            body["heartRate"] = heartRate;
        }
        if (lat != null && lng != null) {
            body["lat"] = lat;
            body["lng"] = lng;
            if (_lastFixTime != null) {
                body["positionAge"] = Time.now().value() - _lastFixTime;
            }
        }

        var headers = { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON } as Dictionary<Object, Object>;
        if (!Config.TOKEN.equals("")) {
            headers["X-SafeSpot-Token"] = Config.TOKEN;
        }

        _inFlightType = eventType;
        _inFlightSinceTick = _ticks;
        Communications.makeWebRequest(Config.SERVER_URL, body, {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => headers,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        }, method(:onResponse));
    }

    // ── Display helpers ──────────────────────────────────────────────────────

    function batteryPercent() as Number {
        return System.getSystemStats().battery.toNumber();
    }

    function gpsLabel() as String {
        if (gpsAccuracy == Position.QUALITY_GOOD || gpsAccuracy == Position.QUALITY_USABLE) {
            return "GPS OK";
        } else if (gpsAccuracy == Position.QUALITY_POOR) {
            return "GPS weak";
        } else if (gpsAccuracy == Position.QUALITY_LAST_KNOWN) {
            return "GPS old";
        }
        return "No GPS";
    }

    function linkLabel() as String {
        if (lastResponseCode == null) {
            return "Connecting...";
        } else if (lastResponseCode == 200) {
            return "Linked";
        } else if (lastResponseCode == Communications.BLE_CONNECTION_UNAVAILABLE) {
            return "No phone";
        } else if (lastResponseCode == Communications.BLE_HOST_TIMEOUT
                || lastResponseCode == Communications.BLE_SERVER_TIMEOUT
                || lastResponseCode == Communications.NETWORK_REQUEST_TIMED_OUT) {
            return "Phone slow";
        } else if (lastResponseCode == 401) {
            return "Bad token";
        }
        return "Error " + lastResponseCode;
    }

    // ── Haptics ──────────────────────────────────────────────────────────────

    private function buzz(ms as Number) as Void {
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(100, ms)]);
        }
    }

    private function wake() as Void {
        if (Attention has :backlight) {
            try {
                Attention.backlight(true);
            } catch (e) {
                // some firmware throws if the backlight was toggled too recently
            }
        }
    }
}
