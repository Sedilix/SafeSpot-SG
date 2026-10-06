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
  Cpu,
  Waves
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
  const [engineStatus, setEngineStatus] = useState<string>('Initializing speech engine...');

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
    setAssistantResponse('Listening to your voice... Speak anytime.');
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
        setEngineStatus('Speechmatics Realtime SDK Connected');
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
      setEngineStatus('Speechmatics Realtime SDK Active • Listening');
    } catch (err) {
      console.error('Error starting Speechmatics session:', err);
      startWebSpeechFallback();
    }
  };

  const startWebSpeechFallback = () => {
    setIsSpeechmaticsActive(false);
    setEngineStatus('Web Speech Assistant Active');

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
      setAssistantResponse('Microphone voice typing ready. Tap a quick phrase below or type your request.');
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
        settings.speechmaticsRate ?? 0.85
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
      setAssistantResponse(`I heard: "${spokenText}". Tap an option below to proceed.`);
    } finally {
      setIsProcessing(false);
    }
  };

  useEscapeToClose(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      id="modal-voice-command-overlay"
      className="voice-backdrop"
      role="dialog"
      aria-modal="true"
    >
      <div className="voice-panel">
        {/* Top bar */}
        <div className="mb-6 flex items-center justify-between border-b voice-divider pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#4a4232] bg-[#2e281d] voice-accent">
              <Radio className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-2xl leading-none font-bold tracking-tight voice-text">
                  {t('voice.title', lang)}
                </h3>
                {isSpeechmaticsActive && (
                  <span className="voice-chip">
                    <Waves className="h-3.5 w-3.5 animate-pulse" /> Speechmatics STT
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm font-normal voice-subtle sm:text-base">
                {t('voice.poweredBy', lang)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  stopSpeaking();
                  cleanupAudioSession();
                  onClose();
                  onOpenSettings();
                }}
                className="flex items-center gap-1.5 rounded-xl border border-[#5a5140] bg-[#2e281d] px-3 py-2 text-sm font-bold voice-subtle transition-all hover:bg-[#383123] active:scale-[0.97]"
                title="Change Speechmatics voice"
              >
                <Volume2 className="h-4 w-4 voice-accent" />
                <span className="hidden sm:inline">{t('voice.voiceLabel', lang)}</span>
                <span className="uppercase voice-text">{settings.speechmaticsVoice || 'SARAH'}</span>
              </button>
            )}

            <button
              onClick={() => {
                stopSpeaking();
                cleanupAudioSession();
                onClose();
              }}
              className="accessible-tap rounded-xl p-2 voice-subtle transition-all hover:bg-[#2e281d] hover:voice-text active:scale-[0.97]"
              aria-label="Close voice assistant"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Center Mic & Waveform */}
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <button
            id="btn-voice-mic-main"
            onClick={isListening ? stopListening : startListening}
            className={`flex h-24 w-24 items-center justify-center rounded-full shadow-xl transition-all active:scale-95 sm:h-28 sm:w-28 ${
              isListening
                ? 'bg-brick text-on-brick ring-8 ring-brick/40 animate-pulse'
                : 'bg-pine text-on-pine hover:bg-pine-deep'
            }`}
            aria-label={isListening ? 'Stop listening' : 'Start listening'}
          >
            <Mic className={`h-10 w-10 ${isListening ? 'animate-bounce' : ''}`} />
          </button>

          <div className="mt-4 text-lg font-bold voice-text sm:text-xl">
            {isListening
              ? t('voice.listening', lang)
              : isProcessing
              ? t('voice.reasoning', lang)
              : t('voice.tapToSpeak', lang)}
          </div>

          {/* Engine Indicator */}
          <div className="mt-1 flex items-center justify-center gap-2 text-sm voice-subtle">
            <span className="inline-block h-2 w-2 animate-ping rounded-full bg-emerald-400" />
            <span>{engineStatus}</span>
          </div>

          {/* Live Transcript / Speech Stream */}
          {(transcript || interimTranscript) && (
            <div className="mt-4 w-full max-w-lg voice-well p-4 text-left">
              <div className="mb-1 flex items-center justify-between text-xs font-bold tracking-wide voice-subtle uppercase">
                <span>{t('voice.transcribed', lang)}</span>
                {isSpeechmaticsActive && <span className="text-[11px] font-bold voice-subtle">Speechmatics Realtime</span>}
              </div>
              <p className="text-base font-bold italic voice-text sm:text-lg">
                “{transcript || interimTranscript}”
              </p>
            </div>
          )}

          {/* Gemini AI Spoken Response Card */}
          {assistantResponse && (
            <div className="mt-4 flex w-full max-w-lg items-start gap-3 voice-well p-4 text-left shadow-sm">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <div className="mb-1 flex items-center gap-1.5 text-xs font-bold tracking-wide voice-subtle uppercase">
                  <Cpu className="h-4 w-4 text-sky-400" />
                  <span>{t('voice.geminiDecision', lang)}</span>
                  {recognizedAction && (
                    <span className="ml-auto rounded-full bg-[#383123] px-2 py-0.5 text-[10px] font-bold voice-subtle">
                      {recognizedAction}
                    </span>
                  )}
                </div>
                <p className="text-sm leading-snug font-semibold sm:text-base">
                  {assistantResponse}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Quick Speech Phrase Buttons */}
        <div className="mt-6 border-t voice-divider pt-4">
          <div className="mb-3 voice-label">
            {t('voice.quickPhrasesTitle', lang)}
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              onClick={() => handleProcessVoiceCommand('Where am I right now?')}
              className="voice-btn"
            >
              🗣️ {t('voice.phraseWhere', lang)}
            </button>

            <button
              onClick={() => handleProcessVoiceCommand('Send my exact location to my daughter Sarah')}
              className="voice-btn"
            >
              🗣️ {t('voice.phraseSendSarah', lang)}
            </button>

            <button
              onClick={() => handleProcessVoiceCommand('Take a photo of where I am standing')}
              className="voice-btn"
            >
              📷 {t('voice.phraseSurroundings', lang)}
            </button>

            <button
              onClick={() => handleProcessVoiceCommand('I need urgent Singapore SCDF 995 ambulance')}
              className="voice-btn-danger"
            >
              🚨 {t('voice.phrase995', lang)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
