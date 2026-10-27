/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * download-holdout.ts: Downloads 15-minute slot speed-band snapshots for the held-out days
 * (2026-10-23 Friday through 2026-10-26 Monday) from Google Cloud Storage.
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Storage } from '@google-cloud/storage';

const BUCKET_NAME = process.env.SPEEDBANDS_BUCKET || 'safespot-sg-speedbands';
const RAW_DIR = join(process.cwd(), 'tools', 'speedbands', 'data', 'raw');

const HOLDOUT_DAYS = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'];

export async function downloadHoldoutSnapshots() {
  const storage = new Storage();
  const bucket = storage.bucket(BUCKET_NAME);

  console.log(`Connecting to gs://${BUCKET_NAME}...`);

  for (const day of HOLDOUT_DAYS) {
    const dayDir = join(RAW_DIR, day);
    mkdirSync(dayDir, { recursive: true });

    console.log(`Scanning snapshots for ${day}...`);
    const [files] = await bucket.getFiles({ prefix: `speedbands/${day}/` });

    // Filter to 15-minute slots: 00, 15, 30, 45
    const slotFiles = files.filter((f) => /(00|15|30|45)\.jsonl\.gz$/.test(f.name));
    console.log(`  Found ${slotFiles.length} 15-minute slot snapshots for ${day}.`);

    let downloaded = 0;
    for (const f of slotFiles) {
      const fileName = f.name.split('/').pop()!;
      const dest = join(dayDir, fileName);
      if (!existsSync(dest)) {
        await f.download({ destination: dest });
        downloaded++;
      }
    }
    console.log(`  Downloaded ${downloaded} new files into ${dayDir}.`);
  }

  console.log('\nHoldout snapshot download complete!');
}

const isMain = process.argv[1] && (process.argv[1].endsWith('download-holdout.ts') || process.argv[1].endsWith('download-holdout.js'));
if (isMain) {
  downloadHoldoutSnapshots().catch((err) => {
    console.error('Fatal download error:', err.message);
    process.exit(1);
  });
}
