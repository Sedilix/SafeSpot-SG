import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

class SafeSpotApp extends Application.AppBase {

    private var _model as SafeSpotModel;

    function initialize() {
        AppBase.initialize();
        _model = new SafeSpotModel();
    }

    function onStart(state as Dictionary?) as Void {
        _model.start();
    }

    function onStop(state as Dictionary?) as Void {
        _model.stop();
    }

    function getInitialView() as [Views] or [Views, InputDelegates] {
        return [ new SafeSpotView(_model), new SafeSpotDelegate(_model) ];
    }
}
