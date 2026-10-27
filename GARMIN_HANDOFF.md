> **LATEST (2026-10-27): PR #46 MERGED (`4e3004e`) & SHIPPED TO PRODUCTION (Cloud Run asia-southeast1). Fix H completed: clean-room link evaluation on LTA holdout (40.6M observations, 77.8% link-match), signal double-counting resolved (w_signal = 0.0s, empirical Huber caps, CTE morning factor refitted, Saturday/Sunday data-derived profiles). Branch `feat/senior-sheltered-navigation`: senior sheltered walking guidance with 4-language localized audio/visual instructions (`src/routing/pedestrianRouter.ts`) & clean-room measured trips calibration engine (`src/utils/tripsService.ts`) with PDPA privacy compliance. All 363 tests passing, zero lint errors, build clean.**
> - **PR #46 MERGED (`4e3004e`, 2026-10-27): Fix H — Settled signal delay double-counting (w_signal = 0.0s), fitted empirical Huber caps, auto-generated speed factor tables from LTA speed bands, link-level holdout evaluation against 40.6M observations, clean-room corridor audit. Successfully deployed to Cloud Run.**
> - **PR #44 MERGED (`41e7d42`): Fix J2: via-way turn restrictions, motorway_link 55 km/h cap, real `npm run build:graph`, step-by-step gap audit.**
> - **PR #45 MERGED (`4f82e0b`, 2026-10-21): Deploy doc fixes (new dated path per upload; service in project `cybrdeck`, job and bucket in `safespot-sg`) and via-way restrictions enforced across every segment of the via way.**
> - **PR #46 OPEN, ON HOLD for Fix H (`fix/routing-signal-delays`, `222cdd6`, rebased on `4f82e0b`, no conflicts): imports 4,933 OSM traffic-signal nodes into the graph, charges a 9 s signal wait (UNVERIFIED), and rewrites `tools/routing/gap-alignment-table.ts` to compare corridors by spatial divergence (>35 m from Google's polyline) instead of cumulative distance. Do not merge as is:**
>   - The 10-pair median absolute error got worse (8.2% → 9.5%) and held-out latency failed (206–223 ms vs < 200 ms). `FREE_FLOW_SPEED_ASSUMPTIONS` already includes signal delays, so they are counted twice.
>   - Root cause of the CBD routes avoiding the CTE: the hand-typed 0.62 morning inbound expressway factor puts the CTE at 42 km/h, while Google shows ~64–71 km/h. Signals are not the cause; Google's own route crosses more signals.
>   - **Fix H plan:** fit the expressway/arterial factors and the surface free-flow caps on LTA speed bands, together with the signal waits, then re-run the corridor audit, both benchmarks and the shadow pairs, old vs new.
>   - The rebuilt graph with signals is **not uploaded**. Production still uses the older graph, which has no signal data.
> - **PR #38 MERGED (`6641d63`): Fix F — Scheduled shadow probe comparing engine vs Google Routes across 10 fixed pairs 6x daily (`tools/routing/shadow-probe.ts`, `tools/routing/shadow-report.ts`, `docs/shadow-probe.md`).**
> - **PR #39 MERGED (`efa4d1a`): Fix G — Single-route latency reduction (`src/routing/graph.ts`, `src/routing/router.ts`, `src/routing/speedProfiles.ts`). Original dataset median latency 42.5 ms (target < 200 ms: PASS); Held-out dataset median latency 177.4 ms (target < 200 ms: PASS). All ETAs and distances match exactly.**
> - **PR #40 MERGED (`e9a96e1`): Fix F bugfix by Claude Code — Google Route departures omission so requests aren't rejected as past times, null recording on Google failures, and test simulation isolation.**
> - **PR #41 MERGED (`10c2f86`): Fix I — Pre-load drive routing graph in background at server startup when `ROUTING_SHADOW_DRIVE=1` or `ROUTING_ENGINE_DRIVE=local` (`src/routing/driveWorkerClient.ts`, `server.ts`). Eliminates cold-start skips.**
> - **PR #43 MERGED (`06a8c9a`): Fix J — Investigated Ang Mo Kio -> Punggol route vs Google polyline. Found 923m of CTE-to-TPE flyover mistagged in OSM as primary_link and artificially capped at 25 km/h. Fixed in `tools/osm/build-graph.ts` by normalizing links with expressway destinations to motorway_link. Added `distanceMeters` (local & Google) to probe rows (`tools/routing/shadow-probe.ts`, `tools/routing/shadow-report.ts`, `tools/osm/build-graph.test.ts`).**
> - **SHADOW PROBE LIVE:** Job `routing-shadow-probe` deployed; Cloud Scheduler jobs `routing-shadow-probe-half-hour` and `routing-shadow-probe-on-the-hour` active. Verified execution successfully wrote probe records to `gs://safespot-sg-speedbands/shadow/2026-10-13.jsonl`.

