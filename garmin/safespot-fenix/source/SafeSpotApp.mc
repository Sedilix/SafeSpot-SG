import Toybox.Application;
import Toybox.Background;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

(:background)
class SafeSpotApp extends Application.AppBase {

    (:typecheck(false))
    private var _model as SafeSpotModel?;

    function initialize() {
        AppBase.initialize();
    }

    // onStart also runs in the background process, where SafeSpotModel (not
    // annotated :background) can't be loaded. Starting it here crashed every
    // background check-in, so all foreground setup lives in getInitialView.
    function onStart(state as Dictionary?) as Void {
    }

    (:typecheck(false))
    function onStop(state as Dictionary?) as Void {
        if (_model != null) {
            _model.stop();
        }
    }

    // Foreground only.
    (:typecheck(false))
    function getInitialView() as [Views] or [Views, InputDelegates] {
        if (Toybox.System has :ServiceDelegate) {
            try {
                // Register 5-minute periodic background check-in (300 seconds)
                Background.registerForTemporalEvent(new Time.Duration(5 * 60));
            } catch (e) {
                // Ignore if temporal event cannot be registered
            }
        }
        var m = getModel();
        m.start();
        return [ new SafeSpotView(m), new SafeSpotDelegate(m) ];
    }

    function getServiceDelegate() as [System.ServiceDelegate] {
        return [ new SafeSpotBgService() ];
    }

    (:typecheck(false))
    function onBackgroundData(data as Application.PersistableType) as Void {
        if (data instanceof Dictionary) {
            getModel().onBackgroundDataReceived(data as Dictionary);
        }
    }

    (:typecheck(false))
    private function getModel() as SafeSpotModel {
        if (_model == null) {
            _model = new SafeSpotModel();
        }
        return _model as SafeSpotModel;
    }
}
