import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Hand-drawn for the 240x240 round MIP panel: few colours, large type, high contrast.
class SafeSpotView extends WatchUi.View {

    private var _model as SafeSpotModel;

    function initialize(model as SafeSpotModel) {
        View.initialize();
        _model = model;
    }

    function onUpdate(dc as Dc) as Void {
        if (_model.mode == MODE_COUNTDOWN) {
            drawCountdown(dc);
        } else if (_model.mode == MODE_SOS) {
            drawSos(dc);
        } else {
            drawIdle(dc);
        }
    }

    private function drawCountdown(dc as Dc) as Void {
        var cx = dc.getWidth() / 2;
        var h = dc.getHeight();
        var automatic = !_model.alertEvent.equals("SOS_TRIGGER");
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_RED);
        dc.clear();
        dc.drawText(cx, 38, Graphics.FONT_SMALL, countdownTitle(), Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(cx, h / 2, Graphics.FONT_NUMBER_THAI_HOT, _model.countdown.toString(),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(cx, h - 76, Graphics.FONT_XTINY, automatic ? "Alerting caregiver" : "START: send now",
            Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(cx, h - 54, Graphics.FONT_XTINY, automatic ? "BACK: I'm OK" : "BACK: cancel",
            Graphics.TEXT_JUSTIFY_CENTER);
    }

    private function countdownTitle() as String {
        if (_model.alertEvent.equals("FALL_DETECTED")) {
            return "FALL? ARE YOU OK";
        } else if (_model.alertEvent.equals("HR_ALERT")) {
            var hr = _model.heartRate;
            return "HEART RATE " + (hr != null ? hr.toString() : "");
        }
        return "SOS IN";
    }

    private function drawSos(dc as Dc) as Void {
        var cx = dc.getWidth() / 2;
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_RED);
        dc.clear();
        dc.drawText(cx, 34, Graphics.FONT_MEDIUM, _model.sosAcked ? "SOS SENT" : "SENDING", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(cx, 72, Graphics.FONT_XTINY,
            _model.sosAcked ? "Caregiver alerted" : _model.linkLabel(), Graphics.TEXT_JUSTIFY_CENTER);

        var where = _model.landmark;
        if (where == null) {
            where = _model.lat != null ? "Location shared" : "Finding GPS...";
        }
        dc.drawText(cx, h / 2 + 4, Graphics.FONT_TINY, where, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        dc.drawText(cx, h / 2 + 30, Graphics.FONT_XTINY, vitalsLine(), Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(cx, h - 54, Graphics.FONT_XTINY, "BACK: I'm OK", Graphics.TEXT_JUSTIFY_CENTER);
    }

    private function drawIdle(dc as Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        if (_model.checkInPending) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, 26, Graphics.FONT_XTINY, "Caregiver asks: OK?", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, 26, Graphics.FONT_XTINY, "SafeSpot", Graphics.TEXT_JUSTIFY_CENTER);
        }

        var hr = _model.heartRate;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 82, Graphics.FONT_NUMBER_MEDIUM, hr != null ? hr.toString() : "--",
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(cx, 112, Graphics.FONT_XTINY, "bpm", Graphics.TEXT_JUSTIFY_CENTER);

        var linked = _model.lastResponseCode == 200;
        dc.drawText(cx, 138, Graphics.FONT_XTINY,
            _model.batteryPercent() + "%  " + _model.gpsLabel(), Graphics.TEXT_JUSTIFY_CENTER);
        if (_model.checkInPending) {
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, 160, Graphics.FONT_XTINY, "UP/DOWN = I'M OK", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.setColor(linked ? Graphics.COLOR_GREEN : Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, 160, Graphics.FONT_XTINY, _model.linkLabel(), Graphics.TEXT_JUSTIFY_CENTER);
        }

        // START always means SOS, even during a check-in.
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(cx - 62, h - 50, 124, 28, 14);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h - 36, Graphics.FONT_XTINY, "START = SOS",
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    private function vitalsLine() as String {
        var hr = _model.heartRate;
        return (hr != null ? hr + " bpm  " : "") + _model.batteryPercent() + "%";
    }
}
