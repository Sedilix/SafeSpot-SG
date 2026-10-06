import Toybox.Lang;
import Toybox.Test;

// Synthetic 25 Hz traces (z-axis only, milli-g). Run with:
//   monkeyc -t ... && monkeydo bin\SafeSpotTest.prg fenix6spro /t

// Helpers live in a test-only class so the runner doesn't execute them as tests.
(:test)
class FallTrace {
    static function repeatSamples(value as Number, count as Number, into as Array<Number>) as Array<Number> {
        for (var i = 0; i < count; i++) {
            into.add(value);
        }
        return into;
    }

    // Feeds samples one second (25) at a time; returns whether any batch reported a fall.
    static function feedDetector(det as FallDetector, z as Array<Number>) as Boolean {
        var fell = false;
        for (var start = 0; start < z.size(); start += 25) {
            var end = start + 25 < z.size() ? start + 25 : z.size();
            var batch = z.slice(start, end);
            var zeros = FallTrace.repeatSamples(0, batch.size(), [] as Array<Number>);
            if (det.addSamples(zeros, zeros, batch)) {
                fell = true;
            }
        }
        return fell;
    }

    // Rest, a short drop, a hard impact, then lying still.
    static function fallTrace(afterImpact as Array<Number>) as Array<Number> {
        var z = FallTrace.repeatSamples(1000, 25, [] as Array<Number>);
        FallTrace.repeatSamples(200, 6, z);     // drop: ~0.2 G for 240 ms
        FallTrace.repeatSamples(4000, 2, z);    // impact: 4 G
        FallTrace.repeatSamples(1300, 50, z);   // settle / bounce
        z.addAll(afterImpact);
        return z;
    }
}

(:test)
function detectsFallFollowedByStillness(logger as Logger) as Boolean {
    var still = FallTrace.repeatSamples(1020, 25 * 11, [] as Array<Number>);
    return FallTrace.feedDetector(new FallDetector(25), FallTrace.fallTrace(still));
}

(:test)
function ignoresImpactWithoutDrop(logger as Logger) as Boolean {
    // Knocking the watch on a table: a spike with no weightless phase.
    var z = FallTrace.repeatSamples(1000, 25, [] as Array<Number>);
    FallTrace.repeatSamples(5000, 2, z);
    FallTrace.repeatSamples(1000, 25 * 13, z);
    return !FallTrace.feedDetector(new FallDetector(25), z);
}

(:test)
function ignoresFallWhenWearerGetsUp(logger as Logger) as Boolean {
    // Stumble with impact, then moving normally (alternating 1.6 G / 0.5 G).
    var moving = [] as Array<Number>;
    for (var i = 0; i < 25 * 11; i++) {
        moving.add(i % 2 == 0 ? 1600 : 500);
    }
    return !FallTrace.feedDetector(new FallDetector(25), FallTrace.fallTrace(moving));
}

(:test)
function reportsMovingForActiveSecond(logger as Logger) as Boolean {
    var det = new FallDetector(25);
    var walking = [] as Array<Number>;
    for (var i = 0; i < 25; i++) {
        walking.add(i % 2 == 0 ? 1500 : 600);
    }
    FallTrace.feedDetector(det, walking);
    var wasMoving = det.moving;
    FallTrace.feedDetector(det, FallTrace.repeatSamples(1000, 25, [] as Array<Number>));
    return wasMoving && !det.moving;
}

(:test)
function ignoresSeatedKnockAgainstWall(logger as Logger) as Boolean {
    // Field false alarm: sitting, swinging the arm into a wall (one 40 ms
    // "light" reading), a hard knock, then resting the arm on a chair.
    var z = FallTrace.repeatSamples(1000, 25, [] as Array<Number>);
    FallTrace.repeatSamples(1400, 3, z);   // arm swings out
    FallTrace.repeatSamples(450, 1, z);    // single dip below the free-fall threshold
    FallTrace.repeatSamples(1200, 2, z);
    FallTrace.repeatSamples(5000, 2, z);   // knock: 5 G
    FallTrace.repeatSamples(1300, 50, z);  // settle
    FallTrace.repeatSamples(1010, 25 * 12, z); // arm resting still
    return !FallTrace.feedDetector(new FallDetector(25), z);
}

(:test)
function ignoresTwoReadingDip(logger as Logger) as Boolean {
    // 80 ms below 0.6 G is still too short to be a drop (~3 cm).
    var z = FallTrace.repeatSamples(1000, 25, [] as Array<Number>);
    FallTrace.repeatSamples(400, 2, z);
    FallTrace.repeatSamples(4500, 2, z);
    FallTrace.repeatSamples(1300, 50, z);
    FallTrace.repeatSamples(1010, 25 * 12, z);
    return !FallTrace.feedDetector(new FallDetector(25), z);
}

(:test)
function detectsShortestRealDrop(logger as Logger) as Boolean {
    // Exactly 3 readings (120 ms) below 0.6 G, then impact and stillness.
    var z = FallTrace.repeatSamples(1000, 25, [] as Array<Number>);
    FallTrace.repeatSamples(550, 3, z);
    FallTrace.repeatSamples(4000, 2, z);
    FallTrace.repeatSamples(1300, 50, z);
    FallTrace.repeatSamples(1020, 25 * 11, z);
    return FallTrace.feedDetector(new FallDetector(25), z);
}
