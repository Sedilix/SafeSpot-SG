/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * download.ts: Downloads LTA Traffic Speed Bands snapshots from Google Cloud Storage
 * (gs://<bucket>/speedbands/YYYY-MM-DD/HHmm.jsonl.gz) to local disk for building
 * historical speed profiles per ROUTING_PLAN.md §7 Fix B.
 *
 * Usage:
 *   npx tsx tools/speedbands/download.ts [--bucket=safespot-sg-speedbands] [--days=14] [--out=tools/speedbands/data]
 */

import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

export interface DownloadOptions {
  bucketName?: string;
  outDir?: string;
  days?: number;
  mergeDaily?: boolean;
}

const DEFAULT_OUT_DIR = join(process.cwd(), 'tools', 'speedbands', 'data');
const DEFAULT_BUCKET = process.env.SPEEDBANDS_BUCKET || 'safespot-sg-speedbands';

/**
 * Downloads speed-band snapshots from Google Cloud Storage.
 */
export async function downloadSpeedbandsFromGcs(options: DownloadOptions = {}): Promise<{ totalFiles: number; totalBytes: number; daysProcessed: string[] }> {
  const bucketName = options.bucketName || DEFAULT_BUCKET;
  const outDir = options.outDir || DEFAULT_OUT_DIR;
  const daysLimit = options.days;
  const mergeDaily = options.mergeDaily !== false; // Default true

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  console.log(`Connecting to GCS bucket gs://${bucketName}...`);
  const { Storage } = await import('@google-cloud/storage');
  const storage = new Storage();
  const bucket = storage.bucket(bucketName);

  // Filter by date cutoff if --days is specified
  let cutoffDateStr: string | null = null;
  if (daysLimit && daysLimit > 0) {
    const cutoffDate = new Date(Date.now() - daysLimit * 24 * 3600 * 1000);
    cutoffDateStr = cutoffDate.toISOString().slice(0, 10);
    console.log(`Filtering for snapshots since ${cutoffDateStr} (last ${daysLimit} days)...`);
  }

  const [files] = await bucket.getFiles({ prefix: 'speedbands/' });
  console.log(`Discovered ${files.length} remote snapshot files in gs://${bucketName}/speedbands/`);

  // Group files by date (speedbands/YYYY-MM-DD/HHmm.jsonl.gz)
  const filesByDate = new Map<string, typeof files>();
  for (const file of files) {
    const parts = file.name.split('/');
    if (parts.length >= 3 && parts[0] === 'speedbands') {
      const dateStr = parts[1];
      if (cutoffDateStr && dateStr < cutoffDateStr) {
        continue;
      }
      if (!filesByDate.has(dateStr)) {
        filesByDate.set(dateStr, []);
      }
      filesByDate.get(dateStr)!.push(file);
    }
  }

  let totalFiles = 0;
  let totalBytes = 0;
  const daysProcessed: string[] = [];

  const sortedDates = Array.from(filesByDate.keys()).sort();
  for (const dateStr of sortedDates) {
    const dateFiles = filesByDate.get(dateStr)!;
    // Sort chronologically by filename (HHmm.jsonl.gz)
    dateFiles.sort((a, b) => a.name.localeCompare(b.name));

    console.log(`Processing date ${dateStr} (${dateFiles.length} snapshots)...`);
    const dailyFilePath = join(outDir, `speedbands-${dateStr}.jsonl.gz`);

    if (mergeDaily) {
      // Stream and concatenate each gzip buffer into the daily file
      let dayBytes = 0;
      // Truncate or start fresh daily file
      writeFileSync(dailyFilePath, Buffer.alloc(0));

      for (const file of dateFiles) {
        const [contents] = await file.download();
        appendFileSync(dailyFilePath, contents);
        dayBytes += contents.length;
        totalFiles++;
      }

      totalBytes += dayBytes;
      daysProcessed.push(dateStr);
      console.log(`  -> Wrote ${dailyFilePath} (${(dayBytes / (1024 * 1024)).toFixed(2)} MB, ${dateFiles.length} snapshots).`);
    } else {
      // Download raw snapshots into subfolder
      const rawDateDir = join(outDir, 'raw', dateStr);
      mkdirSync(rawDateDir, { recursive: true });

      for (const file of dateFiles) {
        const fileName = file.name.split('/').pop()!;
        const dest = join(rawDateDir, fileName);
        await file.download({ destination: dest });
        totalFiles++;
      }
      daysProcessed.push(dateStr);
    }
  }

  console.log(`\nDownload completed: ${totalFiles} snapshots across ${daysProcessed.length} days (${(totalBytes / (1024 * 1024)).toFixed(2)} MB).`);
  return { totalFiles, totalBytes, daysProcessed };
}

const isMain = process.argv[1] && (process.argv[1].endsWith('download.ts') || process.argv[1].endsWith('download.js'));
if (isMain) {
  const args = process.argv.slice(2);
  const bucketArg = args.find(a => a.startsWith('--bucket='));
  const bucketName = bucketArg ? bucketArg.split('=')[1] : DEFAULT_BUCKET;

  const outArg = args.find(a => a.startsWith('--out='));
  const outDir = outArg ? outArg.split('=')[1] : DEFAULT_OUT_DIR;

  const daysArg = args.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : undefined;

  downloadSpeedbandsFromGcs({ bucketName, outDir, days }).catch(err => {
    console.error('Fatal download error:', err.message);
    process.exit(1);
  });
}
