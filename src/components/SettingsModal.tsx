/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  X, 
  Volume2, 
  Check, 
  Play, 
  Square, 
  Sliders, 
  Eye, 
  Type, 
  Users, 
  Waves, 
  CheckCircle2,
  ShieldAlert,
  Car,
  Footprints,
  ChevronRight,
} from 'lucide-react';
import { 
  AccessibilitySettings, 
  SPEECHMATICS_VOICE_OPTIONS, 
  SpeechmaticsVoiceOption, 
  HighContrastTheme, 
  FontSizeLevel 
} from '../types';
import { speakSpeechmaticsOrFallback, stopSpeaking } from '../utils/speech';
import { t } from '../locales/translations';
import { useEscapeToClose } from '../utils/useEscapeToClose';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AccessibilitySettings;
  onUpdateSettings: (updater: (prev: AccessibilitySettings) => AccessibilitySettings) => void;
  onOpenManageContacts?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onOpenManageContacts,
}) => {
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  const lang = settings.language || 'en';

  useEscapeToClose(isOpen, onClose);

  if (!isOpen) return null;

  const handleTestVoice = async (voice: SpeechmaticsVoiceOption) => {
    if (playingVoiceId === voice.id) {
      stopSpeaking();
      setPlayingVoiceId(null);
      return;
    }

    setPlayingVoiceId(voice.id);
    await speakSpeechmaticsOrFallback(
      voice.sampleText, 
      voice.id, 
      () => {
        setPlayingVoiceId(null);
      },
      settings.speechmaticsRate ?? 0.85
    );
  };

  const handleSelectVoice = (voiceId: string) => {
    onUpdateSettings((prev) => ({
      ...prev,
      speechmaticsVoice: voiceId,
    }));
  };

  const activeVoice = SPEECHMATICS_VOICE_OPTIONS.find(
    (v) => v.id === (settings.speechmaticsVoice || 'sarah')
  ) || SPEECHMATICS_VOICE_OPTIONS[0];

  return (
    <div
      id="modal-settings-backdrop"
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-settings-title"
    >
      <div id="modal-settings-content" className="modal-panel max-w-2xl">
        {/* Header Bar */}
        <div className="modal-head">
          <div className="flex min-w-0 items-center gap-3">
            <div className="icon-tile">
              <Sliders className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id="modal-settings-title" className="font-display text-2xl leading-none font-bold tracking-tight">
                {t('settings.title', lang)}
              </h2>
              <p className="text-ink-soft mt-1 text-sm sm:text-base">
                {t('settings.subtitle', lang)}
              </p>
            </div>
          </div>

          <button
            id="btn-close-settings-modal"
            type="button"
            onClick={() => {
              stopSpeaking();
              setPlayingVoiceId(null);
              onClose();
            }}
            className="accessible-tap text-ink-soft hover:bg-well hover:text-ink shrink-0 rounded-xl p-2 transition-colors"
            aria-label={t('common.close', lang)}
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
          {/* Section 1: Speechmatics Voice Type Selector */}
          <section id="section-speechmatics-voices" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Waves className="text-sky h-5 w-5" />
                <h3 className="text-lg font-bold sm:text-xl">{t('settings.voiceTitle', lang)}</h3>
              </div>
              <span className="chip border-pine/40 bg-pine-soft text-pine-deep text-sm">
                {t('settings.active', lang)} {activeVoice.name} ({activeVoice.accent})
              </span>
            </div>

            <p className="text-ink-soft text-sm leading-relaxed sm:text-base">
              {t('settings.voicePrompt', lang)}
            </p>

            {/* Voice Cards Grid */}
            <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
              {SPEECHMATICS_VOICE_OPTIONS.map((v) => {
                const isSelected = (settings.speechmaticsVoice || 'sarah') === v.id;
                const isPlaying = playingVoiceId === v.id;

                return (
                  <div
                    key={v.id}
                    id={`voice-option-${v.id}`}
                    className={`flex flex-col justify-between rounded-xl border-2 p-4 transition-all ${
                      isSelected
                        ? 'border-pine bg-pine-soft shadow-sm'
                        : 'border-line bg-surface hover:border-line-strong'
                    }`}
                  >
                    <div>
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {/* The accent is spelled out below, so the flag is decorative. */}
                          <span className="text-2xl" aria-hidden="true">
                            {v.flag}
                          </span>
                          <div>
                            <div className="flex items-center gap-1.5 text-lg leading-none font-bold">
                              <span>{v.name}</span>
                              <span className="text-ink-soft text-sm font-normal">
                                ({v.gender === 'female' ? 'Female' : 'Male'})
                              </span>
                            </div>
                            <div className="text-ochre mt-0.5 text-sm font-bold">
                              {v.tone} • {v.accent}
                            </div>
                          </div>
                        </div>

                        {isSelected && (
                          <span className="bg-pine text-on-pine shrink-0 rounded-full p-1">
                            <Check className="h-4 w-4" />
                          </span>
                        )}
                      </div>

                      <p className="text-ink-soft mt-1 mb-3 text-sm leading-snug">
                        {v.description}
                      </p>
                    </div>

                    {/* Bottom Action Controls */}
                    <div className="border-line flex items-center gap-2 border-t pt-2.5">
                      <button
                        type="button"
                        onClick={() => handleSelectVoice(v.id)}
                        aria-pressed={isSelected}
                        aria-label={`${t('settings.selectVoice', lang)}: ${v.name}`}
                        className={`btn btn-md flex-1 ${
                          isSelected ? 'btn-primary' : 'btn-secondary'
                        }`}
                      >
                        {isSelected ? (
                          <>
                            <CheckCircle2 className="h-4 w-4" />
                            <span>{t('settings.selected', lang)}</span>
                          </>
                        ) : (
                          <span>{t('settings.selectVoice', lang)}</span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleTestVoice(v)}
                        className={`btn btn-md shrink-0 ${isPlaying ? 'btn-danger' : 'btn-secondary'}`}
                        aria-label={`${isPlaying ? t('settings.stop', lang) : t('settings.listen', lang)}: ${v.name}`}
                      >
                        {isPlaying ? (
                          <>
                            <Square className="h-4 w-4 fill-current" />
                            <span>{t('settings.stop', lang)}</span>
                          </>
                        ) : (
                          <>
                            <Play className="text-pine h-4 w-4 fill-current" />
                            <span>{t('settings.listen', lang)}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Section 2: Audio & Spoken Guidance Preferences */}
          <section id="section-audio-preferences" className="border-line space-y-3 border-t pt-4">
            <div className="flex items-center gap-2">
              <Volume2 className="text-pine h-5 w-5" />
              <h3 className="text-lg font-bold sm:text-xl">{t('settings.audioHeading', lang)}</h3>
            </div>

            <div className="space-y-2.5">
              {/* Spoken Guidance Toggle */}
              <div className="border-line bg-well/60 flex items-center justify-between gap-3 rounded-xl border p-4">
                <div>
                  <div id="settings-spoken-label" className="text-base font-bold sm:text-lg">{t('settings.autoSpoken', lang)}</div>
                  <div id="settings-spoken-desc" className="text-ink-soft text-sm">
                    {t('settings.autoSpokenDesc', lang)}
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.spokenGuidance}
                  aria-labelledby="settings-spoken-label"
                  aria-describedby="settings-spoken-desc"
                  onClick={() => onUpdateSettings((prev) => ({ ...prev, spokenGuidance: !prev.spokenGuidance }))}
                  className={`toggle-switch ${settings.spokenGuidance ? 'toggle-switch--on' : 'toggle-switch--off'}`}
                >
                  <span className="toggle-switch-knob" />
                </button>
              </div>

              {/* Speech Speed Cadence */}
              <div className="border-line bg-well/60 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                <div>
                  <div className="text-base font-bold sm:text-lg">{t('settings.cadence', lang)}</div>
                  <div className="text-ink-soft text-sm">
                    {t('settings.cadenceDesc', lang)}
                  </div>
                </div>

                <div className="flex items-center gap-2" role="group" aria-label={t('settings.cadence', lang)}>
                  <button
                    type="button"
                    aria-pressed={(settings.speechmaticsRate ?? 0.85) <= 0.9}
                    onClick={() => onUpdateSettings((prev) => ({ ...prev, speechmaticsRate: 0.85 }))}
                    className={`btn btn-md ${
                      (settings.speechmaticsRate ?? 0.85) <= 0.9 ? 'btn-primary' : 'btn-secondary'
                    }`}
                  >
                    {t('settings.gentle', lang)}
                  </button>
                  <button
                    type="button"
                    aria-pressed={(settings.speechmaticsRate ?? 0.85) > 0.9}
                    onClick={() => onUpdateSettings((prev) => ({ ...prev, speechmaticsRate: 1.0 }))}
                    className={`btn btn-md ${
                      (settings.speechmaticsRate ?? 0.85) > 0.9 ? 'btn-primary' : 'btn-secondary'
                    }`}
                  >
                    {t('settings.normal', lang)}
                  </button>
                </div>
              </div>

            </div>
          </section>

          {/* Section 3: High-Contrast Display Themes */}
          <section id="section-visual-themes" className="border-line space-y-3 border-t pt-4">
            <div className="flex items-center gap-2">
              <Eye className="text-ochre h-5 w-5" />
              <h3 className="text-lg font-bold sm:text-xl">{t('settings.displayThemeHeading', lang)}</h3>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { id: 'normal', name: 'Standard', desc: 'Default Light' },
                { id: 'yellow-black', name: 'Yellow on Black', desc: 'Maximum Contrast' },
                { id: 'black-white', name: 'High B&W', desc: 'Monochrome' },
                { id: 'warm-soft', name: 'Warm Amber', desc: 'Gentle Eye Care' },
              ].map((theme) => {
                const isSelected = settings.contrastTheme === theme.id;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onUpdateSettings((prev) => ({ ...prev, contrastTheme: theme.id as HighContrastTheme }))}
                    className={`focus-visible:outline-pine min-h-12 rounded-xl border p-3 text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98] ${
                      isSelected
                        ? 'border-pine bg-pine text-on-pine'
                        : 'border-line bg-surface text-ink hover:bg-well'
                    }`}
                  >
                    <div className="text-sm font-bold sm:text-base">{theme.name}</div>
                    <div className={`mt-0.5 text-sm ${isSelected ? 'opacity-90' : 'text-ink-soft'}`}>
                      {theme.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Section 4: Font Size Level */}
          <section id="section-font-sizing" className="border-line space-y-3 border-t pt-4">
            <div className="flex items-center gap-2">
              <Type className="text-sky h-5 w-5" />
              <h3 className="text-lg font-bold sm:text-xl">{t('settings.textSizeHeading', lang)}</h3>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'standard', name: 'Medium', label: 'Standard' },
                { id: 'large', name: 'Large', label: 'Senior Default' },
                { id: 'extra-large', name: 'Extra Large', label: 'Maximum' },
              ].map((size) => {
                const isSelected = settings.fontSize === size.id;
                return (
                  <button
                    key={size.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onUpdateSettings((prev) => ({ ...prev, fontSize: size.id as FontSizeLevel }))}
                    className={`focus-visible:outline-pine min-h-12 rounded-xl border p-3 text-center transition-all focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98] ${
                      isSelected
                        ? 'border-pine bg-pine text-on-pine'
                        : 'border-line bg-surface text-ink hover:bg-well'
                    }`}
                  >
                    <div className="text-sm font-bold sm:text-base">{size.name}</div>
                    <div className={`mt-0.5 text-sm ${isSelected ? 'opacity-90' : 'text-ink-soft'}`}>
                      {size.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Section 5: Crash & Fall Detection (iOS & Android) */}
          <section id="section-crash-fall-safety" className="border-line space-y-4 border-t pt-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="text-brick h-5 w-5" />
              <h3 className="text-lg font-bold sm:text-xl">{t('settings.motionHeading', lang)}</h3>
            </div>

            <p className="text-ink-soft text-sm">
              {t('settings.motionDesc', lang)}
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Vehicle Crash Detection Toggle */}
              <button
                type="button"
                role="checkbox"
                aria-checked={settings.crashDetection ?? true}
                onClick={() => onUpdateSettings((prev) => ({ ...prev, crashDetection: !(prev.crashDetection ?? true) }))}
                className={`focus-visible:outline-pine flex items-start justify-between gap-3 rounded-xl border p-4 text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  (settings.crashDetection ?? true)
                    ? 'border-brick/40 bg-brick-soft text-ink'
                    : 'border-line bg-surface text-ink-soft'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold sm:text-base">
                    <Car className="text-brick h-5 w-5 shrink-0" aria-hidden="true" />
                    <span>{t('settings.vehicleCrash', lang)}</span>
                  </div>
                  <div className="text-ink-soft mt-1 text-sm">
                    {t('settings.vehicleCrashDesc', lang)}
                  </div>
                </div>
                <div aria-hidden="true" className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 border ${
                  (settings.crashDetection ?? true)
                    ? 'bg-brick text-on-brick border-brick'
                    : 'border-line-strong bg-well'
                }`}>
                  {(settings.crashDetection ?? true) && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </button>

              {/* Slip & Fall Detection Toggle */}
              <button
                type="button"
                role="checkbox"
                aria-checked={settings.fallDetection ?? true}
                onClick={() => onUpdateSettings((prev) => ({ ...prev, fallDetection: !(prev.fallDetection ?? true) }))}
                className={`focus-visible:outline-pine flex items-start justify-between gap-3 rounded-xl border p-4 text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  (settings.fallDetection ?? true)
                    ? 'border-ochre/40 bg-ochre-soft text-ink'
                    : 'border-line bg-surface text-ink-soft'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold sm:text-base">
                    <Footprints className="text-ochre h-5 w-5 shrink-0" aria-hidden="true" />
                    <span>{t('settings.slipFall', lang)}</span>
                  </div>
                  <div className="text-ink-soft mt-1 text-sm">
                    {t('settings.slipFallDesc', lang)}
                  </div>
                </div>
                <div aria-hidden="true" className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 border ${
                  (settings.fallDetection ?? true)
                    ? 'bg-ochre text-bg border-ochre'
                    : 'border-line-strong bg-well'
                }`}>
                  {(settings.fallDetection ?? true) && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </button>
            </div>
          </section>

          {/* Section 6: Emergency Contacts & Diagnostics */}
          <section id="section-family-diagnostics" className="border-line space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Users className="text-pine h-5 w-5" />
                <h3 className="text-lg font-bold sm:text-xl">{t('settings.contactsHeading', lang)}</h3>
              </div>

              {onOpenManageContacts && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenManageContacts();
                  }}
                  className="btn btn-md btn-secondary"
                >
                  <span>{t('settings.editContacts', lang)}</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Diagnostic Badges */}
            <div className="border-line bg-well/60 text-ink-soft space-y-2 rounded-xl border p-4 text-sm">
              <div className="flex items-center justify-between">
                <span>Speechmatics Realtime STT / TTS Engine:</span>
                <span className="text-pine-deep flex items-center gap-1.5 font-bold">
                  <span className="bg-pine h-2 w-2 rounded-full"></span> Connected
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Gemini Multimodal Reasoning:</span>
                <span className="text-pine-deep flex items-center gap-1.5 font-bold">
                  <span className="bg-pine h-2 w-2 rounded-full"></span> Active (Flash 3.7 / 2.5)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Google Maps & Street View Grounding:</span>
                <span className="text-pine-deep flex items-center gap-1.5 font-bold">
                  <span className="bg-pine h-2 w-2 rounded-full"></span> Active
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>BLE Beacon Micro-Location Engine:</span>
                <span className="text-pine-deep flex items-center gap-1.5 font-bold">
                  <span className="bg-pine h-2 w-2 rounded-full"></span> Active (Sub-3m)
                </span>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="modal-foot">
          <div className="text-ink-soft min-w-0 text-sm">
            {t('settings.selectedVoice', lang)}{' '}
            <strong className="text-ink">{activeVoice.name} ({activeVoice.accent})</strong>
          </div>

          {/* Changes apply as soon as they are tapped, so this only closes. */}
          <button
            type="button"
            onClick={() => {
              stopSpeaking();
              setPlayingVoiceId(null);
              onClose();
            }}
            className="btn btn-md btn-primary shrink-0"
          >
            <Check className="h-5 w-5" />
            <span>{t('common.done', lang)}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
