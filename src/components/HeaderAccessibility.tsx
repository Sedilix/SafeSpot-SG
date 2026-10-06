/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  Eye, 
  Volume2, 
  VolumeX, 
  Mic, 
  Siren, 
  Settings, 
  Type,
  Languages,
  User as UserIcon,
  LogIn,
  ChevronDown
} from 'lucide-react';
import { AccessibilitySettings, HighContrastTheme, FontSizeLevel, UserProfile, Language } from '../types';
import { AppLogo } from './AppLogo';
import { User as FirebaseUser } from 'firebase/auth';
import { t, LANGUAGE_OPTIONS } from '../locales/translations';

interface HeaderAccessibilityProps {
  settings: AccessibilitySettings;
  onUpdateSettings: (updater: (prev: AccessibilitySettings) => AccessibilitySettings) => void;
  onOpenVoiceCommand: () => void;
  onEmergencyTrigger: () => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  onOpenAuth: () => void;
  user: FirebaseUser | null;
  profile: UserProfile | null;
  isSpeaking: boolean;
  onStopSpeaking: () => void;
}

export const HeaderAccessibility: React.FC<HeaderAccessibilityProps> = ({
  settings,
  onUpdateSettings,
  onOpenVoiceCommand,
  onEmergencyTrigger,
  onOpenSettings,
  onOpenProfile,
  onOpenAuth,
  user,
  profile,
  isSpeaking,
  onStopSpeaking,
}) => {
  const toggleTheme = () => {
    const themeCycle: HighContrastTheme[] = ['normal', 'yellow-black', 'black-white', 'warm-soft'];
    const nextIndex = (themeCycle.indexOf(settings.contrastTheme) + 1) % themeCycle.length;
    onUpdateSettings((prev) => ({ ...prev, contrastTheme: themeCycle[nextIndex] }));
  };

  const toggleFontSize = () => {
    const sizeCycle: FontSizeLevel[] = ['standard', 'large', 'extra-large'];
    const nextIndex = (sizeCycle.indexOf(settings.fontSize) + 1) % sizeCycle.length;
    onUpdateSettings((prev) => ({ ...prev, fontSize: sizeCycle[nextIndex] }));
  };

  const toggleVoiceGuidance = () => {
    if (isSpeaking) {
      onStopSpeaking();
    }
    onUpdateSettings((prev) => ({ ...prev, spokenGuidance: !prev.spokenGuidance }));
  };

  const lang = settings.language || 'en';

  // Only the brand + SOS row is pinned. The utility controls sit in their own
  // bar below it that scrolls away and wraps, so on a phone every control is
  // visible (nothing hidden behind a sideways scroll) and the pinned area
  // stays one row tall.
  return (
    <>
    <header
      id="app-header-accessibility"
      className="border-line bg-surface/95 text-ink sticky top-0 z-40 border-b px-3 pb-2.5 pt-[calc(env(safe-area-inset-top,0px)+0.6rem)] backdrop-blur-md transition-colors sm:px-8 sm:py-3.5"
    >
      <div className="mx-auto max-w-7xl">
        {/* Brand and the one action that must never be hunted for */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <AppLogo size={36} className="sm:h-11 sm:w-11" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-display truncate text-lg leading-none font-bold tracking-tight sm:text-[1.7rem]">
                  SafeSpot.SG
                </h1>
                {/* Redundant with the SOS button on a narrow screen */}
                <span className="chip border-pine/40 bg-pine-soft text-pine-deep hidden sm:inline-flex">
                  Singapore • 995 SOS
                </span>
              </div>
              <p className="text-ink-soft mt-1 hidden text-sm font-normal sm:block sm:text-base">
                {t('header.tagline', lang)}
              </p>
            </div>
          </div>

          {/* Emergency 995 SCDF Instant Trigger — always labelled, always reachable */}
          <button
            id="btn-emergency-911-header"
            onClick={onEmergencyTrigger}
            className="btn btn-md btn-danger shrink-0 sm:order-last sm:min-w-[8.5rem]"
            title="Immediate Singapore SCDF 995 Emergency Dispatch Call & Location Send"
          >
            <Siren className="h-5 w-5" />
            <span>{t('header.sos', lang)}</span>
          </button>
        </div>

      </div>
    </header>

    {/*
      Utility controls: icons on mobile, labels from sm up. Tap targets stay at
      the 48px accessible minimum either way — only the labels are dropped.
    */}
    <div className="border-line bg-surface/60 border-b px-3 py-2 sm:px-8 sm:py-2.5">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-1.5 sm:gap-2.5">
          {/* Mobile-Optimized Language Dropdown (EN / 中文 / Melayu / தமிழ்) */}
          <div className="relative inline-flex items-center shrink-0">
            <label htmlFor="select-language-dropdown" className="sr-only">
              {t('header.language', lang)}
            </label>
            <div className="pointer-events-none absolute left-3 z-10 flex items-center text-ink-soft">
              <Languages className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <select
              id="select-language-dropdown"
              value={lang}
              onChange={(e) => onUpdateSettings((prev) => ({ ...prev, language: e.target.value as Language }))}
              className="btn btn-md btn-secondary cursor-pointer appearance-none pl-9 pr-7 text-sm font-bold sm:pl-10 sm:pr-8 sm:text-sm"
              aria-label={t('header.language', lang)}
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-surface text-ink py-1">
                  {opt.flag} {opt.nativeName}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-2 z-10 text-ink-soft">
              <ChevronDown className="h-3.5 w-3.5" />
            </div>
          </div>

          {/* Voice Command Mode Trigger */}
          <button
            id="btn-voice-assistant-trigger"
            onClick={onOpenVoiceCommand}
            className="btn btn-md btn-primary shrink-0 px-3 sm:px-4"
            title="Voice Commands (Say 'Where am I' or 'Send location')"
            aria-label="Activate voice commands"
          >
            <Mic className="h-5 w-5" />
            <span className="hidden sm:inline">{t('header.voiceAssistant', lang)}</span>
          </button>

          {/* Voice Speech Audio Toggle */}
          <button
            id="btn-toggle-speech-guidance"
            onClick={toggleVoiceGuidance}
            className={`btn btn-md shrink-0 px-3 sm:px-4 ${
              settings.spokenGuidance
                ? 'border-pine/40 bg-pine-soft text-pine-deep'
                : 'btn-secondary text-ink-soft'
            }`}
            title={settings.spokenGuidance ? 'Voice Speech Guidance Active (Tap to mute)' : 'Turn Voice Guidance On'}
            aria-label={settings.spokenGuidance ? 'Mute voice guidance' : 'Turn voice guidance on'}
          >
            {settings.spokenGuidance ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            <span className="hidden sm:inline">
              {settings.spokenGuidance ? t('header.voiceOn', lang) : t('header.voiceOff', lang)}
            </span>
          </button>

          {/* Settings & Speechmatics Voice Config Button */}
          <button
            id="btn-open-settings-modal"
            onClick={onOpenSettings}
            className="btn btn-md btn-secondary shrink-0 px-3 sm:px-4"
            title="Open Speechmatics Voices & Accessibility Settings"
            aria-label="Settings and Speechmatics voice selection"
          >
            <Settings className="text-ink-soft h-5 w-5" />
            <span className="hidden sm:inline">{t('header.settings', lang)}</span>
            <span className="chip border-pine/40 bg-pine-soft text-pine-deep hidden px-2 py-0.5 text-[11px] uppercase lg:inline-flex">
              {settings.speechmaticsVoice ? settings.speechmaticsVoice : 'sarah'}
            </span>
          </button>

          {/* High Contrast Theme Switcher */}
          <button
            id="btn-toggle-contrast-mode"
            onClick={toggleTheme}
            className="btn btn-md btn-secondary shrink-0 px-3 sm:px-4"
            title="Toggle High Contrast Display Mode"
            aria-label="Toggle high contrast display mode"
          >
            <Eye className="text-ink-soft h-5 w-5" />
            <span className="hidden sm:inline">{t('header.contrast', lang)}</span>
          </button>

          {/* Font Size Adjuster */}
          <button
            id="btn-toggle-font-size"
            onClick={toggleFontSize}
            className="btn btn-md btn-secondary shrink-0 px-3 sm:px-4"
            title="Increase or reset text size"
            aria-label={`Text size, current: ${settings.fontSize}`}
          >
            <Type className="text-ink-soft h-5 w-5" />
            <span className="hidden sm:inline">
              {t('header.text', lang)}:{' '}
              {settings.fontSize === 'extra-large' ? 'XL' : settings.fontSize === 'large' ? 'Large' : 'Med'}
            </span>
          </button>

          {/* User Profile / Auth Button */}
          {user ? (
            <button
              id="btn-open-user-profile"
              onClick={onOpenProfile}
              className="btn btn-md btn-secondary shrink-0 px-3 sm:px-4"
              title="Open User Medical Profile & Emergency Contacts"
            >
              {profile?.selfiePhotoUrl ? (
                <img
                  src={profile.selfiePhotoUrl}
                  alt="Selfie"
                  className="border-pine h-7 w-7 rounded-full border-2 object-cover"
                />
              ) : (
                <span className="bg-pine text-on-pine flex h-7 w-7 items-center justify-center rounded-full text-sm">
                  {profile?.actualName?.charAt(0) || user.displayName?.charAt(0) || <UserIcon className="h-4 w-4" />}
                </span>
              )}
              <span className="hidden max-w-[110px] truncate sm:inline">
                {profile?.actualName || user.displayName || (user.isAnonymous ? 'Guest' : 'My Profile')}
              </span>
              {profile?.bloodType && profile.bloodType !== 'Unknown' && (
                <span className="chip border-brick/40 bg-brick-soft text-brick-deep hidden px-2 py-0.5 text-[11px] lg:inline-flex">
                  {profile.bloodType}
                </span>
              )}
            </button>
          ) : (
            <button
              id="btn-open-auth-modal"
              onClick={onOpenAuth}
              className="btn btn-md bg-ink text-bg hover:bg-ink-soft shrink-0 px-3 sm:px-4"
              title="Sign In with Google or Phone"
              aria-label="Sign in"
            >
              <LogIn className="h-5 w-5" />
              <span className="hidden sm:inline">{t('header.signIn', lang)}</span>
            </button>
          )}
        </div>
    </div>
    </>
  );
};
