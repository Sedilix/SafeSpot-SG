import Toybox.Lang;
import Toybox.Test;

(:test)
function lowBatteryWarnsAtTwentyAndHoldsUntilRecovered(logger as Logger) as Boolean {
    return !WatchStatus.lowBattery(25, false, false)   // not yet
        && WatchStatus.lowBattery(20, false, false)    // warn at 20%
        && WatchStatus.lowBattery(24, false, true)     // stays on between 20 and 30
        && !WatchStatus.lowBattery(30, false, true)    // re-arms once recovered
        && !WatchStatus.lowBattery(10, true, true);    // charging clears it
}

(:test)
function freshestPrefersNewerAndDropsStale(logger as Logger) as Boolean {
    var stored = [1.30, 103.80, 600];
    var system = [1.31, 103.81, 60];
    var stale = [1.32, 103.82, 2 * 24 * 60 * 60];
    return WatchStatus.freshest(stored, system) == system
        && WatchStatus.freshest(stored, null) == stored
        && WatchStatus.freshest(null, stale) == null
        && WatchStatus.freshest(stale, stored) == stored
        && WatchStatus.freshest(null, null) == null;
}
