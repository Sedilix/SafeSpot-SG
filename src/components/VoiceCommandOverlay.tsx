/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  X,
  Volume2,
  Sparkles,
  Radio,
  MapPin,
  Send,
  Camera,
  Siren,
} from 'lucide-react';
import { RealtimeClient } from '@speechmatics/real-time-client';
import { AccessibilitySettings, EmergencyContact, LocationVerificationResult } from '../types';
import { 
  initSpeechRecognition, 
  SpeechRecognitionController, 
  speakSpeechmaticsOrFallback, 
  stopSpeaking 
} from '../utils/speech';
import { t } from '../locales/translations';
import { useEscapeToClose } from '../utils/useEscapeToClose';
import { appPermissionKey, permissionText } from '../lib/geolocation';

interface VoiceCommandOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  currentAddress: string;
  verification: LocationVerificationResult | null;
  emergencyContacts: EmergencyContact[];
  settings: AccessibilitySettings;
  onTriggerSendLocation: () => void;
  onTriggerEmergency: () => void;
  onTriggerCamera: () => void;
  onToggleContrast: () => void;
  onSpeakAddress: () => void;
  onOpenSettings?: () => void;
}

export const VoiceCommandOverlay: React.FC<VoiceCommandOverlayProps> = ({
  isOpen,
  onClose,
  currentAddress,
  verification,
  emergencyContacts,
  settings,
  onTriggerSendLocation,
  onTriggerEmergency,
  onTriggerCamera,
  onToggleContrast,
  onSpeakAddress,
  onOpenSettings,
}) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [assistantResponse, setAssistantResponse] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [recognizedAction, setRecognizedAction] = useState<string | null>(null);
  const [isSpeechmaticsActive, setIsSpeechmaticsActive] = useState(false);
  // Translation key for the one-line engine status under the mic.
  const [engineStatus, setEngineStatus] = useState<string>('voice.engineStarting');

  const lang = settings.language || 'en';

  const controllerRef = useRef<SpeechRecognitionController | null>(null);
  const speechmaticsClientRef = useRef<RealtimeClient | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const accumulatedTranscriptRef = useRef<string>('');
  const isListeningRef = useRef(false);

  void verification;

  useEffect(() => {
    if (!isOpen) {
      cleanupAudioSession();
      setIsListening(false);
      isListeningRef.current = false;
      return;
    }

    // Auto-start listening on open
    startListening();

    return () => {
      cleanupAudioSession();
    };
  }, [isOpen]);

  const cleanupAudioSession = () => {
    if (speechmaticsClientRef.current) {
      try {
        speechmaticsClientRef.current.stopRecognition({ noTimeout: true }).catch(() => {});
      } catch (e) {}
      speechmaticsClientRef.current = null;
    }

    if (scriptProcessorRef.current) {
      try {
        scriptProcessorRef.current.disconnect();
      } catch (e) {}
      scriptProcessorRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {}
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (controllerRef.current) {
      controllerRef.current.stop();
      controllerRef.current = null;
    }
  };

  const startListening = async () => {
    cleanupAudioSession();
    setTranscript('');
    setInterimTranscript('');
    accumulatedTranscriptRef.current = '';
    setAssistantResponse(t('voice.speakAnytime', lang));
    setRecognizedAction(null);

    // Step 1: Check Speechmatics Realtime token from backend
    try {
      const tokenRes = await fetch('/api/speechmatics/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const tokenData = await tokenRes.json();

      if (tokenData.hasSpeechmaticsKey && tokenData.token) {
        // Start Speechmatics Realtime SDK Client
        setEngineStatus('voice.engineConnecting');
        setIsSpeechmaticsActive(true);
        await startSpeechmaticsSession(tokenData.token, tokenData.url);
        return;
      }
    } catch (e) {
      console.warn('Speechmatics check notice:', e);
    }

    // Step 2: Fallback to Browser Speech Recognition
    startWebSpeechFallback();
  };

  const startSpeechmaticsSession = async (jwtToken: string, endpointUrl?: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      audioContextRef.current = audioCtx;

      const client = new RealtimeClient({
        url: endpointUrl || 'wss://eu2.rt.speechmatics.com/v2',
      });
      speechmaticsClientRef.current = client;

      // Event Listeners for Speechmatics Realtime messages
      client.addEventListener('receiveMessage', ({ data }) => {
        if (data.message === 'AddPartialTranscript') {
          const partialText = data.results?.map((r) => r.alternatives?.[0]?.content).join(' ') || data.metadata?.transcript || '';
          if (partialText) {
            setInterimTranscript(partialText);
          }
        } else if (data.message === 'AddTranscript') {
          const finalSeg = data.metadata?.transcript || data.results?.map((r) => r.alternatives?.[0]?.content).join(' ') || '';
          if (finalSeg) {
            accumulatedTranscriptRef.current += (accumulatedTranscriptRef.current ? ' ' : '') + finalSeg;
            setTranscript(accumulatedTranscriptRef.current);
            setInterimTranscript('');
          }
        } else if (data.message === 'EndOfUtterance') {
          const fullText = accumulatedTranscriptRef.current.trim();
          if (fullText) {
            handleProcessVoiceCommand(fullText);
          }
        }
      });

      // Stream PCM audio from microphone to Speechmatics
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!isListeningRef.current) return;
        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32Array to 16-bit PCM buffer for Speechmatics raw format
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        client.sendAudio(pcm16.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      // Start recognition session with enhanced English and conversational silence trigger
      await client.start(jwtToken, {
        transcription_config: {
          language: 'en',
          operating_point: 'enhanced',
          enable_partials: true,
          conversation_config: {
            end_of_utterance_silence_trigger: 1.5,
          },
        },
        audio_format: {
          type: 'raw',
          encoding: 'pcm_s16le',
          sample_rate: 16000,
        },
      });

      setIsListening(true);
      isListeningRef.current = true;
      setEngineStatus('voice.engineMicOn');
    } catch (err) {
      console.error('Error starting Speechmatics session:', err);
      // In the app the browser fallback needs the same microphone, so a
      // refusal points to Android Settings instead of falling back.
      const appKey = appPermissionKey(err, 'microphone');
      if (appKey) {
        cleanupAudioSession();
        setIsSpeechmaticsActive(false);
        setEngineStatus('voice.engineUnavailable');
        setAssistantResponse(permissionText(appKey, lang));
        return;
      }
      startWebSpeechFallback();
    }
  };

  const startWebSpeechFallback = () => {
    setIsSpeechmaticsActive(false);
    setEngineStatus('voice.engineBrowser');

    const controller = initSpeechRecognition(
      (text, isFinal) => {
        setTranscript(text);
        if (isFinal) {
          handleProcessVoiceCommand(text);
        }
      },
      (err) => {
        console.warn('Voice recognition notice:', err);
        setIsListening(false);
        isListeningRef.current = false;
      },
      () => {
        setIsListening(false);
        isListeningRef.current = false;
      }
    );

    if (controller) {
      controllerRef.current = controller;
      controller.start();
      setIsListening(true);
      isListeningRef.current = true;
    } else {
      // There is no text box here, so never ask the senior to type.
      setEngineStatus('voice.engineUnavailable');
      setAssistantResponse(t('voice.noVoiceTyping', lang));
    }
  };

  const stopListening = () => {
    const textToProcess = accumulatedTranscriptRef.current.trim() || transcript.trim() || interimTranscript.trim();
    cleanupAudioSession();
    setIsListening(false);
    isListeningRef.current = false;

    if (textToProcess) {
      handleProcessVoiceCommand(textToProcess);
    }
  };

  const handleProcessVoiceCommand = async (spokenText: string) => {
    if (!spokenText.trim()) return;
    setIsProcessing(true);
    cleanupAudioSession();
    setIsListening(false);
    isListeningRef.current = false;

    try {
      // Step 2: Route transcript into Gemini's Reasoning & Semantic Inference Engine
      const res = await fetch('/api/gemini/voice-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: spokenText,
          currentAddress,
          emergencyContacts,
        }),
      });

      const data = await res.json();
      const responseText = data.spokenResponse || 'Understood.';
      setAssistantResponse(responseText);
      setRecognizedAction(data.action);

      // Step 3: Speak the reply aloud. This is on-demand by definition — the
      // senior spoke first — so it is not gated behind the spokenGuidance toggle.
      await speakSpeechmaticsOrFallback(
        responseText, 
        settings.speechmaticsVoice || 'sarah',
        undefined,
        settings.speechmaticsRate ?? 0.85,
        lang
      );

      // Step 4: Execute structured physical action with reassuring delay
      if (data.action === 'SEND_LOCATION') {
        setTimeout(() => {
          onTriggerSendLocation();
          onClose();
        }, 1600);
      } else if (data.action === 'READ_LOCATION') {
        onSpeakAddress();
      } else if (data.action === 'ANALYZE_PHOTO') {
        setTimeout(() => {
          onTriggerCamera();
          onClose();
        }, 1300);
      } else if (data.action === 'EMERGENCY_TRIGGER') {
        setTimeout(() => {
          onTriggerEmergency();
          onClose();
        }, 1000);
      } else if (data.action === 'TOGGLE_CONTRAST') {
        onToggleContrast();
      }
    } catch (e) {
      console.error('Voice assistant error:', e);
      setAssistantResponse(`${t('voice.iHeard', lang)} "${spokenText}". ${t('voice.tapPhraseBelow', lang)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  useEscapeToClose(isOpen, onClose);

  if (!isOpen) return null;

  const closeOverlay = () => {
    stopSpeaking();
    cleanupAudioSession();
    onClose();
  };

  const voiceName = settings.speechmaticsVoice || 'sarah';

  return (
    <div
      id="modal-voice-command-overlay"
      className="voice-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-overlay-title"
    >
      {/* Scrolls inside itself on short phone screens instead of clipping. */}
      <div className="voice-panel max-h-[92vh] overflow-y-auto overscroll-contain supports-[height:100dvh]:max-h-[92dvh]">
        {/* Top bar */}
        <div className="voice-divider mb-6 flex items-start justify-between gap-3 border-b pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="voice-well voice-accent flex h-11 w-11 shrink-0 items-center justify-center" aria-hidden="true">
              <Radio className={`h-5 w-5 ${isListening ? 'animate-pulse motion-reduce:animate-none' : ''}`} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="voice-overlay-title"
                  className="font-display voice-text text-2xl leading-none font-bold tracking-tight"
                >
                  {t('voice.title', lang)}
                </h2>
                {isSpeechmaticsActive && <span className="voice-chip">Speechmatics</span>}
              </div>
              <p className="voice-subtle mt-1 text-sm font-normal sm:text-base">{t('voice.poweredBy', lang)}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  closeOverlay();
                  onOpenSettings();
                }}
                className="voice-btn flex min-h-12 items-center gap-1.5 px-3 py-2"
                aria-label={`${t('voice.voiceLabel', lang)} ${voiceName}`}
              >
                <Volume2 aria-hidden="true" className="voice-accent h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">{t('voice.voiceLabel', lang)}</span>
                <span className="voice-text capitalize">{voiceName}</span>
              </button>
            )}

            <button
              type="button"
              onClick={closeOverlay}
              className="voice-btn accessible-tap p-2"
              aria-label={t('voice.close', lang)}
            >
              <X aria-hidden="true" className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Center mic */}
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <button
            id="btn-voice-mic-main"
            type="button"
            onClick={isListening ? stopListening : startListening}
            aria-pressed={isListening}
            aria-label={isListening ? t('voice.stopListening', lang) : t('voice.startListening', lang)}
            className={`voice-mic h-24 w-24 sm:h-28 sm:w-28 ${
              isListening
                ? 'bg-brick text-on-brick ring-8 ring-brick/40 animate-pulse motion-reduce:animate-none'
                : 'bg-pine text-on-pine hover:bg-pine-deep'
            }`}
          >
            <Mic aria-hidden="true" className="h-10 w-10" />
          </button>

          <div role="status" className="voice-text mt-4 text-lg font-bold sm:text-xl">
            {isListening
              ? t('voice.listening', lang)
              : isProcessing
              ? t('voice.reasoning', lang)
              : t('voice.tapToSpeak', lang)}
          </div>

          {/* Engine indicator: the dot only moves while the mic is really on */}
          <div className="voice-subtle mt-1 flex items-center justify-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className={`inline-block h-2 w-2 rounded-full bg-current ${
                isListening ? 'voice-accent animate-pulse motion-reduce:animate-none' : ''
              }`}
            />
            <span>{t(engineStatus, lang)}</span>
          </div>

          {/* Live transcript */}
          {(transcript || interimTranscript) && (
            <div className="voice-well mt-4 w-full max-w-lg p-4 text-left">
              <div className="voice-subtle mb-1 text-sm font-bold">{t('voice.transcribed', lang)}</div>
              <p className="voice-text text-base font-bold italic sm:text-lg">“{transcript || interimTranscript}”</p>
            </div>
          )}

          {/* Assistant reply */}
          {assistantResponse && (
            <div
              aria-live="polite"
              className="voice-well mt-4 flex w-full max-w-lg items-start gap-3 p-4 text-left"
            >
              <Sparkles aria-hidden="true" className="voice-accent mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <div className="voice-subtle mb-1 text-sm font-bold">{t('voice.geminiDecision', lang)}</div>
                <p className="voice-text text-sm leading-snug font-semibold sm:text-base">{assistantResponse}</p>
              </div>
            </div>
          )}
        </div>

        {/* Quick phrases */}
        <div className="voice-divider mt-6 border-t pt-4">
          <h3 className="voice-label mb-3 font-body">{t('voice.quickPhrasesTitle', lang)}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => handleProcessVoiceCommand('Where am I right now?')}
              className="voice-btn flex min-h-12 items-center gap-2.5"
            >
              <MapPin aria-hidden="true" className="voice-accent h-5 w-5 shrink-0" />
              <span>{t('voice.phraseWhere', lang)}</span>
            </button>

            <button
              type="button"
              onClick={() => handleProcessVoiceCommand('Send my exact location to my family')}
              className="voice-btn flex min-h-12 items-center gap-2.5"
            >
              <Send aria-hidden="true" className="voice-accent h-5 w-5 shrink-0" />
              <span>{t('voice.phraseSendFamily', lang)}</span>
            </button>

            <button
              type="button"
              onClick={() => handleProcessVoiceCommand('Take a photo of where I am standing')}
              className="voice-btn flex min-h-12 items-center gap-2.5"
            >
              <Camera aria-hidden="true" className="voice-accent h-5 w-5 shrink-0" />
              <span>{t('voice.phraseSurroundings', lang)}</span>
            </button>

            <button
              type="button"
              onClick={() => handleProcessVoiceCommand('I need urgent Singapore SCDF 995 ambulance')}
              className="voice-btn-danger flex min-h-12 items-center gap-2.5"
            >
              <Siren aria-hidden="true" className="h-5 w-5 shrink-0" />
              <span>{t('voice.phrase995', lang)}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
