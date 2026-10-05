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
// A single 1 Hz timer drives the countdown, retries, and heartbeats.
class SafeSpotModel {

    var mode as Number = MODE_IDLE;
    var countdown as Number = 0;
    var sosAcked as Boolean = false;
    var cancelPending as Boolean = false;

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

    function initialize() {
        _timer = new Timer.Timer();
    }

    function start() as Void {
        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
        Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
        Sensor.enableSensorEvents(method(:onSensor));
        _timer.start(method(:onTick), 1000, true);
        send("HEARTBEAT");
    }

    function stop() as Void {
        _timer.stop();
        Position.enableLocationEvents(Position.LOCATION_DISABLE, null);
        Sensor.enableSensorEvents(null);
    }

    // ── Button actions ───────────────────────────────────────────────────────

    // START: idle -> countdown; countdown -> send immediately; SOS -> resend.
    function onStartPressed() as Void {
        if (mode == MODE_IDLE) {
            mode = MODE_COUNTDOWN;
            countdown = Config.COUNTDOWN_SECONDS;
            cancelPending = false;
            wake();
            buzz(300);
        } else if (mode == MODE_COUNTDOWN) {
            fireSos();
        } else {
            send("SOS_TRIGGER");
        }
        WatchUi.requestUpdate();
    }

    function cancelCountdown() as Void {
        mode = MODE_IDLE;
        buzz(100);
        WatchUi.requestUpdate();
    }

    // "I'm OK" after an SOS went out: tell the caregiver dashboard to stand down.
    function cancelSos() as Void {
        mode = MODE_IDLE;
        sosAcked = false;
        cancelPending = true;
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
                send("SOS_TRIGGER");
            }
        } else if (cancelPending) {
            if (_ticks % Config.SOS_RETRY_SECONDS == 0) {
                send("SOS_CANCEL");
            }
        } else if (_ticks % Config.HEARTBEAT_SECONDS == 0) {
            send("HEARTBEAT");
        }
        WatchUi.requestUpdate();
    }

    function onPosition(info as Position.Info) as Void {
        gpsAccuracy = info.accuracy;
        var loc = info.position;
        if (loc != null && info.accuracy != Position.QUALITY_NOT_AVAILABLE) {
            var deg = loc.toDegrees();
            lat = deg[0];
            lng = deg[1];
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
            if ("SOS_TRIGGER".equals(type) && mode == MODE_SOS && !sosAcked) {
                sosAcked = true;
                buzz(1000);
            } else if ("SOS_CANCEL".equals(type)) {
                cancelPending = false;
            }
        }
        WatchUi.requestUpdate();
    }

    private function fireSos() as Void {
        mode = MODE_SOS;
        sosAcked = false;
        buzz(800);
        send("SOS_TRIGGER");
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

        var headers = { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON } as Dictionary<String, Object>;
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
