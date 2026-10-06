import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { gunzipSync } from 'zlib';
import { existsSync, unlinkSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  CompactSpeedRecord,
  appendSnapshotToGzip,
  resolveLtaKey
} from './logger';

describe('Speed-band Logger Unit Tests', () => {
  const testDir = join(process.cwd(), 'tools', 'speedbands', 'test-data');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    const today = new Date().toISOString().slice(0, 10);
    const testFile = join(testDir, `speedbands-${today}.jsonl.gz`);
    if (existsSync(testFile)) {
      unlinkSync(testFile);
    }
  });

  it('compresses and writes records as valid readable gzip', () => {
    const sampleRecords: CompactSpeedRecord[] = [
      { ts: Date.now(), linkId: '101', band: 4, min: 30, max: 39 },
      { ts: Date.now(), linkId: '102', band: 6, min: 50, max: 59 },
      { ts: Date.now(), linkId: '103', band: 2, min: 10, max: 19 }
    ];

    const { filePath, bytesWritten } = appendSnapshotToGzip(sampleRecords, testDir);
    expect(bytesWritten).toBeGreaterThan(0);
    expect(existsSync(filePath)).toBe(true);

    // Read and decompress
    const compressedData = readFileSync(filePath);
    const decompressedStr = gunzipSync(compressedData).toString('utf8');

    const lines = decompressedStr.trim().split('\n');
    expect(lines).toHaveLength(3);

    const first = JSON.parse(lines[0]);
    expect(first.linkId).toBe('101');
    expect(first.band).toBe(4);
    expect(first.min).toBe(30);
    expect(first.max).toBe(39);
  });

  it('resolves explicit key or environment variable safely', () => {
    const explicit = resolveLtaKey('TEST_KEY_123');
    expect(explicit).toBe('TEST_KEY_123');
  });

  it('handles empty records cleanly', () => {
    const { filePath, bytesWritten } = appendSnapshotToGzip([], testDir);
    expect(bytesWritten).toBe(0);
    expect(filePath).toBe('');
  });
});
