// Build-time settings. Sideloaded apps can't receive Garmin Connect settings,
// so these are baked into the .prg.
(:background)
module Config {
    // Real watches require HTTPS (requests are proxied through the paired phone).
    const SERVER_URL = "https://safespot-sg-258662267000.asia-southeast1.run.app/api/wearable/event";
    // Must match the server's WEARABLE_TOKEN env var. Leave empty if the server has none.
    // Set it locally before building; don't commit a real value.
    const TOKEN = "";
    // The device ID is per-watch and random; see DeviceId.mc.
    const COUNTDOWN_SECONDS = 10;
    // Idle heartbeat; the server treats a watch as offline after 7 minutes.
    const HEARTBEAT_SECONDS = 120;
    // While an SOS is active, update location/vitals more often.
    const SOS_UPDATE_SECONDS = 30;
    // GPS duty cycle when idle: off this long between fixes...
    const GPS_IDLE_INTERVAL_SECONDS = 180;
    // ...and give up on a fix after this long (e.g. indoors).
    const GPS_FIX_TIMEOUT_SECONDS = 90;
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
