/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { native, plugin, fa } = vi.hoisted(() => ({
  native: { on: false, firebase: true },
  plugin: { signInWithGoogle: vi.fn(), signOut: vi.fn() },
  fa: {
    auth: { currentUser: null as any },
    signInWithPopup: vi.fn(),
    linkWithPopup: vi.fn(),
    signInWithCredential: vi.fn(),
    linkWithCredential: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock('./native', () => ({ isNativeApp: () => native.on, firebaseNativeReady: () => native.firebase }));
vi.mock('@capacitor-firebase/authentication', () => ({ FirebaseAuthentication: plugin }));
vi.mock('firebase/app', () => ({ initializeApp: () => ({}), getApps: () => [], getApp: () => ({}) }));
vi.mock('firebase/firestore', () => ({ initializeFirestore: () => ({}), persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}) }));
vi.mock('firebase/auth', () => {
  class GoogleAuthProvider { static credential = (idToken: string) => ({ providerId: 'google.com', idToken }); }
  return {
    getAuth: () => fa.auth,
    GoogleAuthProvider,
    signInWithPopup: (...a: any[]) => fa.signInWithPopup(...a),
    linkWithPopup: (...a: any[]) => fa.linkWithPopup(...a),
    signInWithCredential: (...a: any[]) => fa.signInWithCredential(...a),
    linkWithCredential: (...a: any[]) => fa.linkWithCredential(...a),
    signOut: (...a: any[]) => fa.signOut(...a),
  };
});

import { signInWithGoogle, upgradeGuestToGoogle, signOutUser } from './firebase';

const user = { uid: 'u1' };

describe('Google sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.on = false;
    native.firebase = true;
    fa.auth.currentUser = null;
    fa.signInWithPopup.mockResolvedValue({ user });
    fa.linkWithPopup.mockResolvedValue({ user });
    fa.signInWithCredential.mockResolvedValue({ user });
    fa.linkWithCredential.mockResolvedValue({ user });
    plugin.signInWithGoogle.mockResolvedValue({ credential: { idToken: 'tok' } });
    plugin.signOut.mockResolvedValue(undefined);
  });

  it('uses the popup on the website', async () => {
    expect(await signInWithGoogle()).toBe(user);
    expect(fa.signInWithPopup).toHaveBeenCalled();
    expect(plugin.signInWithGoogle).not.toHaveBeenCalled();
  });

  it('uses the native ID token in the app', async () => {
    native.on = true;
    expect(await signInWithGoogle()).toBe(user);
    expect(fa.signInWithPopup).not.toHaveBeenCalled();
    expect(fa.signInWithCredential).toHaveBeenCalledWith(fa.auth, { providerId: 'google.com', idToken: 'tok' });
  });

  it('explains when the app was built without google-services.json', async () => {
    native.on = true;
    native.firebase = false;
    await expect(signInWithGoogle()).rejects.toThrow(/not set up/);
    expect(plugin.signInWithGoogle).not.toHaveBeenCalled();
  });

  it('reports a dismissed native picker like a closed popup', async () => {
    native.on = true;
    plugin.signInWithGoogle.mockRejectedValue(new Error('activity is cancelled by the user.'));
    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'auth/popup-closed-by-user' });
  });

  it('fails clearly when no ID token comes back', async () => {
    native.on = true;
    plugin.signInWithGoogle.mockResolvedValue({ credential: null });
    await expect(signInWithGoogle()).rejects.toThrow(/no ID token/);
    expect(fa.signInWithCredential).not.toHaveBeenCalled();
  });

  it('links a guest in the app and keeps the already-in-use message', async () => {
    native.on = true;
    const guest = { uid: 'g1', isAnonymous: true };
    fa.auth.currentUser = guest;
    expect(await upgradeGuestToGoogle()).toBe(user);
    expect(fa.linkWithCredential).toHaveBeenCalledWith(guest, { providerId: 'google.com', idToken: 'tok' });
    expect(fa.linkWithPopup).not.toHaveBeenCalled();

    fa.linkWithCredential.mockRejectedValue({ code: 'auth/credential-already-in-use' });
    await expect(upgradeGuestToGoogle()).rejects.toThrow(/already has a SafeSpot profile/);
  });

  it('links a guest with the popup on the website', async () => {
    fa.auth.currentUser = { uid: 'g1', isAnonymous: true };
    await upgradeGuestToGoogle();
    expect(fa.linkWithPopup).toHaveBeenCalled();
    expect(fa.linkWithCredential).not.toHaveBeenCalled();
  });

  it('signs out of the native plugin only in the app', async () => {
    await signOutUser();
    expect(plugin.signOut).not.toHaveBeenCalled();
    native.on = true;
    plugin.signOut.mockRejectedValue(new Error('boom'));
    await signOutUser();
    expect(plugin.signOut).toHaveBeenCalled();
    expect(fa.signOut).toHaveBeenCalledTimes(2);
  });
});
