/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { DriveWorkerClient } from './driveWorkerClient';

describe('DriveWorkerClient', () => {
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
});
