import Toybox.Lang;

// Pure decisions behind the 0.6.1 status warnings, kept free of device APIs
// so they can be unit-tested.
module WatchStatus {

    // Warn the wearer at or below this, before the watch's own power saving
    // (which may switch off Bluetooth and GPS) stops SafeSpot working.
    const LOW_BATTERY_PCT = 20;
    // The warning re-arms only once the battery is back above this.
    const BATTERY_RECOVERED_PCT = 30;
    // A last-known position older than this isn't worth sending.
    const MAX_FALLBACK_AGE_SECONDS = 24 * 60 * 60;

    // Whether the low-battery warning should be showing. Hysteresis: once on,
    // it stays on until the watch is charging or back above the recovered level.
    function lowBattery(battery as Number, charging as Boolean, warned as Boolean) as Boolean {
        if (charging || battery >= BATTERY_RECOVERED_PCT) {
            return false;
        }
        if (battery <= LOW_BATTERY_PCT) {
            return true;
        }
        return warned;
    }

    // Picks the fresher of two last-known positions, each [lat, lng, ageSeconds]
    // (or null). Positions older than MAX_FALLBACK_AGE_SECONDS are ignored.
    function freshest(a as Array?, b as Array?) as Array? {
        var aAge = a != null ? a[2] as Number : null;
        var bAge = b != null ? b[2] as Number : null;
        var aOk = aAge != null && aAge <= MAX_FALLBACK_AGE_SECONDS;
        var bOk = bAge != null && bAge <= MAX_FALLBACK_AGE_SECONDS;
        if (aOk && bOk) {
            return (aAge as Number) <= (bAge as Number) ? a : b;
        }
        return aOk ? a : (bOk ? b : null);
    }
}
