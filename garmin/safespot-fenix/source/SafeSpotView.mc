import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.WatchUi;

// Hand-drawn, high-contrast layout for round watches from 218 to 466 px.
// Positions are written for a 240 px screen and scaled (Layout.y), and each
// line uses the largest font that fits the screen's width at its height.
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
        Layout.fitText(dc, cx, Layout.y(dc, 38), Layout.TITLE_FONTS, countdownTitle(), Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(cx, h / 2, Graphics.FONT_NUMBER_THAI_HOT, _model.countdown.toString(),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        Layout.fitText(dc, cx, h - Layout.y(dc, 76), Layout.SMALL_FONTS,
            automatic ? "Alerting caregiver" : "START: send now", Graphics.TEXT_JUSTIFY_CENTER);
        Layout.fitText(dc, cx, h - Layout.y(dc, 54), Layout.SMALL_FONTS,
            automatic ? "BACK: I'm OK" : "BACK: cancel", Graphics.TEXT_JUSTIFY_CENTER);
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
        Layout.fitText(dc, cx, Layout.y(dc, 34), [Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY],
            _model.sosAcked ? "SOS SENT" : "SENDING", Graphics.TEXT_JUSTIFY_CENTER);
        Layout.fitText(dc, cx, Layout.y(dc, 72), Layout.SMALL_FONTS,
            _model.sosAcked ? "Caregiver alerted" : _model.linkLabel(), Graphics.TEXT_JUSTIFY_CENTER);

        var where = _model.landmark;
        if (where == null) {
            where = _model.lat != null ? "Location shared" : "Finding GPS...";
        }
        Layout.fitText(dc, cx, h / 2 + Layout.y(dc, 4), [Graphics.FONT_TINY, Graphics.FONT_XTINY], where,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        Layout.fitText(dc, cx, h / 2 + Layout.y(dc, 30), Layout.SMALL_FONTS, vitalsLine(), Graphics.TEXT_JUSTIFY_CENTER);
        Layout.fitText(dc, cx, h - Layout.y(dc, 54), Layout.SMALL_FONTS, "BACK: I'm OK", Graphics.TEXT_JUSTIFY_CENTER);
    }

    private function drawIdle(dc as Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        if (_model.checkInPending) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            Layout.fitText(dc, cx, Layout.y(dc, 26), Layout.SMALL_FONTS, "Caregiver asks: OK?", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
            Layout.fitText(dc, cx, Layout.y(dc, 26), Layout.SMALL_FONTS, "SafeSpot", Graphics.TEXT_JUSTIFY_CENTER);
        }

        var hr = _model.heartRate;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, Layout.y(dc, 82), Graphics.FONT_NUMBER_MEDIUM, hr != null ? hr.toString() : "--",
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(cx, Layout.y(dc, 112), Graphics.FONT_XTINY, "bpm", Graphics.TEXT_JUSTIFY_CENTER);

        var linked = _model.lastResponseCode == 200;
        Layout.fitText(dc, cx, Layout.y(dc, 138), Layout.SMALL_FONTS,
            _model.batteryPercent() + "%  " + _model.gpsLabel(), Graphics.TEXT_JUSTIFY_CENTER);
        if (_model.checkInPending) {
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
            // Touchscreen watches (Venu, vivoactive) have no UP/DOWN buttons;
            // a vertical swipe sends the same "next/previous page" action.
            Layout.fitText(dc, cx, Layout.y(dc, 160), Layout.SMALL_FONTS,
                Layout.isTouch() ? "SWIPE = I'M OK" : "UP/DOWN = I'M OK", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.setColor(linked ? Graphics.COLOR_GREEN : Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            Layout.fitText(dc, cx, Layout.y(dc, 160), Layout.SMALL_FONTS, _model.linkLabel(), Graphics.TEXT_JUSTIFY_CENTER);
        }

        // START always means SOS, even during a check-in.
        var pillW = Layout.y(dc, 124);
        var pillH = Layout.y(dc, 28);
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(cx - pillW / 2, h - Layout.y(dc, 50), pillW, pillH, pillH / 2);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        Layout.fitText(dc, cx, h - Layout.y(dc, 36), Layout.SMALL_FONTS, "START = SOS",
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    private function vitalsLine() as String {
        var hr = _model.heartRate;
        return (hr != null ? hr + " bpm  " : "") + _model.batteryPercent() + "%";
    }
}

// Shared layout helpers for all screens.
module Layout {

    const TITLE_FONTS = [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY];
    const SMALL_FONTS = [Graphics.FONT_XTINY];

    // Scales a coordinate designed for a 240 px screen to this screen.
    function y(dc as Dc, designPx as Number) as Number {
        return designPx * dc.getHeight() / 240;
    }

    // Width of a round screen at height y, minus a small margin.
    function usableWidth(dc as Dc, y as Number) as Number {
        var r = dc.getWidth() / 2.0;
        var dy = (y - dc.getHeight() / 2.0).abs();
        if (dy >= r) {
            return 0;
        }
        return (2 * Math.sqrt(r * r - dy * dy) * 0.92).toNumber();
    }

    // Draws text in the largest of `fonts` that fits; falls back to the last one.
    function fitText(dc as Dc, x as Number, y as Number, fonts as Array<Graphics.FontType>, text as String,
            justify as Number) as Void {
        var font = fonts[fonts.size() - 1];
        for (var i = 0; i < fonts.size(); i++) {
            var fh = dc.getFontHeight(fonts[i]);
            // Check the width at the text's top and bottom edges, whichever is narrower.
            var top = (justify & Graphics.TEXT_JUSTIFY_VCENTER) != 0 ? y - fh / 2 : y;
            var room = usableWidth(dc, top);
            var roomBottom = usableWidth(dc, top + fh);
            if (roomBottom < room) {
                room = roomBottom;
            }
            if (dc.getTextWidthInPixels(text, fonts[i]) <= room) {
                font = fonts[i];
                break;
            }
        }
        dc.drawText(x, y, font, text, justify);
    }

    function isTouch() as Boolean {
        var settings = System.getDeviceSettings();
        return settings has :isTouchScreen && settings.isTouchScreen;
    }
}
