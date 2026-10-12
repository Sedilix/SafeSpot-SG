/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * upload-graph.ts: Compresses and prepares the road graph for Cloud Run deployment.
 *
 * Compresses data/graph/singapore-road-graph.json to .gz and outputs copy-paste gcloud
 * commands for deploying to GCS gs://safespot-sg-speedbands/graph/<YYYY-MM-DD>/.
 */

import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';

const RAW_GRAPH = join(process.cwd(), 'data', 'graph', 'singapore-road-graph.json');
const GZ_GRAPH = join(process.cwd(), 'data', 'graph', 'singapore-road-graph.json.gz');

export function prepareGraphArchive(): { rawMb: number; gzMb: number; gzPath: string } {
  if (!existsSync(RAW_GRAPH)) {
    throw new Error(`Road graph not found at ${RAW_GRAPH}. Build it first with: npx tsx tools/osm/build-graph.ts`);
  }

  const rawBytes = readFileSync(RAW_GRAPH);
  const rawMb = Number((rawBytes.length / 1e6).toFixed(2));

  console.log(`Compressing ${RAW_GRAPH} (${rawMb} MB)...`);
  const gzBytes = gzipSync(rawBytes, { level: 9 });
  writeFileSync(GZ_GRAPH, gzBytes);
  const gzMb = Number((gzBytes.length / 1e6).toFixed(2));

  console.log(`Created ${GZ_GRAPH} (${gzMb} MB, ${(gzMb / rawMb * 100).toFixed(1)}% of original size).`);
  return { rawMb, gzMb, gzPath: GZ_GRAPH };
}

async function main() {
  const { rawMb, gzMb, gzPath } = prepareGraphArchive();
  const today = new Date().toISOString().slice(0, 10);
  const targetUri = `gs://safespot-sg-speedbands/graph/${today}/singapore-road-graph.json.gz`;

  console.log('\n======================================================');
  console.log('CLOUD RUN GRAPH DEPLOYMENT COMMANDS (FOR USER TO RUN)');
  console.log('======================================================\n');

  console.log('1. Upload road graph to GCS:');
  console.log(`   gcloud storage cp "${gzPath}" "${targetUri}"\n`);

  console.log('2. Grant Cloud Run service account access to read graph from bucket:');
  console.log('   gcloud storage buckets add-iam-policy-binding gs://safespot-sg-speedbands \\');
  console.log('     --member="serviceAccount:258662267000-compute@developer.gserviceaccount.com" \\');
  console.log('     --role="roles/storage.objectViewer"\n');

  console.log('3. Update Cloud Run service environment and memory allocation (--memory 1Gi):');
  console.log('   gcloud run services update safespot-sg \\');
  console.log('     --region asia-southeast1 \\');
  console.log('     --project cybrdeck \\');
  console.log(`     --update-env-vars ROUTING_GRAPH_URI=${targetUri},ROUTING_SHADOW_DRIVE=1 \\`);
  console.log('     --memory 1Gi\n');

  console.log('======================================================');
}

if (process.argv[1] && process.argv[1].endsWith('upload-graph.ts')) {
  main().catch((err) => {
    console.error('[UPLOAD-GRAPH] Failed:', err);
    process.exit(1);
  });
}
