// Build-time settings. Sideloaded apps can't receive Garmin Connect settings,
// so these are baked into the .prg.
(:background)
module Config {
    // Real watches require HTTPS (requests are proxied through the paired phone).
    const SERVER_URL = "https://safespot-sg-258662267000.asia-southeast1.run.app/api/wearable/event";
    // Must match the server's WEARABLE_TOKEN env var. Leave empty if the server has none.
    // Set it locally before building; don't commit a real value.
    const TOKEN = "";
    const DEVICE_ID = "fenix-6s-solar";
    const COUNTDOWN_SECONDS = 10;
    const HEARTBEAT_SECONDS = 60;
    // While an SOS is active and unacknowledged, retry this often.
    const SOS_RETRY_SECONDS = 5;
    // A request with no callback after this long is treated as lost.
    const REQUEST_TIMEOUT_SECONDS = 30;

    // Automatic alerts (fall, heart rate) get a longer "Are you OK?" window
    // than a deliberate button press.
    const ALERT_COUNTDOWN_SECONDS = 30;
    const ACCEL_SAMPLE_RATE = 25;
    const HR_LOW_BPM = 40;
    const HR_HIGH_BPM = 150;
    const HR_ALERT_SECONDS = 60;
    // After a dismissed HR alert, don't ask again for this long.
    const HR_ALERT_COOLDOWN_SECONDS = 600;
}
