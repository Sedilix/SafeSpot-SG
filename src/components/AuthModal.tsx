/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  LogIn,
  Phone,
  KeyRound,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  UserRound,
} from 'lucide-react';
import {
  signInWithGoogle,
  signInAsGuest,
  setupRecaptcha,
  sendPhoneOtp
} from '../lib/firebase';
import { ConfirmationResult, User as FirebaseUser } from 'firebase/auth';
import { AccessibilitySettings } from '../types';
import { useEscapeToClose } from '../utils/useEscapeToClose';
import { t } from '../locales/translations';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: FirebaseUser) => void;
  settings: AccessibilitySettings;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  settings,
}) => {
  const lang = settings.language || 'en';
  const [authMode, setAuthMode] = useState<'options' | 'phone_input' | 'phone_otp'>('options');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Which one-tap option is in flight, so only that button shows a spinner.
  const [pendingOption, setPendingOption] = useState<'google' | 'guest' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setAuthMode('options');
      setPhoneNumber('');
      setOtpCode('');
      setConfirmationResult(null);
      setErrorMessage(null);
      setIsLoading(false);
      setPendingOption(null);
    } else {
      // Move focus into the dialog so keyboard and screen-reader users start there.
      panelRef.current?.focus();
    }
  }, [isOpen]);

  /** Firebase messages ("Firebase: Error (auth/...)") mean nothing to users; map the common ones. */
  const friendlyError = (err: any, fallbackKey: string): string | null => {
    const code: string | undefined = err?.code;
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
    if (code === 'auth/invalid-phone-number') return t('auth.errInvalidPhone', lang);
    if (code === 'auth/too-many-requests') return t('auth.errTooMany', lang);
    if (code === 'auth/network-request-failed') return t('auth.errNetwork', lang);
    return t(fallbackKey, lang);
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setPendingOption('google');
    setErrorMessage(null);
    try {
      const user = await signInWithGoogle();
      onAuthSuccess(user);
      onClose();
    } catch (err: any) {
      console.error('Google Sign-In failed:', err);
      setErrorMessage(friendlyError(err, 'auth.errGoogle'));
    } finally {
      setIsLoading(false);
      setPendingOption(null);
    }
  };

  const handleGuestSignIn = async () => {
    setIsLoading(true);
    setPendingOption('guest');
    setErrorMessage(null);
    try {
      const user = await signInAsGuest();
      onAuthSuccess(user);
      onClose();
    } catch (err: any) {
      console.error('Guest Sign-In failed:', err);
      setErrorMessage(friendlyError(err, 'auth.errGuest'));
    } finally {
      setIsLoading(false);
      setPendingOption(null);
    }
  };

  const handleSendPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim()) {
      setErrorMessage(t('auth.errPhoneEmpty', lang));
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const verifier = setupRecaptcha('recaptcha-container-auth');
      const confirmation = await sendPhoneOtp(phoneNumber, verifier);
      setConfirmationResult(confirmation);
      setAuthMode('phone_otp');
    } catch (err: any) {
      console.error('Phone OTP request failed:', err);
      setErrorMessage(friendlyError(err, 'auth.errSendFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim() || !confirmationResult) {
      setErrorMessage(t('auth.errOtpEmpty', lang));
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const credential = await confirmationResult.confirm(otpCode.trim());
      if (credential.user) {
        onAuthSuccess(credential.user);
        onClose();
      }
    } catch (err: any) {
      console.error('OTP confirmation failed:', err);
      setErrorMessage(t('auth.errOtpInvalid', lang));
    } finally {
      setIsLoading(false);
    }
  };

  const switchMode = (mode: 'options' | 'phone_input' | 'phone_otp') => {
    setErrorMessage(null);
    setAuthMode(mode);
  };

  useEscapeToClose(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      id="modal-auth-backdrop"
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      aria-describedby="auth-modal-desc"
    >
      <div id="modal-auth-content" ref={panelRef} tabIndex={-1} className="modal-panel max-w-lg focus:outline-none">
        {/* Header */}
        <div className="modal-head">
          <div className="flex min-w-0 items-center gap-3">
            <div className="icon-tile" aria-hidden="true">
              <LogIn className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id="auth-modal-title" className="font-display text-2xl leading-tight font-bold tracking-tight">
                {t('auth.title', lang)}
              </h2>
              <p id="auth-modal-desc" className="text-ink-soft mt-1 text-sm sm:text-base">
                {t('auth.subtitle', lang)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn accessible-tap text-ink-soft hover:bg-well hover:text-ink -mr-2 shrink-0"
            aria-label={t('auth.close', lang)}
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        {/* Body — gutters match .modal-head so the content lines up with the title */}
        <div className="space-y-5 overflow-y-auto px-4 py-5 sm:px-5">
          {errorMessage && (
            <div
              role="alert"
              className="border-brick/40 bg-brick-soft text-brick-deep flex items-start gap-3 rounded-xl border p-4 text-sm font-bold sm:text-base"
            >
              <AlertCircle className="text-brick mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Mode 1: Main Selection (Google or Phone) */}
          {authMode === 'options' && (
            <div className="space-y-3">
              <button
                id="btn-auth-google"
                type="button"
                disabled={isLoading}
                onClick={handleGoogleSignIn}
                className="btn btn-lg btn-secondary w-full"
              >
                {pendingOption === 'google' ? (
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                ) : (
                  /* Google's brand mark: its own colours are required by Google's branding rules. */
                  <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.04 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                    />
                  </svg>
                )}
                <span>{t('auth.google', lang)}</span>
              </button>

              <button
                id="btn-auth-phone-start"
                type="button"
                disabled={isLoading}
                onClick={() => switchMode('phone_input')}
                className="btn btn-lg btn-primary w-full"
              >
                <Phone className="h-6 w-6" aria-hidden="true" />
                <span>{t('auth.phoneStart', lang)}</span>
              </button>

              <button
                type="button"
                disabled={isLoading}
                onClick={handleGuestSignIn}
                className="btn btn-md text-ink-soft hover:bg-well hover:text-ink w-full"
              >
                {pendingOption === 'guest' ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <UserRound className="h-5 w-5" aria-hidden="true" />
                )}
                <span>{t('auth.guest', lang)}</span>
              </button>
            </div>
          )}

          {/* Mode 2: Phone Input */}
          {authMode === 'phone_input' && (
            <form onSubmit={handleSendPhoneOtp} className="space-y-4">
              <div>
                <label className="label" htmlFor="auth-phone-input">
                  {t('auth.phoneLabel', lang)}
                </label>
                <div className="relative">
                  <div className="text-ink-faint pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                    <Phone className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <input
                    id="auth-phone-input"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder={t('auth.phonePlaceholder', lang)}
                    className="input pl-11"
                    autoComplete="tel"
                    aria-describedby="auth-phone-help"
                    autoFocus
                  />
                </div>
                <p id="auth-phone-help" className="text-ink-soft mt-1.5 text-sm">
                  {t('auth.phoneHelp', lang)}
                </p>
              </div>

              {/* Invisible Recaptcha target container */}
              <div id="recaptcha-container-auth" ref={recaptchaContainerRef}></div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => switchMode('options')}
                  disabled={isLoading}
                  className="btn btn-md btn-secondary"
                >
                  {t('onboard.back', lang)}
                </button>

                <button
                  type="submit"
                  disabled={isLoading || !phoneNumber.trim()}
                  className="btn btn-md btn-primary flex-1"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                      <span>{t('auth.sending', lang)}</span>
                    </>
                  ) : (
                    <>
                      <span>{t('auth.sendCode', lang)}</span>
                      <ArrowRight className="h-5 w-5" aria-hidden="true" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Mode 3: OTP Code Verification */}
          {authMode === 'phone_otp' && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <label className="label" htmlFor="auth-otp-input">
                  {t('auth.otpLabel', lang)}
                </label>
                <div className="relative">
                  <div className="text-ink-faint pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                    <KeyRound className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <input
                    id="auth-otp-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    value={otpCode}
                    // Keep digits only, so a pasted "123 456" still fills all six.
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="input pl-11 text-center text-2xl font-bold tracking-widest tabular-nums"
                    aria-describedby="auth-otp-sent-to"
                    autoFocus
                  />
                </div>
                <p id="auth-otp-sent-to" className="text-ink-soft mt-1.5 text-sm">
                  {t('auth.sentTo', lang)} <strong className="text-ink">{phoneNumber}</strong>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => switchMode('phone_input')}
                  disabled={isLoading}
                  className="btn btn-md btn-secondary"
                >
                  {t('auth.changeNumber', lang)}
                </button>

                <button
                  type="submit"
                  disabled={isLoading || otpCode.length < 6}
                  className="btn btn-md btn-primary flex-1"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                      <span>{t('auth.verifying', lang)}</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                      <span>{t('auth.verify', lang)}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
