import Toybox.Lang;
import Toybox.Math;
import Toybox.Position;

// Averages GPS fixes while the wearer is standing still, which cancels much of
// the jitter between consecutive fixes. Any movement restarts the average from
// the newest fix, so a walking person is never pinned to where they were.
class FixAverager {

    const MAX_SAMPLES = 20;

    private var _sumLat as Double = 0.0d;
    private var _sumLng as Double = 0.0d;
    private var _count as Number = 0;

    function reset() as Void {
        _sumLat = 0.0d;
        _sumLng = 0.0d;
        _count = 0;
    }

    function add(lat as Double, lng as Double, moving as Boolean) as Void {
        if (moving) {
            reset();
        }
        if (_count >= MAX_SAMPLES) {
            return; // enough; later fixes add little and drift is possible
        }
        _sumLat += lat;
        _sumLng += lng;
        _count++;
    }

    function count() as Number {
        return _count;
    }

    function lat() as Double {
        return _count > 0 ? _sumLat / _count : 0.0d;
    }

    function lng() as Double {
        return _count > 0 ? _sumLng / _count : 0.0d;
    }

    // Garmin only reports a quality level; these are conservative radii in metres.
    static function baseAccuracyMeters(quality as Number) as Number {
        if (quality == Position.QUALITY_GOOD) {
            return 10;
        } else if (quality == Position.QUALITY_USABLE) {
            return 25;
        } else if (quality == Position.QUALITY_POOR) {
            return 60;
        }
        return 100; // last known / unknown
    }

    // Averaging n fixes shrinks random error by about sqrt(n), but GPS errors
    // are correlated over seconds, so never claim better than half the base.
    static function averagedAccuracyMeters(base as Number, count as Number) as Number {
        if (count <= 1) {
            return base;
        }
        var shrunk = (base / Math.sqrt(count)).toNumber();
        var floor = (base + 1) / 2;
        return shrunk > floor ? shrunk : floor;
    }
}
