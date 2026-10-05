// Build-time settings. Sideloaded apps can't receive Garmin Connect settings,
// so these are baked into the .prg.
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
}
