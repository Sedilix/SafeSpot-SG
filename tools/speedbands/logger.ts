/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Speed-band logger: Fetches LTA DataMall v4/TrafficSpeedBands across all pages
 * every 5 minutes and appends compact records {ts, linkId, band, min, max} to
 * daily gzip files under tools/speedbands/data/speedbands-YYYY-MM-DD.jsonl.gz.
 *
 * Usage:
 *   npx tsx tools/speedbands/logger.ts --once
 *   npx tsx tools/speedbands/logger.ts [--interval=300]
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';

export interface CompactSpeedRecord {
  ts: number;     // Epoch timestamp in milliseconds
  linkId: string; // LTA LinkID
  band: number;   // SpeedBand (1-8)
  min: number;    // Minimum speed in km/h
  max: number;    // Maximum speed in km/h
}

export interface LoggerOptions {
  dataDir?: string;
  intervalSeconds?: number;
  once?: boolean;
  apiKey?: string;
  concurrency?: number;
}

const DEFAULT_DATA_DIR = join(process.cwd(), 'tools', 'speedbands', 'data');
const BASE_URL = 'https://datamall2.mytransport.sg/ltaodataservice/v4/TrafficSpeedBands';
const PAGE_SIZE = 500;
const MAX_RETRIES = 3;

/**
 * Resolves the LTA DataMall AccountKey without leaking secrets.
 */
export function resolveLtaKey(explicitKey?: string): string {
  if (explicitKey && explicitKey.trim()) {
    return explicitKey.trim();
  }
  if (process.env.LTA_DATAMALL_KEY && process.env.LTA_DATAMALL_KEY.trim()) {
    return process.env.LTA_DATAMALL_KEY.trim();
  }
  const keyFile = 'C:/Users/SIT EUC/lta_datamall_key.txt';
  if (existsSync(keyFile)) {
    const fromFile = readFileSync(keyFile, 'utf8').trim();
    if (fromFile) return fromFile;
  }
  throw new Error('LTA DataMall key not found. Set LTA_DATAMALL_KEY or create C:/Users/SIT EUC/lta_datamall_key.txt');
}

/**
 * Fetches a single page of speed bands with exponential backoff retry.
 */
async function fetchPageWithRetry(skip: number, apiKey: string): Promise<any[]> {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      const url = `${BASE_URL}?$skip=${skip}`;
      const res = await fetch(url, {
        headers: {
          AccountKey: apiKey,
          accept: 'application/json',
          'User-Agent': 'SafeSpot-SG-speedbands-logger/1.0'
        }
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = (await res.json()) as any;
      return data.value || [];
    } catch (err: any) {
      attempt++;
      if (attempt >= MAX_RETRIES) {
        throw new Error(`Failed to fetch skip=${skip} after ${MAX_RETRIES} attempts: ${err.message}`);
      }
      const delayMs = Math.pow(2, attempt) * 500;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return [];
}

/**
 * Fetches all pages of v4/TrafficSpeedBands using concurrent batches.
 */
export async function fetchAllSpeedBands(apiKey: string, concurrency: number = 6): Promise<CompactSpeedRecord[]> {
  const records: CompactSpeedRecord[] = [];
  const snapshotTs = Date.now();
  let currentSkip = 0;
  let hasMore = true;

  while (hasMore) {
    const batchSkips: number[] = [];
    for (let i = 0; i < concurrency; i++) {
      batchSkips.push(currentSkip + (i * PAGE_SIZE));
    }

    const results = await Promise.all(
      batchSkips.map(skip => fetchPageWithRetry(skip, apiKey))
    );

    for (let i = 0; i < results.length; i++) {
      const page = results[i];
      for (const item of page) {
        records.push({
          ts: snapshotTs,
          linkId: String(item.LinkID),
          band: Number(item.SpeedBand) || 0,
          min: Number(item.MinimumSpeed) || 0,
          max: Number(item.MaximumSpeed) || 0
        });
      }

      if (page.length < PAGE_SIZE) {
        hasMore = false;
        break;
      }
    }

    currentSkip += concurrency * PAGE_SIZE;
  }

  return records;
}

/**
 * Appends a list of compact speed records as compressed JSONL to the daily file.
 */
export function appendSnapshotToGzip(records: CompactSpeedRecord[], dataDir: string = DEFAULT_DATA_DIR): { filePath: string; bytesWritten: number } {
  if (records.length === 0) {
    return { filePath: '', bytesWritten: 0 };
  }

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const dateStr = new Date(records[0].ts).toISOString().slice(0, 10);
  const fileName = `speedbands-${dateStr}.jsonl.gz`;
  const filePath = join(dataDir, fileName);

  let bufferStr = '';
  for (const r of records) {
    bufferStr += JSON.stringify(r) + '\n';
  }

  const compressed = gzipSync(Buffer.from(bufferStr, 'utf8'), { level: 9 });
  appendFileSync(filePath, compressed);
  return { filePath, bytesWritten: compressed.length };
}

/**
 * Executes a single snapshot fetch and write cycle with error containment.
 */
export async function runSnapshotCycle(options: LoggerOptions = {}): Promise<boolean> {
  const startMs = Date.now();
  const dataDir = options.dataDir || DEFAULT_DATA_DIR;

  try {
    const key = resolveLtaKey(options.apiKey);
    const records = await fetchAllSpeedBands(key, options.concurrency || 6);

    const { filePath, bytesWritten } = appendSnapshotToGzip(records, dataDir);
    const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);

    const logTs = new Date().toISOString();
    console.log(`[${logTs}] Snapshot completed: ${records.length} links in ${durationSec}s. Wrote ${(bytesWritten / 1024).toFixed(1)} KB to ${filePath}`);
    return true;
  } catch (err: any) {
    const logTs = new Date().toISOString();
    console.error(`[${logTs}] Snapshot error (will retry next cycle): ${err.message}`);
    return false;
  }
}

/**
 * Main daemon loop.
 */
export async function startLoggerDaemon(options: LoggerOptions = {}): Promise<void> {
  const intervalSec = options.intervalSeconds || 300;
  console.log(`Starting SafeSpot speed-band logger (interval: ${intervalSec}s, once: ${!!options.once})...`);

  await runSnapshotCycle(options);

  if (options.once) {
    return;
  }

  setInterval(async () => {
    await runSnapshotCycle(options);
  }, intervalSec * 1000);
}

const isMain = process.argv[1] && (process.argv[1].endsWith('logger.ts') || process.argv[1].endsWith('logger.js'));
if (isMain) {
  const args = process.argv.slice(2);
  const once = args.includes('--once');
  const intervalArg = args.find(a => a.startsWith('--interval='));
  const intervalSeconds = intervalArg ? parseInt(intervalArg.split('=')[1], 10) : 300;

  startLoggerDaemon({ once, intervalSeconds }).catch(err => {
    console.error('Fatal logger startup error:', err);
    process.exit(1);
  });
}
