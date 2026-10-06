import Toybox.Lang;
import Toybox.Position;
import Toybox.Test;

(:test)
function averagesFixesWhileStill(logger as Logger) as Boolean {
    var avg = new FixAverager();
    avg.add(1.30010d, 103.80010d, false);
    avg.add(1.29990d, 103.79990d, false);
    avg.add(1.30000d, 103.80000d, false);
    var dLat = (avg.lat() - 1.3d).abs();
    var dLng = (avg.lng() - 103.8d).abs();
    return avg.count() == 3 && dLat < 0.000001d && dLng < 0.000001d;
}

(:test)
function movementRestartsTheAverage(logger as Logger) as Boolean {
    var avg = new FixAverager();
    avg.add(1.30000d, 103.80000d, false);
    avg.add(1.30000d, 103.80000d, false);
    avg.add(1.31000d, 103.81000d, true); // walked away
    return avg.count() == 1 && (avg.lat() - 1.31d).abs() < 0.000001d;
}

(:test)
function capsTheNumberOfSamples(logger as Logger) as Boolean {
    var avg = new FixAverager();
    for (var i = 0; i < 30; i++) {
        avg.add(1.3d, 103.8d, false);
    }
    return avg.count() == avg.MAX_SAMPLES;
}

(:test)
function accuracyShrinksButNotBelowHalf(logger as Logger) as Boolean {
    var good = FixAverager.baseAccuracyMeters(Position.QUALITY_GOOD);      // 10
    var usable = FixAverager.baseAccuracyMeters(Position.QUALITY_USABLE);  // 25
    return FixAverager.averagedAccuracyMeters(usable, 1) == 25
        && FixAverager.averagedAccuracyMeters(usable, 2) == 17   // 25/sqrt(2) = 17.7
        && FixAverager.averagedAccuracyMeters(usable, 20) == 13  // floor: half of 25, rounded up
        && FixAverager.averagedAccuracyMeters(good, 20) == 5
        && FixAverager.baseAccuracyMeters(Position.QUALITY_POOR) == 60;
}
