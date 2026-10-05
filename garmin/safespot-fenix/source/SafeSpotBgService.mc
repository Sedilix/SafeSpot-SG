import Toybox.Application;
import Toybox.Background;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.SensorHistory;
import Toybox.System;
import Toybox.Time;

(:background)
class SafeSpotBgService extends System.ServiceDelegate {

    function initialize() {
        ServiceDelegate.initialize();
    }

    function onTemporalEvent() as Void {
        var params = {
            "deviceId" => Config.DEVICE_ID,
            "eventType" => "HEARTBEAT",
            "timestamp" => Time.now().value(),
            "isBackground" => true
        } as Dictionary<Object, Object>;

        var stats = System.getSystemStats();
        if (stats != null && stats.battery != null) {
            params.put("battery", stats.battery.toNumber());
        }

        var hr = getRecentHeartRate();
        if (hr != null) {
            params.put("heartRate", hr);
        }

        var lat = Application.Storage.getValue("last_lat");
        var lng = Application.Storage.getValue("last_lng");
        var lastTime = Application.Storage.getValue("last_pos_time");
        if (lat != null && lng != null) {
            params.put("lat", lat);
            params.put("lng", lng);
            if (lastTime != null && lastTime instanceof Number) {
                var age = Time.now().value() - (lastTime as Number);
                params.put("positionAge", age >= 0 ? age : 0);
            }
        }

        var headers = {
            "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
        } as Dictionary<Object, Object>;

        if (Config.TOKEN.length() > 0) {
            headers.put("X-SafeSpot-Token", Config.TOKEN);
        }

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => headers,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(
            Config.SERVER_URL,
            params,
            options,
            method(:onBgResponse)
        );
    }

    function onBgResponse(code as Number, data as Dictionary or String or Null) as Void {
        var requested = false;
        if (code == 200 && data instanceof Dictionary) {
            requested = data["checkInRequested"] == true;
            if (requested) {
                if (Background has :requestApplicationWake) {
                    try {
                        Background.requestApplicationWake("Caregiver asks: are you OK?");
                    } catch (e) {
                        // ignore if wake request is throttled by OS
                    }
                }
            }
        }
        // Delivered to SafeSpotApp.onBackgroundData when the app is next open.
        var result = { "checkInRequested" => requested } as Dictionary<Application.PropertyKeyType, Application.PropertyValueType>;
        Background.exit(result);
    }

    private function getRecentHeartRate() as Number? {
        if (Toybox has :SensorHistory && Toybox.SensorHistory has :getHeartRateHistory) {
            try {
                var iter = SensorHistory.getHeartRateHistory({
                    :period => 1,
                    :order => SensorHistory.ORDER_NEWEST_FIRST
                });
                if (iter != null) {
                    var sample = iter.next();
                    if (sample != null && sample.data != null) {
                        var d = sample.data as Number;
                        if (d > 0) {
                            return d;
                        }
                    }
                }
            } catch (e) {
                // fall through if sensor history is uninitialized
            }
        }
        return null;
    }
}
