/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { native, plugin } = vi.hoisted(() => ({
  native: { on: false },
  plugin: { checkPermissions: vi.fn(), requestPermissions: vi.fn() },
}));
const geo = { getCurrentPosition: vi.fn(), watchPosition: vi.fn(), clearWatch: vi.fn() };

vi.mock('./native', () => ({ isNativeApp: () => native.on }));
vi.mock('@capacitor/geolocation', () => ({ Geolocation: plugin }));
vi.stubGlobal('navigator', { geolocation: geo });

import { appPermissionKey, ensureLocationPermission, getCurrentPosition, permissionText, watchPosition } from './geolocation';

const flush = () => new Promise((r) => setTimeout(r, 0));
const granted = { location: 'granted', coarseLocation: 'granted' };
const denied = { location: 'denied', coarseLocation: 'denied' };

describe('location in the app', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.on = false;
    geo.watchPosition.mockReturnValue(7);
    plugin.checkPermissions.mockResolvedValue(granted);
    plugin.requestPermissions.mockResolvedValue(granted);
  });

  it('calls navigator.geolocation directly on the website', () => {
    const ok = vi.fn();
    getCurrentPosition(ok);
    expect(geo.getCurrentPosition).toHaveBeenCalledWith(ok, undefined, undefined);
    const stop = watchPosition(ok);
    stop();
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    expect(plugin.checkPermissions).not.toHaveBeenCalled();
  });

  it('asks Android once for concurrent callers, then uses the WebView', async () => {
    native.on = true;
    plugin.checkPermissions.mockResolvedValue({ location: 'prompt', coarseLocation: 'prompt' });
    getCurrentPosition(vi.fn());
    watchPosition(vi.fn());
    await flush();
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it('accepts approximate location only', async () => {
    native.on = true;
    plugin.checkPermissions.mockResolvedValue({ location: 'denied', coarseLocation: 'granted' });
    expect(await ensureLocationPermission()).toBe('ok');
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it('reports a refusal as PERMISSION_DENIED with the Android Settings message', async () => {
    native.on = true;
    plugin.checkPermissions.mockResolvedValue(denied);
    plugin.requestPermissions.mockResolvedValue(denied);
    const fail = vi.fn();
    getCurrentPosition(vi.fn(), fail);
    await flush();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    const err = fail.mock.calls[0][0];
    expect(err.code).toBe(1);
    expect(appPermissionKey(err, 'location')).toBe('app.locationDenied');
    expect(permissionText('app.locationDenied', 'en')).toMatch(/Android Settings/);
  });

  it('tells the user when the Location switch is off', async () => {
    native.on = true;
    plugin.checkPermissions.mockRejectedValue(new Error('Location services are not enabled.'));
    const fail = vi.fn();
    watchPosition(vi.fn(), fail);
    await flush();
    expect(appPermissionKey(fail.mock.calls[0][0], 'location')).toBe('app.locationOff');
  });

  it('does not start a watch that was stopped before the answer arrived', async () => {
    native.on = true;
    const stop = watchPosition(vi.fn());
    stop();
    await flush();
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });
});

describe('permission messages', () => {
  beforeEach(() => {
    native.on = false;
  });

  it('keeps the website wording', () => {
    expect(appPermissionKey({ name: 'NotAllowedError' }, 'camera')).toBeNull();
    expect(appPermissionKey({ code: 1 }, 'location')).toBeNull();
    expect(permissionText('gps.notFound', 'en')).toMatch(/could not find your location/);
  });

  it('points app users to Android Settings for mic and camera refusals only', () => {
    native.on = true;
    expect(appPermissionKey({ name: 'NotAllowedError' }, 'microphone')).toBe('app.micDenied');
    expect(appPermissionKey({ name: 'NotAllowedError' }, 'camera')).toBe('app.cameraDenied');
    expect(appPermissionKey({ name: 'NotFoundError' }, 'camera')).toBeNull();
    expect(appPermissionKey({ code: 3 }, 'location')).toBeNull();
    expect(permissionText('app.cameraDenied', 'zh')).toMatch(/相机/);
  });
});
