# Alert channels setup (SMS + Telegram)

SafeSpot sends every emergency alert to all channels at once: SMS to the emergency contacts, and a message plus a live map pin to every Telegram chat linked to the account. If a channel isn't configured, the server logs it loudly. It no longer pretends an SMS was sent.

Check what's live: `GET https://<app>/api/alerts/channels` returns `{ "sms": true|false, "telegram": true|false }`.

## 1. Telegram bot (free, ~5 minutes)

1. In Telegram, open **@BotFather** → `/newbot` → name it (e.g. *SafeSpot Alerts*) → pick a username ending in `bot`. BotFather replies with the **bot token**. Treat it like a password.
2. Still in BotFather: `/setjoingroups` → your bot → **Enable**. Leave privacy mode **on** (the bot only needs commands addressed to it).
3. Make a random webhook secret (letters, digits, `_` and `-` only, 32+ chars), e.g. in PowerShell:
   ```powershell
   -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
   ```
4. Add both as GitHub Actions secrets (repo → Settings → Secrets and variables → Actions):
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET`
5. Re-run the deploy (or push to `main`). On start the server registers its webhook (`/api/telegram/webhook`) with Telegram automatically.

**Linking a chat (each family):** SafeSpot app → Profile → **Telegram alerts** → *Link a Telegram group* → *Add to a group* → pick the family group → **Start**. The bot replies "Linked to SafeSpot". Use *Just me* to get alerts in a private chat instead. Linking codes are single-use and expire after 15 minutes.

**What the group sees on an alert:** who, what happened (SOS / fall / heart rate), address, heart rate and battery, blood type and medical notes, a live tracking link, an **I'm responding** button (everyone is told who's going), and a map pin that moves for up to 2 hours, until the senior presses "I'm OK".

## 2. Twilio SMS

1. Create a Twilio account and buy a number that can send SMS to Singapore (or use an alphanumeric sender ID).
2. **Singapore sender ID rule:** since 2023, SMS to Singapore with an alphanumeric sender ID must be registered with the SGNIC SMS Sender ID Registry, or it shows as "Likely-SCAM". For a trial, a plain Twilio phone number works. Register before real users.
3. Add GitHub Actions secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (E.164, e.g. `+1…`). The deploy workflow already passes them to Cloud Run.
4. Optional: `WEARABLE_FALLBACK_PHONE` / `WEARABLE_FALLBACK_NAME` for watches that aren't paired yet.

## Security notes

- `/api/notify/dispatch-pin` and `/api/notify/telegram-pin` require a Firebase sign-in (a guest account is created automatically) and are rate-limited: 15 per account per hour, 300 per server per hour. This stops the app from being used as a free SMS relay.
- The webhook rejects any call without the `X-Telegram-Bot-Api-Secret-Token` header matching `TELEGRAM_WEBHOOK_SECRET`.
- Linked chats and link codes live in the server-only Firestore collections `AlertChannels`, `TelegramLinkCodes` and `IncidentTelegram`, which `firestore.rules` denies to browsers.
