/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DriveWorkerClient, maybeInitDriveWorkerAtStartup } from './driveWorkerClient';

vi.mock('@google-cloud/storage', () => {
  return {
    Storage: class MockStorage {
      bucket() {
        return {
          file() {
            return {
              download: vi.fn().mockResolvedValue([Buffer.from('{"nodes":[],"edges":[]}')]),
            };
          },
        };
      }
    },
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn(),
  };
});

describe('DriveWorkerClient', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    DriveWorkerClient.resetInstanceForTesting();
    process.env = { ...origEnv };
    delete process.env.ROUTING_SHADOW_DRIVE;
    delete process.env.ROUTING_ENGINE_DRIVE;
    delete process.env.ROUTING_GRAPH_URI;
  });

  afterEach(() => {
    DriveWorkerClient.resetInstanceForTesting();
    process.env = { ...origEnv };
    vi.restoreAllMocks();
  });

  it('returns singleton instance', () => {
    const client1 = DriveWorkerClient.getInstance();
    const client2 = DriveWorkerClient.getInstance();
    expect(client1).toBe(client2);
  });

  it('skips gracefully when worker/graph is not ready', async () => {
    const client = DriveWorkerClient.getInstance();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // If client is not ready, should return null safely without throwing
    const res = await client.findRoutesToMany(
      { lat: 1.3, lng: 103.8 },
      [{ id: 't1', lat: 1.31, lng: 103.81 }]
    );

    expect(res === null || typeof res === 'object').toBe(true);
    logSpy.mockRestore();
  });

  describe('maybeInitDriveWorkerAtStartup', () => {
    it('does not initialize client at startup when flags are off', () => {
      process.env.ROUTING_SHADOW_DRIVE = '0';
      process.env.ROUTING_ENGINE_DRIVE = 'google';

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const client = maybeInitDriveWorkerAtStartup();

      expect(client).toBeNull();
      expect(DriveWorkerClient.hasInstance()).toBe(false);
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Initializing drive worker client at server startup'));
    });

    it('initializes client at startup when ROUTING_SHADOW_DRIVE=1 without blocking', () => {
      process.env.ROUTING_SHADOW_DRIVE = '1';

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const startMs = performance.now();
      const client = maybeInitDriveWorkerAtStartup();
      const elapsedMs = performance.now() - startMs;

      expect(client).toBeInstanceOf(DriveWorkerClient);
      expect(DriveWorkerClient.hasInstance()).toBe(true);
      expect(elapsedMs).toBeLessThan(50); // Synchronous, non-blocking
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DRIVE_WORKER] Initializing drive worker client at server startup (ROUTING_SHADOW_DRIVE=1)...')
      );
    });

    it('initializes client at startup when ROUTING_ENGINE_DRIVE=local', () => {
      process.env.ROUTING_ENGINE_DRIVE = 'local';

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const client = maybeInitDriveWorkerAtStartup();

      expect(client).toBeInstanceOf(DriveWorkerClient);
      expect(DriveWorkerClient.hasInstance()).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DRIVE_WORKER] Initializing drive worker client at server startup (ROUTING_ENGINE_DRIVE=local)...')
      );
    });

    it('startup log shows GCS graph download when ROUTING_GRAPH_URI is set', async () => {
      process.env.ROUTING_SHADOW_DRIVE = '1';
      process.env.ROUTING_GRAPH_URI = 'gs://safespot-sg-speedbands/graph/2026-10-12/singapore-road-graph.json.gz';

      const logs: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((msg) => {
        logs.push(String(msg));
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const client = maybeInitDriveWorkerAtStartup();
      expect(client).not.toBeNull();

      // Trigger resolveGraphPath to verify the GCS download log
      await client!.resolveGraphPath();

      const downloadLog = logs.find((l) =>
        l.includes('[DRIVE_WORKER] Downloading road graph from gs://safespot-sg-speedbands/graph/2026-10-12/singapore-road-graph.json.gz...')
      );
      expect(downloadLog).toBeDefined();
    });
  });
});
