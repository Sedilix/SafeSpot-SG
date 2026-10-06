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
  RefreshCw
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
  const [authMode, setAuthMode] = useState<'options' | 'phone_input' | 'phone_otp'>('options');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);

  void settings;

  useEffect(() => {
    if (!isOpen) {
      setAuthMode('options');
      setPhoneNumber('');
      setOtpCode('');
      setConfirmationResult(null);
      setErrorMessage(null);
      setIsLoading(false);
    }
  }, [isOpen]);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const user = await signInWithGoogle();
      onAuthSuccess(user);
      onClose();
    } catch (err: any) {
      console.error('Google Sign-In failed:', err);
      setErrorMessage(err.message || 'Google sign-in was cancelled or failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const user = await signInAsGuest();
      onAuthSuccess(user);
      onClose();
    } catch (err: any) {
      console.error('Guest Sign-In failed:', err);
      setErrorMessage(err.message || 'Guest sign-in failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim()) {
      setErrorMessage('Please enter your mobile phone number.');
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
      setErrorMessage(err.message || 'Failed to send SMS verification code. Please check the phone number.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim() || !confirmationResult) {
      setErrorMessage('Please enter the 6-digit code received via SMS.');
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
      setErrorMessage('Invalid verification code. Please check the SMS and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEscapeToClose(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div id="modal-auth-backdrop" className="modal-backdrop" role="dialog" aria-modal="true">
      <div id="modal-auth-content" className="modal-panel max-w-lg">
        {/* Header */}
        <div className="modal-head">
          <div className="flex items-center gap-3">
            <div className="icon-tile">
              <LogIn className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-2xl leading-none font-bold tracking-tight">
                Sign In & User Profile
              </h2>
              <p className="text-ink-soft mt-1 text-sm sm:text-base">
                Save your medical ID, emergency contacts & selfie in Cloud
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="accessible-tap text-ink-soft hover:bg-well hover:text-ink rounded-xl p-2 transition-colors"
            aria-label="Close"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 p-6">
          {errorMessage && (
            <div className="border-brick/40 bg-brick-soft text-brick-deep flex items-start gap-2.5 rounded-xl border p-4 text-sm font-bold sm:text-base">
              <AlertCircle className="text-brick mt-0.5 h-5 w-5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Mode 1: Main Selection (Google or Phone) */}
          {authMode === 'options' && (
            <div className="space-y-3.5">
              <button
                id="btn-auth-google"
                type="button"
                disabled={isLoading}
                onClick={handleGoogleSignIn}
                className="btn btn-lg btn-secondary w-full border-2"
              >
                {/* Google Icon SVG */}
                <svg className="h-6 w-6" viewBox="0 0 24 24">
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
                <span>Continue with Google</span>
              </button>

              <button
                id="btn-auth-phone-start"
                type="button"
                disabled={isLoading}
                onClick={() => {
                  setErrorMessage(null);
                  setAuthMode('phone_input');
                }}
                className="btn btn-lg btn-primary w-full"
              >
                <Phone className="h-6 w-6" />
                <span>Sign In / Up with Phone (SMS OTP)</span>
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={handleGuestSignIn}
                  className="text-ink-soft hover:text-ink text-sm font-bold hover:underline sm:text-base"
                >
                  ⚡ Instant Access (Continue as Guest)
                </button>
              </div>
            </div>
          )}

          {/* Mode 2: Phone Input */}
          {authMode === 'phone_input' && (
            <form onSubmit={handleSendPhoneOtp} className="space-y-4">
              <div>
                <label className="label" htmlFor="auth-phone-input">
                  Mobile Phone Number (Singapore / International)
                </label>
                <div className="relative">
                  <div className="text-ink-faint pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                    <Phone className="h-5 w-5" />
                  </div>
                  <input
                    id="auth-phone-input"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="e.g. 9123 4567 or +65 9123 4567"
                    className="input pl-11"
                    autoFocus
                  />
                </div>
                <p className="text-ink-soft mt-1.5 text-sm">
                  We will send a 6-digit SMS verification code to confirm your number.
                </p>
              </div>

              {/* Invisible Recaptcha target container */}
              <div id="recaptcha-container-auth" ref={recaptchaContainerRef}></div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAuthMode('options')}
                  className="btn btn-md btn-secondary"
                >
                  Back
                </button>

                <button
                  type="submit"
                  disabled={isLoading || !phoneNumber.trim()}
                  className="btn btn-md btn-primary flex-1"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="h-5 w-5 animate-spin" />
                      <span>Sending SMS Code...</span>
                    </>
                  ) : (
                    <>
                      <span>Send Verification Code</span>
                      <ArrowRight className="h-5 w-5" />
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
                  Enter 6-Digit SMS Verification Code
                </label>
                <div className="relative">
                  <div className="text-ink-faint pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <input
                    id="auth-otp-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="123456"
                    className="input pl-11 text-center text-2xl font-bold tracking-widest"
                    autoFocus
                  />
                </div>
                <p className="text-ink-soft mt-1.5 text-sm">
                  Sent to: <strong className="text-ink">{phoneNumber}</strong>
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAuthMode('phone_input')}
                  className="btn btn-md btn-secondary"
                >
                  Change Number
                </button>

                <button
                  type="submit"
                  disabled={isLoading || otpCode.length < 6}
                  className="btn btn-md btn-primary flex-1"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="h-5 w-5 animate-spin" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-5 w-5" />
                      <span>Verify & Continue</span>
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
