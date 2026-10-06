import Toybox.Lang;
import Toybox.Math;

// Wrist fall detector fed raw accelerometer samples (milli-g).
//
// Mirrors the phone engine in src/utils/fallDetection.ts — a drop followed by
// an impact — but adds a third phase, because a wrist sees far more incidental
// spikes (arm swings, knocking a table) than a phone in a pocket:
//   1. near-weightlessness (the drop)
//   2. a hard impact within FREEFALL_WINDOW_SECONDS of it
//   3. after a short settle, the wearer lying mostly still for STILL_SECONDS
// Thresholds are deliberately conservative; tune them from real-world trials.
class FallDetector {

    // A reading below this counts toward free fall...
    const FREEFALL_G = 0.6;
    // ...but only a run lasting this long is a drop. Free fall for t seconds
    // means the wrist fell h = 1/2 * g * t^2: 0.12 s is ~7 cm, which a seated
    // arm swing or a knock on a wall doesn't produce (a single 40 ms dip did
    // trigger a false alarm), while a fall from standing gives ~0.3-0.45 s.
    // The arm's mass doesn't matter: the accelerometer measures acceleration.
    const MIN_FREEFALL_SECONDS = 0.12;
    const IMPACT_G = 3.0;
    const FREEFALL_WINDOW_SECONDS = 1;
    const SETTLE_SECONDS = 2;
    const STILL_SECONDS = 10;
    // Deviation from 1 G that counts as the wearer moving.
    const MOTION_G = 0.25;
    // During the stillness check, more movement than this means they got up.
    const MAX_ACTIVE_FRACTION = 0.15;

    const PHASE_WATCH = 0;
    const PHASE_SETTLE = 1;
    const PHASE_STILL = 2;

    // True when the most recent batch showed the wearer moving. Used to tell
    // a resting high heart rate apart from exercise.
    var moving as Boolean = false;

    private var _rate as Number;
    private var _phase as Number = PHASE_WATCH;
    private var _phaseSamples as Number = 0;
    private var _activeSamples as Number = 0;
    private var _sinceFreefall as Number;
    private var _freefallRun as Number = 0;
    private var _minFreefallSamples as Number;

    function initialize(sampleRate as Number) {
        _rate = sampleRate;
        _sinceFreefall = sampleRate * 1000; // "no recent drop"
        _minFreefallSamples = Math.ceil(sampleRate * MIN_FREEFALL_SECONDS).toNumber();
    }

    function reset() as Void {
        _phase = PHASE_WATCH;
        _phaseSamples = 0;
        _activeSamples = 0;
        _sinceFreefall = _rate * 1000;
        _freefallRun = 0;
    }

    // Returns true once when a complete fall pattern finishes in this batch.
    function addSamples(x as Array<Number>, y as Array<Number>, z as Array<Number>) as Boolean {
        var n = x.size();
        if (y.size() < n) { n = y.size(); }
        if (z.size() < n) { n = z.size(); }

        var batchActive = 0;
        var fell = false;
        for (var i = 0; i < n; i++) {
            var g = Math.sqrt(x[i] * x[i] + y[i] * y[i] + z[i] * z[i]) / 1000.0;
            var active = (g - 1.0).abs() > MOTION_G;
            if (active) {
                batchActive++;
            }

            if (_phase == PHASE_WATCH) {
                _freefallRun = g < FREEFALL_G ? _freefallRun + 1 : 0;
                _sinceFreefall = _freefallRun >= _minFreefallSamples ? 0 : _sinceFreefall + 1;
                if (g > IMPACT_G && _sinceFreefall <= _rate * FREEFALL_WINDOW_SECONDS) {
                    _phase = PHASE_SETTLE;
                    _phaseSamples = 0;
                }
            } else if (_phase == PHASE_SETTLE) {
                _phaseSamples++;
                if (_phaseSamples >= _rate * SETTLE_SECONDS) {
                    _phase = PHASE_STILL;
                    _phaseSamples = 0;
                    _activeSamples = 0;
                }
            } else {
                _phaseSamples++;
                if (active) {
                    _activeSamples++;
                }
                if (_activeSamples > _rate * STILL_SECONDS * MAX_ACTIVE_FRACTION) {
                    reset(); // moving normally again: not a fall
                } else if (_phaseSamples >= _rate * STILL_SECONDS) {
                    reset();
                    fell = true;
                }
            }
        }
        moving = n > 0 && batchActive * 5 > n; // >20% of the last second
        return fell;
    }
}
