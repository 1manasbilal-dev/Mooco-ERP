import React, { useEffect, useRef, useState } from 'react';
import { AudioLines, Mic, MicOff, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { extractMoocoWakeCommand } from '../../lib/posVoiceCommand';

export type PosVoiceResult = {
  message: string;
  type?: 'success' | 'warning' | 'error' | 'info';
  returnToStandby?: boolean;
};

interface PosVoiceAssistantProps {
  onCommand: (transcript: string) => Promise<PosVoiceResult> | PosVoiceResult;
  isBusy?: boolean;
}

const playTone = (frequency: number, duration = 110) => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.06, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration / 1000);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration / 1000);
    oscillator.onended = () => context.close();
  } catch {
    // Audio feedback is optional; voice recognition continues without it.
  }
};

export const PosVoiceAssistant: React.FC<PosVoiceAssistantProps> = ({ onCommand, isBusy = false }) => {
  const [supported, setSupported] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const [awake, setAwake] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [voiceError, setVoiceError] = useState<'permission' | 'network' | null>(null);
  const [status, setStatus] = useState('Mic off — enable karke “Mooco” bolain');
  const [lastTranscript, setLastTranscript] = useState('');
  const recognitionRef = useRef<any>(null);
  const shouldListenRef = useRef(false);
  const awakeUntilRef = useRef(0);
  const awakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processingRef = useRef(false);
  const onCommandRef = useRef(onCommand);
  const isBusyRef = useRef(isBusy);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    isBusyRef.current = isBusy;
  }, [isBusy]);

  const returnToStandby = (message = 'Listening for “Mooco”…') => {
    awakeUntilRef.current = 0;
    setAwake(false);
    setStatus(message);
    if (awakeTimerRef.current) clearTimeout(awakeTimerRef.current);
  };

  const keepAwake = () => {
    awakeUntilRef.current = Date.now() + 15000;
    setAwake(true);
    if (awakeTimerRef.current) clearTimeout(awakeTimerRef.current);
    awakeTimerRef.current = setTimeout(() => returnToStandby(), 15000);
  };

  useEffect(() => {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      setSupported(false);
      setStatus('Voice commands is browser mein supported nahi hain');
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.lang = 'en-PK';
    recognitionRef.current = recognition;

    recognition.onstart = () => setListening(true);

    recognition.onresult = async (event: any) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (!event.results[index].isFinal) continue;
        const transcript = String(event.results[index][0]?.transcript || '').trim();
        if (!transcript || processingRef.current) continue;
        setLastTranscript(transcript);

        const wakeCommand = extractMoocoWakeCommand(transcript);
        const isCurrentlyAwake = awakeUntilRef.current > Date.now();
        if (!isCurrentlyAwake && !wakeCommand.detected) {
          setStatus('Listening for “Mooco”…');
          continue;
        }

        if (!isCurrentlyAwake && wakeCommand.detected) {
          keepAwake();
          setStatus('Active — product aur quantity ya rupees bolain');
          playTone(780);
          if (!wakeCommand.remainder) continue;
        }

        if (isCurrentlyAwake && wakeCommand.detected && !wakeCommand.remainder) {
          keepAwake();
          setStatus('Active — product aur quantity ya rupees bolain');
          playTone(780);
          continue;
        }

        const commandText = wakeCommand.detected && wakeCommand.remainder
          ? wakeCommand.remainder
          : transcript;

        if (isBusyRef.current) {
          setStatus('Sale save ho rahi hai — thora wait karein');
          playTone(240);
          continue;
        }

        processingRef.current = true;
        setIsProcessing(true);
        setStatus(`Samjha: “${commandText}”`);
        try {
          const result = await onCommandRef.current(commandText);
          setStatus(result.message);
          playTone(result.type === 'error' || result.type === 'warning' ? 240 : 960);
          if (result.returnToStandby) {
            returnToStandby(result.message);
          } else {
            keepAwake();
            setStatus(result.message);
          }
        } catch {
          setStatus('Command process nahi hui. Dobara bolain.');
          playTone(240);
          keepAwake();
        } finally {
          processingRef.current = false;
          setIsProcessing(false);
        }
      }
    };

    recognition.onerror = (event: any) => {
      const error = String(event?.error || '');
      if (error === 'not-allowed' || error === 'service-not-allowed') {
        shouldListenRef.current = false;
        setEnabled(false);
        setVoiceError('permission');
        setStatus('Microphone permission blocked — browser settings se allow karein');
        setListening(false);
        return;
      }
      if (error === 'network') {
        setVoiceError('network');
        setStatus('Voice service ke liye internet check karein');
      } else if (error !== 'no-speech' && error !== 'aborted') {
        setStatus('Mic dobara start ho raha hai…');
      }
    };

    recognition.onend = () => {
      setListening(false);
      if (!shouldListenRef.current) return;
      restartTimerRef.current = setTimeout(() => {
        try {
          recognition.start();
        } catch {
          // A running recognition session will restart through its next onend event.
        }
      }, 300);
    };

    return () => {
      shouldListenRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (awakeTimerRef.current) clearTimeout(awakeTimerRef.current);
      try {
        recognition.abort();
      } catch {
        // Recognition may already be stopped.
      }
      recognitionRef.current = null;
    };
  }, []);

  const toggleMicrophone = () => {
    if (!supported || !recognitionRef.current) return;
    setVoiceError(null);

    if (enabled) {
      shouldListenRef.current = false;
      setEnabled(false);
      setListening(false);
      returnToStandby('Mic off — enable karke “Mooco” bolain');
      try {
        recognitionRef.current.stop();
      } catch {
        // Recognition may already be stopped.
      }
      return;
    }

    shouldListenRef.current = true;
    setEnabled(true);
    setStatus('Listening for “Mooco”…');
    playTone(560);
    try {
      recognitionRef.current.start();
    } catch {
      setStatus('Mic start ho raha hai…');
    }
  };

  const statusClasses = voiceError
    ? 'border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40'
    : isProcessing
      ? 'border-indigo-300 bg-indigo-50/70 dark:border-indigo-900 dark:bg-indigo-950/40'
      : awake
        ? 'border-lime-300 bg-lime-50 dark:border-lime-800 dark:bg-lime-950/40'
        : enabled
          ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30'
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900';

  return (
    <div className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 shadow-xs shrink-0 ${statusClasses}`}>
      <button
        type="button"
        onClick={toggleMicrophone}
        disabled={!supported}
        aria-pressed={enabled}
        className={`h-9 px-3 rounded-lg flex items-center gap-2 text-xs font-black transition-all ${
          enabled
            ? 'bg-lime-600 hover:bg-lime-700 text-white shadow-sm cursor-pointer'
            : supported
              ? 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 cursor-pointer'
              : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
        }`}
        title={enabled ? 'Turn voice POS off' : 'Turn voice POS on'}
      >
        {enabled ? <Mic size={15} className={listening ? 'animate-pulse' : ''} /> : <MicOff size={15} />}
        {enabled ? 'Voice On' : 'Enable Voice'}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <AudioLines size={14} className={awake ? 'text-lime-700 dark:text-lime-400' : isProcessing ? 'text-indigo-600 dark:text-indigo-400 animate-pulse' : 'text-slate-400'} />
          <span className={`text-xs font-bold truncate ${awake ? 'text-lime-800 dark:text-lime-300' : isProcessing ? 'text-indigo-800 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'}`}>
            {status}
          </span>
          {isProcessing && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 shadow-2xs animate-pulse shrink-0">
              <Loader2 size={10} className="animate-spin" /> Processing...
            </span>
          )}
          {awake && !isProcessing && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-lime-100 dark:bg-lime-900/60 text-lime-800 dark:text-lime-300 shadow-2xs shrink-0 animate-pulse">
              <Sparkles size={10} /> Listening...
            </span>
          )}
          {voiceError === 'permission' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300 shadow-2xs shrink-0">
              <AlertCircle size={10} /> Mic Blocked
            </span>
          )}
          {voiceError === 'network' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 shadow-2xs shrink-0">
              <AlertCircle size={10} /> Network Offline
            </span>
          )}
        </div>
        {lastTranscript && (
          <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
            Last heard: {lastTranscript}
          </p>
        )}
      </div>

      <div className="hidden xl:block text-[10px] leading-4 text-right text-slate-500 dark:text-slate-400 shrink-0">
        <div>“Mooco” → “Cow Milk 2 litre”</div>
        <div>“Cow Milk 500 rupees” → “Save entry”</div>
      </div>
    </div>
  );
};
