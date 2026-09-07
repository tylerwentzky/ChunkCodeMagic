import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Mic, Volume2, Loader2, AlertCircle } from 'lucide-react';
import { TtsEngine, ALL_VOICES, cleanTextForSpeech } from '../../lib/ttsEngine';
import { buildDirectorPromptFromProfile } from '../../lib/voiceDirector';
import { getSettings, CharacterProfile } from '../../lib/types';

interface VoiceChatDialogProps {
  isOpen: boolean;
  onClose: () => void;
  profile: CharacterProfile;
  storySummary: string;
  messages: Array<{ id: string; role: string; text: string }>;
  isStreaming: boolean;
  onSendMessage: (text: string) => Promise<void> | void;
}

export function VoiceChatDialog({ isOpen, onClose, profile, storySummary, messages, isStreaming, onSendMessage }: VoiceChatDialogProps) {
  const [phase, setPhase] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [transcript, setTranscript] = useState('');
  const [replyText, setReplyText] = useState('');
  const [handsFree, setHandsFree] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const spokenIds = useRef<Set<string>>(new Set());
  const ttsRef = useRef<TtsEngine | null>(null);
  const recognitionRef = useRef<any>(null);
  const isMountedRef = useRef(true);
  const sttWatchdogRef = useRef<any>(null);

  if (!ttsRef.current) ttsRef.current = new TtsEngine();

  // Cleanup on dialog close or unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      if (sttWatchdogRef.current) {
        clearTimeout(sttWatchdogRef.current);
        sttWatchdogRef.current = null;
      }
      try { recognitionRef.current?.abort(); } catch {}
      try { ttsRef.current?.stop(); } catch {}
      if (isMountedRef.current) {
        setPhase('idle');
        setAwaitingReply(false);
        setSttError(null);
      }
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (sttWatchdogRef.current) {
        clearTimeout(sttWatchdogRef.current);
        sttWatchdogRef.current = null;
      }
      try { recognitionRef.current?.abort(); } catch {}
      try { ttsRef.current?.stop(); } catch {}
    };
  }, []);

  const handsFreeRef = useRef(handsFree);
  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);

  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const launchSTT = useCallback(() => {
    if (!isMountedRef.current) return;
    if (phaseRef.current === 'speaking' || phaseRef.current === 'listening' || ttsRef.current?.isSpeaking) return;
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      if (isMountedRef.current) {
        setSttError('Speech recognition is not supported by your current browser. Please try Chrome, Edge, or Safari.');
        setPhase('idle');
      }
      return;
    }
    if (isMountedRef.current) setSttError(null);
    if (sttWatchdogRef.current) {
      clearTimeout(sttWatchdogRef.current);
      sttWatchdogRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    if (isMountedRef.current) setPhase('listening');

    // 10-second watchdog timer for mobile browsers where onend/onerror may hang
    sttWatchdogRef.current = setTimeout(() => {
      if (isMountedRef.current && phaseRef.current === 'listening') {
        try { rec.abort(); } catch {}
        setPhase('idle');
      }
    }, 10000);

    const clearWatchdog = () => {
      if (sttWatchdogRef.current) {
        clearTimeout(sttWatchdogRef.current);
        sttWatchdogRef.current = null;
      }
    };

    rec.onresult = (e: any) => {
      clearWatchdog();
      const heard = e.results?.[0]?.[0]?.transcript?.trim();
      if (heard && isMountedRef.current) {
        setTranscript(heard);
        setPhase('thinking');
        setAwaitingReply(true);
        try {
          const r = onSendMessage(heard);
          if (r instanceof Promise) {
            r.catch(() => {
              if (isMountedRef.current) setPhase('idle');
            });
          }
        } catch {
          if (isMountedRef.current) setPhase('idle');
        }
      } else if (isMountedRef.current) {
        setPhase('idle');
      }
    };
    rec.onerror = () => {
      clearWatchdog();
      if (isMountedRef.current) setPhase('idle');
    };
    rec.onend = () => {
      clearWatchdog();
      if (isMountedRef.current && phaseRef.current === 'listening') {
        setPhase('idle');
      }
    };
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      clearWatchdog();
      if (isMountedRef.current) setPhase('idle');
    }
  }, [onSendMessage]);

  // Watch for AI reply
  useEffect(() => {
    if (!isOpen || !awaitingReply || isStreaming) return;
    const last = messages[messages.length - 1];
    if (!last || last.role === 'user') return;
    if (spokenIds.current.has(last.id)) return;
    spokenIds.current.add(last.id);
    if (!isMountedRef.current) return;
    setAwaitingReply(false);

    const cleanSpeech = cleanTextForSpeech(last.text);
    if (!cleanSpeech) {
      setPhase('idle');
      return;
    }
    setReplyText(cleanSpeech);
    setPhase('speaking');

    const voiceName = profile.voiceName?.trim() || getSettings().liveVoiceName || 'Kore';
    const useFast = (getSettings().voiceQuality || 'quality') !== 'quality';
    const directorPrompt = buildDirectorPromptFromProfile(profile, storySummary, (profile as any).backstory || '', cleanSpeech) || undefined;

    (async () => {
      try {
        const tts = ttsRef.current!;
        await tts.speak(cleanSpeech, voiceName, directorPrompt || null, useFast, () => {
          if (isMountedRef.current) {
            setPhase('idle');
            if (handsFreeRef.current && isOpen) {
              setTimeout(() => {
                if (handsFreeRef.current && isMountedRef.current && phaseRef.current === 'idle' && !ttsRef.current?.isSpeaking) {
                  launchSTT();
                }
              }, 400);
            }
          }
        });
      } catch {
        if (isMountedRef.current) {
          setPhase('idle');
          if (handsFreeRef.current && isOpen) {
            setTimeout(() => {
              if (handsFreeRef.current && isMountedRef.current && phaseRef.current === 'idle' && !ttsRef.current?.isSpeaking) {
                launchSTT();
              }
            }, 400);
          }
        }
      }
    })();
  }, [isOpen, messages, isStreaming, awaitingReply, profile, storySummary, launchSTT]);

  const handleMicClick = () => {
    if (phase === 'speaking') {
      try { ttsRef.current?.stop(); } catch {}
      setPhase('idle');
      return;
    }
    if (phase === 'listening') {
      try { recognitionRef.current?.abort(); } catch {}
      setPhase('idle');
      return;
    }
    launchSTT();
  };

  // handsFree auto-loop
  useEffect(() => {
    if (!isOpen) return;
    if (handsFreeRef.current && phaseRef.current === 'idle' && !awaitingReply && !ttsRef.current?.isSpeaking) {
      const id = setTimeout(() => {
        if (handsFreeRef.current && phaseRef.current === 'idle' && !awaitingReply && !ttsRef.current?.isSpeaking) {
          launchSTT();
        }
      }, 800);
      return () => clearTimeout(id);
    }
  }, [isOpen, handsFree, phase, awaitingReply, launchSTT]);

  if (!isOpen) return null;

  const voiceName = profile.voiceName?.trim() || getSettings().liveVoiceName || 'Kore';
  const voiceDesc = ALL_VOICES.find(v => v.name === voiceName)?.character || '';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
      <div className="bg-zinc-950 border border-white/10 rounded-[28px] w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Voice Chat</h2>
            <p className="text-xs text-zinc-400">{profile.name || 'Character'} · {voiceName} {voiceDesc ? `— ${voiceDesc}` : ''}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          {sttError && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{sttError}</span>
            </div>
          )}

          <div className="w-full min-h-[100px] max-h-[200px] rounded-2xl bg-white/[0.04] border border-white/5 p-3 overflow-y-auto space-y-2">
            {transcript && <p className="text-sm text-emerald-300"><span className="font-semibold">You:</span> {transcript}</p>}
            {replyText && <p className="text-sm text-amber-200"><span className="font-semibold">{profile.name}:</span> {replyText}</p>}
            {!transcript && !replyText && (
              <p className="text-sm text-zinc-500">
                {phase === 'listening' ? 'Listening… speak now' : phase === 'thinking' ? 'Thinking…' : phase === 'speaking' ? 'Speaking…' : 'Tap mic to speak. Hands-free keeps listening automatically.'}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">{handsFree ? 'Hands-free' : 'Tap mode'}</span>
            <button
              role="switch"
              aria-checked={handsFree}
              onClick={() => setHandsFree(v => !v)}
              className={`w-10 h-5 rounded-full relative transition-colors ${handsFree ? 'bg-emerald-600' : 'bg-zinc-800'}`}
            >
              <span className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${handsFree ? 'left-6' : 'left-1'}`} />
            </button>
          </div>

          <button
            onClick={handleMicClick}
            className={`w-full h-28 rounded-2xl flex flex-col items-center justify-center gap-2 transition-colors ${
              phase === 'speaking' ? 'bg-red-500/20 border border-red-500/30 text-red-300' :
              phase === 'listening' ? 'bg-red-500/30 border border-red-500/40 text-red-200' :
              phase === 'thinking' ? 'bg-white/5 border border-white/10 text-zinc-400' :
              'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {phase === 'thinking' ? <Loader2 className="w-8 h-8 animate-spin" /> : phase === 'speaking' ? <Volume2 className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
            <span className="text-xs font-bold uppercase tracking-wider">
              {phase === 'listening' ? 'LISTENING — TAP TO CANCEL' : phase === 'thinking' ? 'THINKING…' : phase === 'speaking' ? 'TAP TO STOP' : 'TAP TO TALK'}
            </span>
          </button>
          {phase === 'speaking' && <p className="text-[11px] text-center text-zinc-500">Speaking via {(getSettings().voiceQuality === 'speed' ? 'Flash (fast)' : 'Pro (quality)')} — tap to interrupt</p>}
        </div>

        <div className="px-6 py-3 border-t border-white/10 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white">Close</button>
        </div>
      </div>
    </div>
  );
}
