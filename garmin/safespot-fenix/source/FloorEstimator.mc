import Toybox.Lang;
import Toybox.Math;

// Estimates floors climbed from barometric pressure. Near sea level at
// Singapore temperatures air pressure falls ~11.4 Pa per metre; an HDB floor
// is ~2.8 m, so one floor is ~32 Pa (sensor noise is a few Pa).
//
// It needs a ground reference: the pressure while the wearer was walking
// outdoors with a good GPS fix (street level). Without a recent reference it
// returns null rather than guessing: a senior who stayed home on the 9th
// floor all morning must not be reported as being on the ground floor.
// Weather moves pressure ~10 Pa per 45 min, so the reference expires.
class FloorEstimator {

    const PA_PER_FLOOR = 32.0;
    const REF_MAX_AGE_SECONDS = 45 * 60;
    // Exponential smoothing of the ~1 Hz readings to take out sensor noise.
    const SMOOTHING = 0.2;

    private var _smoothed as Float? = null;
    private var _ref as Float? = null;
    private var _refAt as Number = 0;

    function addPressure(pascals as Float) as Void {
        _smoothed = _smoothed == null ? pascals : _smoothed + SMOOTHING * (pascals - _smoothed);
    }

    // Call when walking outdoors with a good GPS fix (i.e. at street level).
    function markStreetLevel(nowSeconds as Number) as Void {
        if (_smoothed != null) {
            _ref = _smoothed;
            _refAt = nowSeconds;
        }
    }

    // Floors above the last street-level reference, or null if there is none
    // recent enough to trust.
    function floorsAbove(nowSeconds as Number) as Number? {
        if (_ref == null || _smoothed == null || nowSeconds - _refAt > REF_MAX_AGE_SECONDS) {
            return null;
        }
        return Math.round((_ref - _smoothed) / PA_PER_FLOOR).toNumber();
    }

    function referenceAge(nowSeconds as Number) as Number? {
        return _ref == null ? null : nowSeconds - _refAt;
    }
}
