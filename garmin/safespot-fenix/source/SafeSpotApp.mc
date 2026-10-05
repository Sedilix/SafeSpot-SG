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

    (:typecheck(false))
    function onStart(state as Dictionary?) as Void {
        if (Toybox.System has :ServiceDelegate) {
            try {
                // Register 5-minute periodic background check-in (300 seconds)
                Background.registerForTemporalEvent(new Time.Duration(5 * 60));
            } catch (e) {
                // Ignore if temporal event cannot be registered
            }
        }
        getModel().start();
    }

    (:typecheck(false))
    function onStop(state as Dictionary?) as Void {
        if (_model != null) {
            _model.stop();
        }
    }

    (:typecheck(false))
    function getInitialView() as [Views] or [Views, InputDelegates] {
        var m = getModel();
        return [ new SafeSpotView(m), new SafeSpotDelegate(m) ];
    }

    function getServiceDelegate() as [System.ServiceDelegate] {
        return [ new SafeSpotBgService() ];
    }

    (:typecheck(false))
    function onBackgroundData(data as Application.PersistableType) as Void {
        if (_model != null && data instanceof Dictionary) {
            _model.onBackgroundDataReceived(data as Dictionary);
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
