# SafeSpot LTA Speed-Band Historical Data Logger

Fetches Singapore Land Transport Authority (LTA) DataMall `v4/TrafficSpeedBands` across all links every 5 minutes and appends compact records to daily gzip files.

## Output Format & Storage

- Storage path: `tools/speedbands/data/speedbands-YYYY-MM-DD.jsonl.gz` (gitignored).
- Each snapshot captures all ~143,000 LinkIDs in Singapore.
- Each record in the JSONL stream:
  ```json
  {"ts": 1728320400000, "linkId": "2", "band": 4, "min": 30, "max": 39}
  ```
- **Compression**: Gzip level 9 using RFC 1952 concatenated gzip members. Daily compressed files are typically ~10–15 MB for a full 24-hour cycle (288 snapshots × 143k links).
- Decompress with standard tools:
  ```bash
  gzip -dc tools/speedbands/data/speedbands-2026-10-06.jsonl.gz | head -n 5
  ```

## Running

### Single Snapshot (Test / Scheduled Task)
```bash
npx tsx tools/speedbands/logger.ts --once
```

### Continuous Daemon (Runs Every 5 Minutes)
```bash
npx tsx tools/speedbands/logger.ts
```
Custom interval (e.g. 10 minutes = 600s):
```bash
npx tsx tools/speedbands/logger.ts --interval=600
```

## Scheduling Recipes

### Windows Task Scheduler (Recommended on Windows)
Run every 5 minutes using PowerShell:

```powershell
$action = New-ScheduledTaskAction -Execute "npx.cmd" -Argument "tsx tools/speedbands/logger.ts --once" -WorkingDirectory "C:\Users\SIT EUC\Documents\Builds\safespot-routing"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "SafeSpot-Speedbands-Logger" -Action $action -Trigger $trigger -Description "SafeSpot LTA Speed-Bands Snapshot Logger"
```

To stop or unregister:
```powershell
Unregister-ScheduledTask -TaskName "SafeSpot-Speedbands-Logger" -Confirm:$false
```

### Linux / Mac Cron Recipe
Add to crontab (`crontab -e`):
```cron
*/5 * * * * cd /path/to/safespot-routing && /usr/bin/npx tsx tools/speedbands/logger.ts --once >> tools/speedbands/logger.log 2>&1
```

## Error Resilience & Retries

- Exponential backoff retry on HTTP or network timeout (3 attempts per page).
- If an entire cycle encounters network failure, it logs a warning with timestamp and continues to wait for the next interval without crashing.
