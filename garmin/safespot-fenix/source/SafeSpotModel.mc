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

    var heartRate as Number? = null;
    var lat as Double? = null;
    var lng as Double? = null;
    var gpsAccuracy as Number = Position.QUALITY_NOT_AVAILABLE;
    var landmark as String? = null;
    var lastResponseCode as Number? = null;

    private var _timer as Timer.Timer;
    private var _ticks as Number = 0;
    // At most one request in flight: the phone proxy queue is tiny, and it
    // keeps SOS_TRIGGER / SOS_CANCEL ordered on the server.
    private var _inFlightType as String? = null;

    private var _fall as FallDetector;
    private var _hrAbnormalSeconds as Number = 0;
    private var _hrQuietUntilTick as Number = 0;

    function initialize() {
        _timer = new Timer.Timer();
        _fall = new FallDetector(Config.ACCEL_SAMPLE_RATE);
    }

    function start() as Void {
        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
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
        Position.enableLocationEvents(Position.LOCATION_DISABLE, null);
        Sensor.enableSensorEvents(null);
        Sensor.unregisterSensorDataListener();
    }

    // ── Button actions ───────────────────────────────────────────────────────

    // START: if check-in pending -> send CHECK_IN_OK; idle -> countdown; countdown -> send immediately; SOS -> resend.
    function onStartPressed() as Void {
        if (checkInPending) {
            checkInPending = false;
            buzz(200);
            send("CHECK_IN_OK");
        } else if (mode == MODE_IDLE) {
            startAlert("SOS_TRIGGER", Config.COUNTDOWN_SECONDS);
        } else if (mode == MODE_COUNTDOWN) {
            fireSos();
        } else {
            send(alertEvent);
        }
        WatchUi.requestUpdate();
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
        } else if (_ticks % Config.HEARTBEAT_SECONDS == 0) {
            send("HEARTBEAT");
        }
        if (mode == MODE_IDLE) {
            checkHeartRate();
        }
        WatchUi.requestUpdate();
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
            Application.Storage.setValue("last_lat", lat);
            Application.Storage.setValue("last_lng", lng);
            Application.Storage.setValue("last_pos_time", Time.now().value());
        }
        WatchUi.requestUpdate();
    }

    function onSensor(info as Sensor.Info) as Void {
        heartRate = info.heartRate;
    }

    // ── Networking ───────────────────────────────────────────────────────────

    function onResponse(code as Number, data as Dictionary or String or Null) as Void {
        var type = _inFlightType;
        _inFlightType = null;
        lastResponseCode = code;

        if (code == 200 && data instanceof Dictionary) {
            var lm = data["landmark"];
            if (lm instanceof String) {
                landmark = lm;
            }
            var req = data["checkInRequested"];
            if (req == true) {
                checkInPending = true;
                buzz(400);
            } else if (req == false && "CHECK_IN_OK".equals(type)) {
                checkInPending = false;
            }
            if (alertEvent.equals(type) && mode == MODE_SOS && !sosAcked) {
                sosAcked = true;
                buzz(1000);
            } else if ("SOS_CANCEL".equals(type)) {
                cancelPending = false;
            }
        }
        WatchUi.requestUpdate();
    }

    function onBackgroundDataReceived(data as Dictionary) as Void {
        if (data["checkInRequested"] == true) {
            checkInPending = true;
            buzz(400);
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
            return; // the timer retries SOS/cancel; a skipped heartbeat doesn't matter
        }

        var body = {
            "deviceId" => Config.DEVICE_ID,
            "eventType" => eventType,
            "timestamp" => Time.now().value(),
            "battery" => System.getSystemStats().battery.toNumber()
        } as Dictionary<Object, Object>;
        if (heartRate != null) {
            body["heartRate"] = heartRate;
        }
        if (lat != null && lng != null) {
            body["lat"] = lat;
            body["lng"] = lng;
        }

        var headers = { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON } as Dictionary<Object, Object>;
        if (!Config.TOKEN.equals("")) {
            headers["X-SafeSpot-Token"] = Config.TOKEN;
        }

        _inFlightType = eventType;
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
                || lastResponseCode == Communications.BLE_SERVER_TIMEOUT) {
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
