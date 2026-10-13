# Alert channels setup (SMS, Telegram, phone notifications)

SafeSpot sends every emergency alert to all channels at once:
- SMS to the emergency contacts;
- a message plus a live map pin to every Telegram chat linked to the account;
- a notification to every phone that turned on SafeSpot alerts.

If a channel isn't configured, the server logs it loudly. It never pretends an SMS was sent.

Check what's live: `GET https://<app>/api/alerts/channels` returns `{ "sms", "telegram", "push" }`, each true or false.

## 1. Telegram bot (free, about 5 minutes)

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

**Linking a chat (each family):** SafeSpot app → Profile → **Family alerts** → *Link a Telegram group* → *Add to a group* → pick the family group → **Start**. The bot replies "Linked to SafeSpot". Use *Just me* to get alerts in a private chat instead. Linking codes are single-use and expire after 15 minutes.

**What the group sees on an alert:**
- who it is and what happened (SOS, fall or heart rate);
- the address, heart rate and battery;
- blood type and medical notes;
- a live tracking link and a Google Maps link;
- **I'm responding** and **Directions** buttons;
- a map pin that moves for up to 2 hours, until the senior presses "I'm OK".

## 2. SMS: textbee (free, from an Android phone) and/or Twilio

SafeSpot can send SMS through **textbee.dev**, which uses a spare Android phone's own SIM, or **Twilio**. With both configured, textbee is tried first and Twilio is the fallback. Set `SMS_PROVIDER=twilio` to try Twilio first.

### textbee
1. On a spare Android phone that stays **charged and online**, with a SIM whose plan includes SMS, install the textbee app from https://textbee.dev and sign in.
2. In the textbee dashboard, register the phone and generate an **API key**.
3. Add the GitHub secret `TEXTBEE_API_KEY`. If you register more than one phone, also add `TEXTBEE_DEVICE_ID`.
4. Free tier: 50 SMS a day, 300 a month. Texts come from that phone's normal number, so the Singapore sender ID registry doesn't apply.

The SMS only goes out while that phone is on, so keep Telegram or phone notifications as the main channel.

### Twilio
1. Create a Twilio account and get a number that can send SMS. On a trial account, also allow Singapore under **Messaging → Settings → Geo permissions**, and verify each phone you'll text.
2. **Singapore sender ID rule:** since 2023, SMS to Singapore with an alphanumeric sender ID must be registered with the SGNIC SMS Sender ID Registry, or it shows as "Likely-SCAM". For a trial, a plain Twilio phone number works. Register before real users.
3. Add GitHub Actions secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (E.164, e.g. `+1…`).
4. Optional: `WEARABLE_FALLBACK_PHONE` / `WEARABLE_FALLBACK_NAME` for watches that aren't paired yet.

SMS is never sent to 995 or other short codes, only to mobile numbers.

## 3. Phone notifications (web push, free)

Already set up: `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are GitHub secrets, with a backup in `vapid_keys.json` in the owner's user folder. **Don't change or lose these keys:** every phone that turned on alerts would silently stop receiving them.

- **The account's own phone:** Profile → **Family alerts** → *Turn on for this phone*.
- **Family members:** *Invite family* → share the link. They open it and tap **Turn on alerts**, with no account needed. A link works for 7 days and up to 10 phones.
- **Android and computers:** works in Chrome, Edge and Firefox.
- **iPhone:** the person must first add SafeSpot to the Home Screen (Share → Add to Home Screen) and open it from there. The invite page walks them through it. Needs iOS 16.4 or later.
- Tapping a notification opens the live tracking page. Phones that block notifications are removed automatically.

## Security notes

- `/api/notify/dispatch-pin`, `/api/notify/telegram-pin` and `/api/alerts/test` require a Firebase sign-in (a guest account is created automatically). They're rate-limited to 15 per account per hour and 300 per server per hour, so the app can't be used as a free SMS relay.
- Push invite lookups and joins are rate-limited per IP. Invite codes are random 8-character codes.
- The Telegram webhook rejects any call without the `X-Telegram-Bot-Api-Secret-Token` header matching `TELEGRAM_WEBHOOK_SECRET`.
- Linked chats, push subscriptions and invite codes live in the server-only Firestore collections `AlertChannels`, `TelegramLinkCodes`, `PushInvites` and `IncidentTelegram`, which `firestore.rules` denies to browsers.
