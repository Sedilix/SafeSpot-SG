/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * driveWorkerClient.ts: Client manager for the isolated drive routing worker thread.
 *
 * Manages worker lifecycle, GCS graph downloading, 3s timeout enforcement,
 * and rate limiting (max 1 concurrent shadow search).
 */

import { Worker } from 'worker_threads';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import { TrafficIncident } from './incidents';

export interface RouteManyTarget {
  id: string;
  lat: number;
  lng: number;
}

export interface RouteManyOptions {
  departureTime?: Date;
  liveIncidents?: TrafficIncident[];
}

export interface DriveWorkerResult {
  results: Map<string, { seconds: number; meters: number } | null>;
  durationMs: number;
}

export class DriveWorkerClient {
  private static instance: DriveWorkerClient | null = null;
  private worker: Worker | null = null;
  private isReady = false;
  private isBusy = false;
  private hasLoggedNotReady = false;
  private downloadPromise: Promise<string | null> | null = null;
  private pendingRequestId = 0;
  private pendingRequests = new Map<
    string,
    {
      resolve: (val: DriveWorkerResult) => void;
      reject: (err: any) => void;
      timer: NodeJS.Timeout;
    }
  >();

  public static getInstance(): DriveWorkerClient {
    if (!DriveWorkerClient.instance) {
      DriveWorkerClient.instance = new DriveWorkerClient();
    }
    return DriveWorkerClient.instance;
  }

  private constructor() {
    this.init().catch((err) => {
      console.warn('[DRIVE_WORKER] Initialization background error:', err.message);
    });
  }

  /**
   * Downloads graph from GCS if ROUTING_GRAPH_URI is set, or locates local graph.
   */
  public async resolveGraphPath(): Promise<string | null> {
    if (this.downloadPromise) return this.downloadPromise;

    this.downloadPromise = (async () => {
      const uri = process.env.ROUTING_GRAPH_URI;
      if (uri && uri.startsWith('gs://')) {
        const parts = uri.replace('gs://', '').split('/');
        const bucketName = parts[0];
        const objectPath = parts.slice(1).join('/');

        const tmpGz = '/tmp/singapore-road-graph.json.gz';
        const tmpJson = '/tmp/singapore-road-graph.json';

        if (existsSync(tmpJson)) return tmpJson;

        try {
          console.log(`[DRIVE_WORKER] Downloading road graph from ${uri}...`);
          const { Storage } = await import('@google-cloud/storage');
          const storage = new Storage();
          const [contents] = await storage.bucket(bucketName).file(objectPath).download();

          if (objectPath.endsWith('.gz')) {
            const decompressed = gunzipSync(contents);
            writeFileSync(tmpJson, decompressed);
          } else {
            writeFileSync(tmpJson, contents);
          }
          console.log(`[DRIVE_WORKER] Successfully unpacked road graph to ${tmpJson}`);
          return tmpJson;
        } catch (err: any) {
          console.warn(`[DRIVE_WORKER] Failed to download graph from GCS ${uri}:`, err.message);
        }
      }

      // Check standard local path
      const localPath = join(process.cwd(), 'data', 'graph', 'singapore-road-graph.json');
      if (existsSync(localPath)) return localPath;

      const tmpJson = '/tmp/singapore-road-graph.json';
      if (existsSync(tmpJson)) return tmpJson;

      return null;
    })();

    return this.downloadPromise;
  }

  /**
   * Ensures the worker bundle exists and starts the worker thread.
   */
  private async init(): Promise<void> {
    const graphPath = await this.resolveGraphPath();
    if (!graphPath) {
      return;
    }

    const distWorker = join(process.cwd(), 'dist', 'driveWorker.cjs');
    if (!existsSync(distWorker)) {
      try {
        const esbuild = await import('esbuild');
        mkdirSync(join(process.cwd(), 'dist'), { recursive: true });
        esbuild.buildSync({
          entryPoints: [join(process.cwd(), 'src', 'routing', 'driveWorker.ts')],
          bundle: true,
          platform: 'node',
          format: 'cjs',
          packages: 'external',
          outfile: distWorker,
        });
      } catch (err: any) {
        console.warn('[DRIVE_WORKER] Could not build worker bundle with esbuild:', err.message);
        return;
      }
    }

    this.worker = new Worker(distWorker, {
      workerData: { graphPath },
    });

    this.worker.on('message', (msg: any) => {
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'ready') {
        this.isReady = true;
        return;
      }

      if (msg.type === 'route_many_result') {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(msg.id);
          this.isBusy = false;

          const resultMap = new Map<string, { seconds: number; meters: number } | null>(
            msg.results
          );
          pending.resolve({
            results: resultMap,
            durationMs: msg.durationMs,
          });
        }
        return;
      }

      if (msg.type === 'error') {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(msg.id);
          this.isBusy = false;
          pending.reject(new Error(msg.message));
        }
      }
    });

    this.worker.on('error', (err) => {
      console.warn('[DRIVE_WORKER] Worker thread error:', err.message);
      this.isBusy = false;
    });

    this.worker.on('exit', (code) => {
      if (code !== 0) {
        console.warn(`[DRIVE_WORKER] Worker stopped with exit code ${code}`);
      }
      this.isReady = false;
      this.isBusy = false;
      this.worker = null;
    });
  }

  /**
   * Dispatches a one-to-many route search to the background worker.
   * Enforces 3s timeout and rate-limits to 1 concurrent request.
   */
  public async findRoutesToMany(
    origin: { lat: number; lng: number },
    targets: RouteManyTarget[],
    options?: RouteManyOptions
  ): Promise<DriveWorkerResult | null> {
    if (!this.isReady || !this.worker) {
      if (!this.hasLoggedNotReady) {
        console.log('[PICKUP_DRIVE_EVAL] graph not ready: skipped');
        this.hasLoggedNotReady = true;
      }
      return null;
    }

    if (this.isBusy) {
      // Rate-limited: at most 1 concurrent shadow run
      return null;
    }

    this.isBusy = true;
    const id = `req-${++this.pendingRequestId}`;

    return new Promise<DriveWorkerResult | null>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          this.isBusy = false;
          console.log('[PICKUP_DRIVE_EVAL] timeout: dropped');
          resolve(null);
        }
      }, 3000); // 3-second hard timeout per §8 E3

      this.pendingRequests.set(id, {
        resolve: (val) => resolve(val),
        reject: (err) => {
          console.warn('[DRIVE_WORKER] Route query failed:', err.message);
          resolve(null);
        },
        timer,
      });

      this.worker!.postMessage({
        type: 'route_many',
        id,
        origin,
        targets,
        departureTime: options?.departureTime?.toISOString(),
        liveIncidents: options?.liveIncidents,
      });
    });
  }

  public get ready(): boolean {
    return this.isReady;
  }
}
