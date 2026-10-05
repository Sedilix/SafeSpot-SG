import Toybox.Lang;
import Toybox.WatchUi;

// fēnix buttons: START (top right) -> onSelect, BACK/LAP (bottom right) -> onBack.
class SafeSpotDelegate extends WatchUi.BehaviorDelegate {

    private var _model as SafeSpotModel;

    function initialize(model as SafeSpotModel) {
        BehaviorDelegate.initialize();
        _model = model;
    }

    function onSelect() as Boolean {
        _model.onStartPressed();
        return true;
    }

    function onMenu() as Boolean {
        if (_model.mode == MODE_IDLE) {
            WatchUi.pushView(new PairingInfoView(), new PairingInfoDelegate(), WatchUi.SLIDE_UP);
            return true;
        }
        return false;
    }

    // UP / DOWN answer a caregiver check-in (START stays SOS-only).
    // When idle with no check-in, UP / DOWN opens device pairing info.
    function onNextPage() as Boolean {
        if (_model.checkInPending) {
            return _model.confirmCheckIn();
        }
        if (_model.mode == MODE_IDLE) {
            WatchUi.pushView(new PairingInfoView(), new PairingInfoDelegate(), WatchUi.SLIDE_UP);
            return true;
        }
        return false;
    }

    function onPreviousPage() as Boolean {
        if (_model.checkInPending) {
            return _model.confirmCheckIn();
        }
        if (_model.mode == MODE_IDLE) {
            WatchUi.pushView(new PairingInfoView(), new PairingInfoDelegate(), WatchUi.SLIDE_UP);
            return true;
        }
        return false;
    }

    function onBack() as Boolean {
        if (_model.mode == MODE_COUNTDOWN) {
            _model.cancelCountdown();
            return true;
        }
        if (_model.mode == MODE_SOS) {
            // A sent SOS needs a deliberate second step to stand down.
            WatchUi.pushView(new WatchUi.Confirmation("Cancel SOS?\nI'm OK"), new CancelSosDelegate(_model), WatchUi.SLIDE_IMMEDIATE);
            return true;
        }
        return false; // idle: default behaviour exits the app
    }
}

class CancelSosDelegate extends WatchUi.ConfirmationDelegate {

    private var _model as SafeSpotModel;

    function initialize(model as SafeSpotModel) {
        ConfirmationDelegate.initialize();
        _model = model;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            _model.cancelSos();
        }
        return true;
    }
}
