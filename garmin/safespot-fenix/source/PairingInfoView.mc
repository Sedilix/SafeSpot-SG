import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Displays the watch's pairing credentials and instructions for the phone web app.
class PairingInfoView extends WatchUi.View {

    function initialize() {
        View.initialize();
    }

    function onUpdate(dc as Dc) as Void {
        var cx = dc.getWidth() / 2;
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        Layout.fitText(dc, cx, Layout.y(dc, 26), Layout.SMALL_FONTS, "SafeSpot Pairing", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        Layout.fitText(dc, cx, Layout.y(dc, 62), Layout.SMALL_FONTS, "Watch Device ID:", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        Layout.fitText(dc, cx, Layout.y(dc, 88), Layout.TITLE_FONTS, DeviceId.getOrCreate(), Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        Layout.fitText(dc, cx, Layout.y(dc, 130), Layout.SMALL_FONTS, "Enter in phone app:", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        Layout.fitText(dc, cx, Layout.y(dc, 150), Layout.SMALL_FONTS, "Profile > Garmin Watch", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        Layout.fitText(dc, cx, h - Layout.y(dc, 34), Layout.SMALL_FONTS, "BACK = Return", Graphics.TEXT_JUSTIFY_CENTER);
    }
}

class PairingInfoDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onBack() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }
}