# >>> START HERE (updated 2026-10-21) <<<

**Current status: Fixes F, G, H, I, J, J2 merged (PR #46 live on Cloud Run). Active feature branch `feat/senior-sheltered-navigation` implements senior sheltered navigation and clean-room measured trips calibration.**
- **Worktree**: `C:\Users\SIT EUC\Documents\Builds\SafeSpotSG` on branch `main`.
- **Phase 0 (Data Foundation) MERGED into `main` (`5c03ce0`):**
  - Speed-band historical logger: `tools/speedbands/logger.ts`.
  - Data audit: `docs/routing-data-audit.md`.
- **Phase 1 (Road Graph + Time-Only Engine) MERGED into `main` (`27b5d61`, PR #25):**
  - Graph builder: `tools/osm/build-graph.ts`.
  - Router: `src/routing/router.ts`.
  - Benchmark: `tools/routing/out/benchmark.md` (MAE 7.49% vs Google free-flow).
- **Phase 2 (Time-Dependent Speeds, Closures & ERP Engine) MERGED into `main` (`37e4ef2`, PR #26):**
  - Speed profiles: `src/routing/speedProfiles.ts`.
  - Live incidents: `src/routing/incidents.ts`.
  - ERP tariffs: `src/routing/erp.ts`.
  - Router integration: `src/routing/router.ts`.
  - Benchmark: `tools/routing/out/benchmark-phase2.md` (Peak MAE 11.93%).
- **Phase 3 (Senior Walking Routes, Weather & Stairs Avoidance) MERGED into `main` (`4d36af5`, PR #27):**
  - Pedestrian graph, engine, weather, router, tests.
- **Fix Round (PRs #29, #30, #31 MERGED into `main`):**
  - **Fix A (PR #29, `da04ea1`):** Disabled hardcoded ERP gantries; marked sample tariffs unverified; updated audit doc with LTA 30 Sep 2024 removal notice.
  - **Fix B (PR #30, `1c8fb19`):** Continuous speed-band logging with GCS streaming in `tools/speedbands/logger.ts`, `tools/speedbands/download.ts`, `docs/speedband-logging.md`.
  - **Fix C (PR #31, `d879413`):** Held-out benchmark (`tools/route-probe/probe.ts --holdout`, `tools/routing/benchmark-holdout.ts`); Free-Flow MAE 5.75%, Peak Traffic MAE 7.93%.
- **§8 Phase 4 Fix Round (PRs #32, #34 MERGED into `main`):**
  - **Fix D (PR #34, `3bda19f`):** Corrected held-out benchmark report (`tools/routing/benchmark-holdout.ts` and `tools/routing/out/benchmark-holdout.md`) with signed differences and forecast disclaimers.
  - **Fix E (PR #32, `62b9a76`):** Decoupled shadow mode, worker_threads background one-to-many search, traffic-aware routing, Cloud Run graph deployment tools, non-dominated alternatives pruning, honest money representation.
- **§9 Next Round (PRs #38, #39 MERGED into `main`):**
  - **Fix F (PR #38, `6641d63`):** Scheduled shadow probe across 10 fixed pairs 6x daily (`tools/routing/shadow-probe.ts`, `tools/routing/shadow-report.ts`, `docs/shadow-probe.md`).
  - **Fix G (PR #39, `efa4d1a`):** Single-route latency optimization via CSR, flat typed arrays, allocation-free speed profile slots, flat parallel binary heap, and fast incident bypassing. Original median latency: 42.5 ms (target < 200 ms: PASS); Held-out median latency: 177.4 ms (target < 200 ms: PASS).
  - **Fix J2 (PR #44, `41e7d42`) and the deploy doc / full via-way fix (PR #45, `4f82e0b`):** merged.
  - **Signal waits and corridor audit (PR #46):** on hold; see the note at the top.
  - **Fix H:** Waiting until on or after 2026-10-26 (requires 14 days of logged speed-band data).
- **Health (2026-10-21, `fix/routing-signal-delays` on top of `main` `4f82e0b`):** `npm run lint` clean · `npm test` 309/309 passing across 30 test suites · `npm run build` green · 0 secrets leaks.
- **PRs:**
  - PR #38: https://github.com/Sedilix/SafeSpot-SG/pull/38 (Fix F)
  - PR #39: https://github.com/Sedilix/SafeSpot-SG/pull/39 (Fix G)
  - PR #45: https://github.com/Sedilix/SafeSpot-SG/pull/45 (deploy doc + full via-way, merged)
  - PR #46: https://github.com/Sedilix/SafeSpot-SG/pull/46 (signal waits + corridor audit, on hold for Fix H)


---


# Hand-off Brief: SafeSpot.SG × Garmin fēnix 6S Pro Solar

Updated 2026-10-05 by Gemini after completing Step 3, then corrected by Claude Code after a security review. Supersedes previous hand-offs.
This file is intentionally **not** committed to the repo.

---

## 000. ⚠️ The user's watch is a fēnix 6 **Pro** Solar (Asia), not a 6S Pro

The original brief said `fenix6spro`, but the Connect IQ Store identified the watch as **"fenix6 Pro ASIA Solar"** and refused to install because only `fenix6spro` was targeted. Sideloading had hidden the mismatch.
* `manifest.xml` now targets **`fenix6pro`** (260×260; 6 Pro / Sapphire / Pro Solar / Pro Dual Power / quatix 6, with 5 part numbers) **and** `fenix6spro` (240×240). Version **0.3.0** (commit `b76f3ed` on `fix/watch-fenix6pro-support`).
* Use `-d fenix6pro` for simulator runs and tests. All screens were checked at 260×260.
* The app now updates via the **Connect IQ Store as a private beta** (uploaded by the user as "SafeSpot", developer Sedilix). Each update is a new `.iq` upload with a higher manifest version. Build it with `monkeyc -e -r -f monkey.jungle -o bin/SafeSpot.iq -y <key>`. Every version must be signed with the same developer key.
* The privacy policy is live at `/privacy` (PR #15).

## 00. Firebase project moved to `safespot-sg` (PR #9, 2026-10-05)

* SafeSpot's sign-in and Firestore now live in their **own** project, **`safespot-sg`** (Blaze billing). Cloud Run **still runs in `cybrdeck`** (same URLs, same `gcloud … --project cybrdeck` commands).
* **Fresh start:** no data or accounts were migrated. Old SafeSpot `Users` docs remain untouched in `cybrdeck`. **Don't read or copy them** without explicit user approval; they contain medical data.
* **Server:** `firebase-admin` uses `FIREBASE_PROJECT_ID`, defaulting to `safespot-sg`. Never fall back to `GCLOUD_PROJECT`, which is `cybrdeck` on Cloud Run. The Cloud Run service account `258662267000-compute@developer.gserviceaccount.com` has `roles/datastore.user` on `safespot-sg` (granted by the user).
* **Client:** `VITE_FIREBASE_*` GitHub secrets point at `safespot-sg` (no measurementId; no analytics).
* **Rules:** `firestore.rules` in the repo, deployed with `npx firebase-tools deploy --only firestore:rules --project safespot-sg`.
  * `Users`: owner only.
  * `Incidents`: `get` public by ID (for `/track`), never listable, create/update only by the owning `elderUid`.
  * Everything else: server-only.
  * `cybrdeck` never had an `Incidents` rule, so client-side incidents were denied there.
* **Auth:** Google ("SafeSpot.SG"), Anonymous, Phone. **SMS region policy: allow-list SG only.** Authorized domains include both Cloud Run hostnames.
* **PR #10:** the client Firestore uses `ignoreUndefinedProperties: true`, because a fresh Google profile has `phone: undefined`, which Firestore rejected. Because skipped fields aren't written, clear a field with `deleteField()`; see `clearWearableDeviceId` (used by unpair). The user confirmed profile save works on revision `safespot-sg-00035-mpk`.
* **Permission boundaries hit this session:** reading user PII and granting IAM roles were blocked by the permission system. Leave those to the user.

## 0. 🔴 Security: read before touching the pairing code

The pairing endpoints from PR #5 shipped to production **without authentication**. Three things made that exploitable:
* The repo is public.
* Every watch uses the fixed device ID `fenix-6s-solar` from `Config.mc`.
* `WEARABLE_TOKEN` is unset in production.

What that allowed, confirmed against the live server with no data displayed:
* `GET /api/wearable/pair/fenix-6s-solar` returned the elder's name, blood type, medical notes and emergency contacts to anyone.
* `POST /api/wearable/pair` let anyone replace the emergency contacts. Combined with an unauthenticated fake SOS, that sends Twilio SMS to arbitrary numbers on the owner's bill.

**Hotfix on `fix/wearable-pair-auth`: [Sedilix/SafeSpot-SG#7](https://github.com/Sedilix/SafeSpot-SG/pull/7). Open, conflicts resolved, safe to merge (token is set, watch reports Linked):**
* `POST /api/wearable/pair` and `GET /api/wearable/pair/:deviceId` require `Authorization: Bearer <Firebase ID token>`, verified with `firebase-admin`.
* The owner `uid` comes from the verified token; any `uid` in the request body is ignored.
* A paired device is locked to its owner. Reading a pairing requires ownership (404 if unpaired, because the fallback profile contains `WEARABLE_FALLBACK_PHONE`).
* In production (`NODE_ENV=production`), `/api/wearable/event` returns **503 when `WEARABLE_TOKEN` is unset** instead of accepting events. Development stays open for the simulator.
* Rules live in `src/utils/wearableAuth.ts` (tested). Helpers `getPairingOwner` and `verifyFirebaseIdToken` were added to `src/utils/wearableIncidentService.ts`, and `requireFirebaseUid` / `requirePairingAccess` to `server.ts`.

**Rollout order (critical):**
1. ✅ Done 2026-10-05:
   * `WEARABLE_TOKEN` was generated into `C:\Users\SIT EUC\wearable_token.txt` (outside the repo).
   * It was set as the GitHub secret `WEARABLE_TOKEN` (the deploy workflow passes it through with `--update-env-vars`) and applied to Cloud Run (project `cybrdeck`, revision `safespot-sg-00030-z5h`). Verified: no token → 401.
   * The same value is in the local `Config.mc`, which is marked `git update-index --skip-worktree` so it can't be committed. Run `git update-index --no-skip-worktree garmin/safespot-fenix/source/Config.mc` first if you need to commit a real change to that file, and **put `TOKEN = ""` back before committing**.
     * **Switching branches** fails with "local changes would be overwritten" whenever the target branch's `Config.mc` differs. Fast-forward local `main` with `git fetch origin main:main` before checking it out.
     * **To commit a real `Config.mc` change** without the token: write `HEAD`'s version plus your edit to a temp file, then `git hash-object -w <file>` and `git update-index --cacheinfo 100644,<hash>,garmin/safespot-fenix/source/Config.mc`. That clears skip-worktree, so re-run `git update-index --skip-worktree …` afterwards.
   * The watch `.prg` was rebuilt with the token. The user sideloads it.
2. Then merge the hotfix. Merging first, without the token set, would have made every watch event, including SOS, return 503.

**PR #6 was merged before the hotfix, so #7 now also covers it:**
* `main` was merged into `fix/wearable-pair-auth`. The only conflict was in `wearableIncidentService.ts`, where both sides added functions; both were kept.
* #6's `POST /api/wearable/unpair` and `DELETE /api/wearable/pair/:deviceId` now require a sign-in token and ownership (`handleUnpair` in `server.ts`).
* `ProfileModal.tsx` sends `Authorization: Bearer <ID token>` through `wearablePairingRequest`, no longer sends `uid`, and shows server errors. Before, it reported success even when a request was rejected.
* Until #7 deploys, #6's unpair routes are **live and unauthenticated**.

**Still open after the hotfix:**
* Replace the fixed `DEVICE_ID` with a random per-watch ID generated on first launch and stored in `Application.Storage`.
* Authenticate `GET /api/wearable/status` (it exposes live GPS). For example, scope it to a caregiver's incident link or a signed-in owner.
* `POST /api/wearable/checkin` is rate-limited but anonymous.
* Have the user verify the live pairing still lists their own contacts: it may have been changed while it was open.

---

## 1. Where things stand

* **Branch:** `main` at `a809149` (PR #6 merged). Hotfix #7 open on `fix/wearable-pair-auth`.
* **Repo:** GitHub `Sedilix/SafeSpot-SG` (local `origin` still points to `Build-w-Gemini-22-Aug`; GitHub redirects).
* **Latest:** `main` at `af24bc1`, with #7 (pairing auth) and #8 (watch request timeout) merged and deployed (revision `safespot-sg-00033-zbt`). The #8 watch build must be sideloaded by the user.
* **Merged PRs:**
  * `Sedilix/SafeSpot-SG#1`: wearable server endpoints, Connect IQ watch app, caregiver card.
  * `Sedilix/SafeSpot-SG#2`: watch fall detection and heart-rate alerts.
  * `Sedilix/SafeSpot-SG#3`: periodic 5-minute background check-in and caregiver prompt.
  * `Sedilix/SafeSpot-SG#4`: resolve audit findings for check-in safety (START = SOS preserved, UP/DOWN = OK), unknown device auth rejection, 30s rate limiting, and 7-min stale timing.
  * `Sedilix/SafeSpot-SG#5`: server-side incident creation & Twilio SMS alerts to caregivers with Firestore pairing and Cloud Run secrets.
* **Security hotfix (Claude Code):** `Sedilix/SafeSpot-SG#7` (branch `fix/wearable-pair-auth`). #6 is already merged; #7 includes the fixes #6 needed. **Read §0 first.**
* **Also merged:**
  * `Sedilix/SafeSpot-SG#6`: Step 3 — watch/phone pairing UI in ProfileModal, multi-source location fusion (BLE beacon vs watch GNSS vs phone GPS), caregiver tracker source badges, and watch PairingInfoView.
* **Deployed:** PR #1 through #5 are live on Cloud Run (`https://safespot-sg-258662267000.asia-southeast1.run.app`).
* **Health:** `npm run lint` clean · `npm test` 147/147 passing · `npm run build` passes · Monkey C build 0 warnings.
* **On the physical watch:** `garmin/safespot-fenix/bin/SafeSpot.prg` is freshly compiled and ready for USB sideload to `GARMIN/APPS/`.

---

## 2. What exists

### Server (`server.ts`, logic in `src/utils/wearable.ts`)
* `POST /api/wearable/event` (`server.ts:1692`):
  * Event types: `SOS_TRIGGER`, `SOS_CANCEL`, `HEARTBEAT`, `FALL_DETECTED`, `HR_ALERT`.
  * Validates the body with `parseWearableEvent`, folds it into the stored state with `applyWearableEvent`, and finds the nearest landmark from `SINGAPORE_PRESET_PLACES` within 1.5 km.
  * Replies `{status:"acknowledged", sosActive, landmark}`.
* **Optional auth:** if the `WEARABLE_TOKEN` env var is set, requests must send the header `X-SafeSpot-Token`. **It is currently NOT set in production.**
* `GET /api/wearable/status`: returns every device with `online` = seen recently (stale window changed to 7 min in PR #4). **Unauthenticated, and it exposes the watch's GPS position.**
* Pairing, check-in and (in #6) unpair endpoints: see §0 for their auth status.
* *Line numbers in this section predate PRs #3–#5; search by route name instead.*
* **Alert state:** `alertReason` is `manual`, `fall` or `heartRate`. The first reason is kept while an alert stays active; `SOS_CANCEL` clears it.
* **Storage:** state lives in an in-memory `Map` (`server.ts:1686`). It is lost on restart or scale-to-zero and is not shared across Cloud Run instances.
* **Tests:** `src/utils/wearable.test.ts`.

### Caregiver UI
* `src/components/WearableStatusCard.tsx`:
  * Rendered at the top of `CaregiverLiveTracker` (`/track/:incidentId`).
  * Polls the status endpoint every 10 s.
  * Shows a reason-specific red banner, HR, battery, landmark and a map link.
* Translation keys `wearable.*` exist in en/zh/ms/ta (`src/locales/translations.ts`).

### Watch app (`garmin/safespot-fenix/`)
* **`Config.mc`:**
  * `SERVER_URL` points at the Cloud Run HTTPS URL.
  * `TOKEN = ""`. Set it locally before building if `WEARABLE_TOKEN` is enabled, and never commit it.
  * Also holds all the thresholds.
* **`SafeSpotModel.mc`:**
  * One 1 Hz timer drives everything.
  * At most one web request is in flight at a time; SOS and cancel requests retry every 5 s until the server acknowledges.
  * Heartbeat every 60 s.
  * Every alert source follows the same path: countdown → send `alertEvent`.
* **Buttons:**
  * START (`onSelect`): opens a 10 s countdown; a second press sends immediately.
  * BACK during the countdown: cancels.
  * BACK after sending: a "Cancel SOS? I'm OK" confirmation, then `SOS_CANCEL`.
* **`FallDetector.mc`:**
  * Reads the accelerometer at 25 Hz.
  * A fall needs all three: a drop (<0.5 G), an impact (>3 G) within 1 s, then 10 s of near-stillness after a 2 s settle.
  * Automatic alerts use a 30 s "Are you OK?" countdown.
* **HR alert:** fires on <40 bpm, or >150 bpm while still (accelerometer), sustained for 60 s; 10 min quiet period after a dismissal.
* **`FallDetectorTest.mc`:** unit tests. Helpers live in a `(:test) class FallTrace` so the runner doesn't execute them as tests.

---

## 3. Toolchain (all verified on this machine)

| | |
|---|---|
| SDK 9.2.0 | `C:\Users\SIT EUC\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2` |
| Device | `fenix6spro`: API 3.4, 240×240 round MIP, watch-app memory limit 1.25 MB (app uses ~16 kB), **background limit 32 kB** |
| Signing key | `C:\Users\SIT EUC\garmin_developer_key.der`. A copy sits in the repo root and is gitignored (`*.der`). **Never commit it.** |
| JDK | `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot` (set `JAVA_HOME` and put its `bin` on `PATH` before running monkeyc) |

```powershell
$sdk="C:\Users\SIT EUC\AppData\Roaming\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.2.0-2026-06-09-92a1605b2\bin"
$p="C:\Users\SIT EUC\Documents\Builds\Build-w-Gemini-22-Aug\garmin\safespot-fenix"
# Release build (use full paths; -l 2 = informative type checking)
& "$sdk\monkeyc.bat" -d fenix6spro -f "$p\monkey.jungle" -o "$p\bin\SafeSpot.prg" -y "C:\Users\SIT EUC\garmin_developer_key.der" -l 2 -w
# Unit tests: build with -t, the simulator must already be running, Windows-style /t flag
& "$sdk\monkeyc.bat" -d fenix6spro -f "$p\monkey.jungle" -o "$p\bin\SafeSpotTest.prg" -y "C:\Users\SIT EUC\garmin_developer_key.der" -t
& "$sdk\monkeydo.bat" "$p\bin\SafeSpotTest.prg" fenix6spro /t
```
**Sideload:** connect the watch by USB, then copy `bin\SafeSpot.prg` into `GARMIN\APPS\`. Sideloaded apps never auto-update, so every watch-side change needs a re-copy.
**Rollout order:** merge first and wait for the deploy, *then* sideload. Otherwise new event types get a 400 from the old server.

---

## 4. Lessons learned (save yourself the debugging)

* **Garmin error codes seen:**
  * `-400`: the response body wasn't JSON. Here it meant the server hadn't deployed the endpoint yet, so Express returned an HTML 404.
  * `-1001`: HTTPS required. The simulator enforces this; untick *Settings → Use Device HTTPS Requirements* to test against `http://localhost`.
  * `-2` / `-3`: BLE host/server timeout. Usually the phone was out of range or the Garmin Connect app was asleep. The watch now shows these as "Phone slow".
  * `-104`: no phone connected ("No phone").
* **Web requests go watch → Bluetooth → Garmin Connect app on the phone → internet.** Bluetooth range is about 10 m line of sight, less through walls or the wearer's body. No phone nearby means no SOS delivery (it retries until the phone is back). The fēnix 6S Pro has no LTE.
* **Scratch/simulator builds hit production.** `SERVER_URL` and `DEVICE_ID` come from the real `Config.mc`, so a scratch simulator build posts to the live server as `fenix-6s-solar`. On 2026-10-05 one did this for about 2 hours, mixing with the real watch's state and showing a false fall alert. In scratch copies, always change `SERVER_URL` to localhost **and** `DEVICE_ID` to something like `sim-test`. Close the simulator when done.
* **Connected to Garmin Express (USB)** the watch runs no Connect IQ apps and sends nothing. "Linked" on screen only reflects the *last* response, so it can be stale. Check Cloud Run request logs (`httpRequest.userAgent:"Golf"` = Garmin Connect on iOS relaying the watch) to see real traffic.
* **Simulator automation:** the simulator window usually sits behind other windows, so `SendKeys` doesn't reach it. `PrintWindow` captures it fine. To screenshot a particular screen, build a scratch copy whose `start()` jumps straight to that state.
* **Monkey C typing:** `makeWebRequest` params need `Dictionary<Object, Object>`, not `<String, Object>`. A private method named like an API symbol (e.g. `vibrate`) triggers a warning with `has :vibrate`.
* **Background limits** (verified in SDK docs at `<sdk>\doc\Toybox\*.html`):
  * Temporal events can't fire less than 5 minutes apart.
  * `Communications` and `Sensor` are available in background.
  * `Attention` (vibrate/backlight) is **not**.
  * `Position` lists no background context. Assume no fresh GPS in background; persist the last fix with `Application.Storage` from the foreground. Confirm with a prototype.
  * No continuous accelerometer stream in background, so **fall detection only works while the app is open on screen**.
  * `Background.requestApplicationWake(msg)` can prompt the user to open the app.

---

## 5. Plan status (Steps 1–3 merged)

The user asked how to make the app work in the background and tie it into the locating features. Proposed plan, in order:

### Step 1: Background check-in (watch) (Implemented in PRs #3 and #4)
* Add a `(:background)` `ServiceDelegate` with `Background.registerForTemporalEvent(new Time.Duration(300))`. Add the `Background` permission to `manifest.xml`.
* Every 5 minutes: POST `HEARTBEAT` with the latest HR (`Sensor`/`SensorHistory`), battery, and the last GPS fix saved by the foreground app in `Application.Storage`. Include a field telling the server the position is stale, e.g. `positionAge`.
* Keep the background code under **32 kB**. Annotate only what the service needs with `(:background)`.
* Server: add a caregiver-requested **check-in** flag, e.g. `POST /api/wearable/checkin`, and return `checkInRequested: true` in the event ack. When the background service sees it, call `Background.requestApplicationWake("Caregiver asks: are you OK?")`. Opening the app then gives a fresh GPS fix and an "I'm OK" (a new `CHECK_IN_OK` event).

### Step 2: Make a watch SOS actually notify someone (Implemented in PR #5)
* **Implemented:**
  * Added `firebase-admin` with Google Cloud ADC support on Cloud Run.
  * Extracted Twilio SMS dispatch into shared module `src/utils/notifications.ts` (`sendTwilioSms`).
  * On `SOS_TRIGGER`, `FALL_DETECTED`, or `HR_ALERT`, server creates an incident in Firestore `Incidents/{incidentId}` with live GPS, reverse geocoding, nearest landmarks, battery, and alert type.
  * Queries Firestore `WearableDevices/{deviceId}` for paired senior profile and emergency contacts; sends high-urgency SMS with Google Maps and live `/track/:incidentId` link.
  * Ongoing heartbeats update incident GPS; `SOS_CANCEL` marks incident resolved and sends cancellation confirmation SMS.
  * Added pairing endpoints `POST /api/wearable/pair` and `GET /api/wearable/pair/:deviceId`.
  * Fixed caregiver header display on `/track/:id` to handle loading and alert badges properly.
* **Merged and deployed:** [Sedilix/SafeSpot-SG#5](https://github.com/Sedilix/SafeSpot-SG/pull/5). Its pairing endpoints were unauthenticated; see §0.

### Step 3: Pair the watch and combine watch + phone locations (Implemented in PR #6)
* **Implemented:**
  * Added dedicated **Garmin Watch Pairing** card in `src/components/ProfileModal.tsx`:
    * Real-time connection status (Online/Offline, battery percentage, heart rate) polled directly from `/api/wearable/status?deviceId=...`.
    * Bi-directional pairing saving `wearableDeviceId` to `Users/{uid}` in Firestore and calling `/api/wearable/pair`.
    * One-tap unpairing via `/api/wearable/unpair` and `DELETE /api/wearable/pair/:deviceId`.
  * Built **Multi-Source Location Fusion Engine** (`src/utils/locationFusion.ts`):
    * 1. Indoor/HDB Surveyed BLE Micro-Location: In multi-story HDB blocks and transit concourses where satellite signals drop or bounce, a nearby surveyed venue beacon (<5m) takes top priority, giving sub-3m accuracy, `venueName`, and `floorLevel`.
    * 2. Garmin Watch Multi-GNSS: Outdoors, fresh watch GPS (<3 min / 180s) is prioritized because wrist hardware has unobstructed sky view.
    * 3. Phone GPS Fallback: Used when the watch is offline, indoors without beacons, or when the watch fix is stale.
  * **Caregiver Live Tracker Integration:**
    * Prominent **Location Source Badge** under the map (`Garmin Outdoor GPS (±15m)`, `BLE Beacon Micro-Location (Floor Precision • ±3m)`, or `Phone GPS`).
    * Floor Level Badge (e.g. `Floor / Level: Level 1 (Ground)`) and venue name for ambulance drivers and family responders.
    * Scoped telemetry: passes `deviceId={incident?.deviceId}` to `WearableStatusCard`.
  * **Garmin Watch App:**
    * Added `PairingInfoView.mc`: pressing MENU (holding UP) or UP/DOWN on idle displays the watch's exact `Config.DEVICE_ID` and pairing steps.
  * **Full 4-Language i18n:** Added en, zh, ms, ta translations for all pairing and fusion keys.
* **Merged:** [Sedilix/SafeSpot-SG#6](https://github.com/Sedilix/SafeSpot-SG/pull/6). Its unpair routes and pairing calls are secured by #7; see §0.

### No-code backstop to suggest to the user
In the Garmin Connect app under *Safety & Tracking*:
* Enable **Assistance** (hold LIGHT to send location to emergency contacts).
* Enable **Incident Detection** (background, but only during GPS activities).

These alert Garmin contacts, not SafeSpot, so they're a backstop rather than a replacement. Also suggest putting SafeSpot first in the app list: from the watch face, START → START opens it, then START again for SOS.

---

## 6. Open issues to keep in mind
 
* **Critical:** `WEARABLE_TOKEN` is not set in production. Since PR #5, a fake event sends real SMS to caregivers. The hotfix makes production fail closed; see §0 for the rollout order. `GET /api/wearable/status` still exposes watch GPS without auth.
* Wearable state cache in `server.ts` is in-memory with Firestore backing for incidents and pairings. Active incident state is recovered via `getActiveIncidentForDevice` on cold starts.
* **Resolved in PR #5 & #6:** On `/track/:id`, the header now accurately handles loading state and displays incident type badges (SOS, Fall, HR Alert, Crash) and Location Source Badges (BLE beacon, Garmin outdoor GNSS, Phone GPS).
* Fall and HR thresholds are baseline approximations. Tune them from wearer feedback; the constants are in `FallDetector.mc` and `Config.mc`.
* Pulse Ox (SpO2) was discussed but not implemented.

## 7. Working conventions in this repo

* Conventional-commit messages (`feat(wearable): …`).
* Work on a feature branch, push it, open a PR to `main`. The user merges the PR themselves (merging deploys).
* Keep i18n complete across en/zh/ms/ta for any user-facing string.
* Run `npm run lint && npm test && npm run build`, plus the Monkey C build and tests, before opening a PR.
