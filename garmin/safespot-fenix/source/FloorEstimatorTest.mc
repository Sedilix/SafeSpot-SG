import Toybox.Lang;
import Toybox.Test;

(:test)
class FloorTrace {
    // Feeds the same reading n times (as if sampled at 1 Hz) so smoothing settles.
    static function feed(est as FloorEstimator, pascals as Float, n as Number) as Void {
        for (var i = 0; i < n; i++) {
            est.addPressure(pascals);
        }
    }
}

(:test)
function noEstimateWithoutStreetReference(logger as Logger) as Boolean {
    // Stayed home all morning: no street-level reference, so no guess.
    var est = new FloorEstimator();
    FloorTrace.feed(est, 100800.0, 60);
    return est.floorsAbove(1000) == null;
}

(:test)
function countsFloorsClimbedSinceStreetLevel(logger as Logger) as Boolean {
    var est = new FloorEstimator();
    FloorTrace.feed(est, 101000.0, 60);   // walking outside
    est.markStreetLevel(0);
    FloorTrace.feed(est, 100712.0, 60);   // 288 Pa lower: ~9 floors up
    return est.floorsAbove(300) == 9;
}

(:test)
function streetLevelReadsZeroDespiteNoise(logger as Logger) as Boolean {
    var est = new FloorEstimator();
    FloorTrace.feed(est, 101000.0, 60);
    est.markStreetLevel(0);
    for (var i = 0; i < 60; i++) {
        est.addPressure(i % 2 == 0 ? 101008.0 : 100992.0); // +/- 8 Pa sensor noise
    }
    return est.floorsAbove(60) == 0;
}

(:test)
function referenceExpires(logger as Logger) as Boolean {
    var est = new FloorEstimator();
    FloorTrace.feed(est, 101000.0, 60);
    est.markStreetLevel(0);
    FloorTrace.feed(est, 100840.0, 60);
    return est.floorsAbove(45 * 60) == 5 && est.floorsAbove(45 * 60 + 1) == null;
}
