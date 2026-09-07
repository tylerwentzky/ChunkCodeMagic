/**
 * Web parity of Android GeminiTtsClient.kt
 * Same model fallback chains, voice list, quota detection, 24kHz PCM16 playback via Web Audio.
 */
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { getGenAI } from './gemini';
import { getSettings } from './types';

export const SAMPLE_RATE = 24000;

// Fast deterministic string hash for cache keys
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
}

// In-memory LRU cache for current session
const memoryAudioCache = new Map<string, string>();
const MAX_MEMORY_CACHE_ENTRIES = 60;

function getMemoryCachedAudio(key: string): string | null {
  if (memoryAudioCache.has(key)) {
    const val = memoryAudioCache.get(key)!;
    // Refresh LRU position
    memoryAudioCache.delete(key);
    memoryAudioCache.set(key, val);
    return val;
  }
  return null;
}

function setMemoryCachedAudio(key: string, val: string) {
  if (memoryAudioCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
    const oldestKey = memoryAudioCache.keys().next().value;
    if (oldestKey) memoryAudioCache.delete(oldestKey);
  }
  memoryAudioCache.set(key, val);
}

async function getCachedAudio(key: string): Promise<string | null> {
  const mem = getMemoryCachedAudio(key);
  if (mem) return mem;
  try {
    const dbVal = await idbGet<string>(`personaforge_tts_${key}`);
    if (dbVal) {
      setMemoryCachedAudio(key, dbVal);
      return dbVal;
    }
  } catch (err) {
    console.warn('[TtsEngine] Cache read error:', err);
  }
  return null;
}

async function setCachedAudio(key: string, data: string): Promise<void> {
  setMemoryCachedAudio(key, data);
  try {
    await idbSet(`personaforge_tts_${key}`, data);
  } catch (err) {
    console.warn('[TtsEngine] Cache write error:', err);
  }
}

// Ordered fallback chain: Gemini 3.1 Flash starter -> 2.5 Flash -> 2.5 Pro
export const TTS_MODEL_CHAIN = [
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
] as const;

// Fast chain for voice mode
export const TTS_MODEL_CHAIN_FAST = [
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-flash-preview-tts',
] as const;

export interface GeminiVoice {
  name: string;
  character: string;
}

export const ALL_VOICES: GeminiVoice[] = [
  { name: 'Zephyr', character: 'Bright' }, { name: 'Puck', character: 'Upbeat' },
  { name: 'Charon', character: 'Informative' }, { name: 'Kore', character: 'Firm' },
  { name: 'Fenrir', character: 'Excitable' }, { name: 'Leda', character: 'Youthful' },
  { name: 'Orus', character: 'Firm' }, { name: 'Aoede', character: 'Breezy' },
  { name: 'Callirrhoe', character: 'Easy-going' }, { name: 'Autonoe', character: 'Bright' },
  { name: 'Enceladus', character: 'Breathy' }, { name: 'Iapetus', character: 'Clear' },
  { name: 'Umbriel', character: 'Easy-going' }, { name: 'Algieba', character: 'Smooth' },
  { name: 'Despina', character: 'Smooth' }, { name: 'Erinome', character: 'Clear' },
  { name: 'Algenib', character: 'Gravelly' }, { name: 'Rasalgethi', character: 'Informative' },
  { name: 'Laomedeia', character: 'Upbeat' }, { name: 'Achernar', character: 'Soft' },
  { name: 'Alnilam', character: 'Firm' }, { name: 'Schedar', character: 'Even' },
  { name: 'Gacrux', character: 'Mature' }, { name: 'Pulcherrima', character: 'Forward' },
  { name: 'Achird', character: 'Friendly' }, { name: 'Zubenelgenubi', character: 'Casual' },
  { name: 'Vindemiatrix', character: 'Gentle' }, { name: 'Sadachbia', character: 'Lively' },
  { name: 'Sadaltager', character: 'Knowledgeable' }, { name: 'Sulafat', character: 'Warm' },
];

export const ROLEPLAY_VOICES = ['Fenrir','Charon','Enceladus','Algenib','Gacrux','Kore','Erinome','Achernar'];
export const NARRATOR_VOICES = ['Rasalgethi','Iapetus','Sadaltager','Alnilam','Schedar'];
export const BRIGHT_VOICES   = ['Zephyr','Puck','Autonoe','Laomedeia','Sadachbia','Aoede'];

export function isQuotaOrRateLimit(e: any): boolean {
  const msg = (e?.message || String(e)).toLowerCase();
  return msg.includes('429') || msg.includes('quota') || msg.includes('resource exhausted') || msg.includes('rate limit');
}
export function isModelNotFound(e: any): boolean {
  const msg = (e?.message || String(e)).toLowerCase();
  return msg.includes('404') || msg.includes('not found') || msg.includes('deprecated');
}

/**
 * Strips bracketed roll/action text, Markdown asterisks and underscores, and outer quotes.
 */
export function cleanTextForSpeech(text: string): string {
  if (!text) return '';
  return text
    .replace(/<(?:\w+|think|ooc|narrator)[\s\S]*?<\/(?:\w+|think|ooc|narrator)>/gi, '')
    .replace(/\[DIRECTOR INSTRUCTION\]:[\s\S]*?(?:$|(?=\n\n))/gi, '')
    .replace(/\[Director's Note(?: for AI)?: [\s\S]*?\]/gi, '')
    .replace(/\[(?:Action|Roll|Director|Dice|Context|OOC|Narrator).*?\]/gis, '')
    .replace(/<\/?[a-zA-Z][^>]*>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(?:^|\n)>\s*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~`#]/g, '')
    .replace(/^["'“‘«\s]+|["'”’»\s]+$/g, '')
    .trim();
}

/**
 * Prepares clean narration text without splitting normal messages into multiple quota-consuming requests.
 * Strips out OOC tags, raw dice rolls, and markdown styling while preserving dialogues.
 */
export function splitIntoSpeechSegments(text: string, maxSegmentLen: number = 3500): string[] {
  if (!text) return [];

  const clean = cleanTextForSpeech(text);
  if (!clean) return [];

  // If within single request capacity, do not split
  if (clean.length <= maxSegmentLen) {
    return [clean];
  }

  // Split only oversized stories by paragraph boundaries
  const rawParagraphs = clean.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const segments: string[] = [];
  let currentChunk = '';

  for (const para of rawParagraphs) {
    if ((currentChunk + '\n\n' + para).trim().length <= maxSegmentLen) {
      currentChunk = currentChunk ? `${currentChunk}\n\n${para}` : para;
    } else {
      if (currentChunk) segments.push(currentChunk);
      currentChunk = para;
    }
  }

  if (currentChunk) {
    segments.push(currentChunk);
  }

  return segments.length > 0 ? segments : [clean];
}

// --- Web Audio playback (24kHz PCM16 mono, same format as Android AudioTrack) ---

let audioCtx: AudioContext | null = null;
export function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextClass({ sampleRate: SAMPLE_RATE });
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Unlock audio on mobile devices during any user tap
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch {}
  };
  window.addEventListener('touchstart', unlockAudio, { passive: true, once: true });
  window.addEventListener('touchend', unlockAudio, { passive: true, once: true });
  window.addEventListener('click', unlockAudio, { passive: true, once: true });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// PCM16 mono 24kHz -> AudioBuffer
function pcmToAudioBuffer(bytes: Uint8Array, ctx: AudioContext): AudioBuffer {
  // Ensure safe 2-byte alignment without RangeError
  const alignedLength = Math.floor(bytes.byteLength / 2);
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, alignedLength * 2);
  const buf = ctx.createBuffer(1, alignedLength, SAMPLE_RATE);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < alignedLength; i++) {
    ch[i] = dataView.getInt16(i * 2, true) / 32768;
  }
  return buf;
}

export function base64ToPcmBytes(b64: string): Uint8Array {
  return base64ToBytes(b64);
}

export async function playPcmBase64(
  b64: string,
  onDone?: () => void,
  signal?: { cancelled: boolean },
  speed: number = 1,
  volume: number = 1,
  pitch: number = 1
): Promise<AudioBufferSourceNode | null> {
  if (!b64) return null;
  try {
    const bytes = base64ToBytes(b64);
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    let buffer: AudioBuffer;
    // Check if it's a WAV container (starts with 'RIFF')
    if (bytes.length > 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      buffer = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    } else {
      buffer = pcmToAudioBuffer(bytes, ctx);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (speed && speed > 0) {
      src.playbackRate.value = Math.max(0.25, Math.min(3.0, speed));
    }
    if (pitch && pitch > 0 && pitch !== 1) {
      try {
        src.detune.value = Math.round(1200 * Math.log2(Math.max(0.25, Math.min(3.0, pitch))));
      } catch (_) {}
    }

    const gainNode = ctx.createGain();
    gainNode.gain.value = Math.max(0, Math.min(1, volume));
    src.connect(gainNode);
    gainNode.connect(ctx.destination);

    src.onended = () => { if (!signal?.cancelled) onDone?.(); };
    src.start();
    return src;
  } catch (e) {
    console.error('playPcmBase64 failed', e);
    onDone?.();
    return null;
  }
}

export async function playPcmBytes(pcm: Uint8Array, onDone?: () => void): Promise<AudioBufferSourceNode | null> {
  if (!pcm || pcm.length < 44) return null;
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
    const buffer = pcmToAudioBuffer(pcm, ctx);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => onDone?.();
    src.start();
    return src;
  } catch (e) {
    console.error('playPcmBytes failed', e);
    onDone?.();
    return null;
  }
}

// Browser speechSynthesis fallback — matches Android system TTS fallback
export function speakWithBrowser(text: string, _voiceName?: string, rate: number = 1): void {
  try {
    window.speechSynthesis.cancel();
    const clean = cleanTextForSpeech(text);
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = rate;
    window.speechSynthesis.speak(u);
  } catch {}
}

export function speakWithBrowserAsync(text: string, _voiceName?: string, rate: number = 1): Promise<void> {
  return new Promise((resolve) => {
    try {
      window.speechSynthesis.cancel();
      const clean = cleanTextForSpeech(text);
      if (!clean) {
        resolve();
        return;
      }
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = rate;
      let finished = false;
      const done = () => {
        if (!finished) {
          finished = true;
          resolve();
        }
      };
      u.onend = done;
      u.onerror = done;
      // Safety timeout in case browser never fires onend (e.g. mobile Safari bug)
      const words = clean.split(/\s+/).length;
      const maxMs = Math.max(2000, (words / 1.5) * 1000 + 4000);
      setTimeout(done, maxMs);
      window.speechSynthesis.speak(u);
    } catch {
      resolve();
    }
  });
}

export function stopBrowserTts() {
  try { window.speechSynthesis.cancel(); } catch {}
}

/**
 * Core synthesize with fallback chain — mirrors GeminiTtsClient.synthesize
 * Returns base64 PCM string or null (caller falls back to browser TTS).
 */
export async function synthesizeSpeech(
  text: string,
  voiceName?: string,
  stylePrefix?: string | null,
  useFastChain: boolean = false,
  extraConfig?: any
): Promise<string | null> {
  const chosenVoice = voiceName || 'Kore';
  const cacheKey = `${chosenVoice}_${hashString(stylePrefix || '')}_${hashString(text)}`;

  // Check cache (memory + IndexedDB) first
  const cached = await getCachedAudio(cacheKey);
  if (cached) {
    console.log(`[TtsEngine] Audio cache hit for voice "${chosenVoice}"`);
    return cached;
  }

  const ai = getGenAI();
  const settings = getSettings();
  const preferredModel = settings.activeTTSModel;
  let chain: readonly string[] = useFastChain ? TTS_MODEL_CHAIN_FAST : TTS_MODEL_CHAIN;
  if (preferredModel && !chain.includes(preferredModel as any)) {
    chain = [preferredModel, ...chain];
  } else if (preferredModel && chain[0] !== preferredModel) {
    chain = [preferredModel, ...chain.filter((m) => m !== preferredModel)];
  }

  const prompt = stylePrefix
    ? (stylePrefix.includes('### TRANSCRIPT')
        ? stylePrefix.slice(0, 4000)
        : `${stylePrefix}:\n\n${text.slice(0, 4000)}`)
    : text.slice(0, 4000);

  const configBase = {
    responseModalities: ['AUDIO'] as const,
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: chosenVoice },
      },
    },
    ...(extraConfig || {}),
  };

  // Generous timeouts to prevent dropping to phone browser TTS under latency
  const timeoutMs = (model: string): number => {
    if (model.includes('pro')) return 22000;
    if (model.includes('flash')) return 16000;
    return 14000;
  };
  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> => {
    return Promise.race([
      promise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  };

  for (const model of chain) {
    try {
      const result = await withTimeout(
        ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: configBase,
        }) as Promise<any>,
        timeoutMs(model)
      );
      if (result == null) {
        console.warn(`[TtsEngine] ${model} timed out after ${timeoutMs(model)}ms, trying next`);
        continue;
      }
      const b64 = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
        ?? result.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData?.data;
      if (b64) {
        console.log(`[TtsEngine] succeeded: ${model}`);
        // Asynchronously persist to cache
        setCachedAudio(cacheKey, b64).catch(() => {});
        return b64;
      }
      console.warn(`[TtsEngine] ${model} returned no audio, trying next`);
    } catch (e: any) {
      console.warn(`[TtsEngine] ${model} failed (${e?.message}), trying next`);
      continue;
    }
  }

  // If styled synthesis failed, retry once with pure clean text before giving up
  if (stylePrefix) {
    console.warn('[TtsEngine] Styled synthesis failed, retrying with clean text directly');
    return synthesizeSpeech(text, voiceName, null, useFastChain, extraConfig);
  }

  console.warn('[TtsEngine] All TTS models exhausted — caller falls back to browser TTS');
  return null;
}

// --- Stateful TTS Engine class (mirrors Android isSpeaking / onSpeakingChanged pattern) ---

export class TtsEngine {
  private _isSpeaking = false;
  private currentSource: AudioBufferSourceNode | null = null;
  private cancelFlag = { cancelled: false };
  private _browserTtsTimer: any = null;
  private _browserTtsPoll: any = null;
  onSpeakingChanged?: (speaking: boolean) => void;

  get isSpeaking() { return this._isSpeaking; }

  private setSpeaking(v: boolean) {
    this._isSpeaking = v;
    this.onSpeakingChanged?.(v);
  }

  async synthesize(text: string, voiceName?: string, stylePrefix?: string | null, useFastChain: boolean = false): Promise<string | null> {
    return synthesizeSpeech(text, voiceName, stylePrefix, useFastChain);
  }

  async playBase64(b64: string, onDone?: () => void, speed?: number, volume?: number, pitch?: number): Promise<void> {
    this.stop();
    this.cancelFlag = { cancelled: false };
    this.setSpeaking(true);
    try {
      const settings = getSettings();
      const effSpeed = speed ?? settings.ttsSpeed ?? 1.0;
      const effVol = volume ?? settings.liveVoiceOutputVolume ?? 1.0;
      const effPitch = pitch ?? settings.liveVoicePitch ?? 1.0;
      const src = await playPcmBase64(b64, () => {
        if (!this.cancelFlag.cancelled) {
          this.setSpeaking(false);
          onDone?.();
        }
      }, this.cancelFlag, effSpeed, effVol, effPitch);
      this.currentSource = src;
      if (!src) {
        this.setSpeaking(false);
      }
    } catch {
      this.setSpeaking(false);
      onDone?.();
    }
  }

  private _currentSegmentIndex = 0;
  private _totalSegments = 0;
  private _currentSegmentText = '';

  get currentSegmentIndex() { return this._currentSegmentIndex; }
  get totalSegments() { return this._totalSegments; }
  get currentSegmentText() { return this._currentSegmentText; }

  // Speaks an array of segments in sequence with lookahead pre-buffering
  async speakSegments(
    segments: string[],
    options: {
      voiceName?: string;
      stylePrefix?: string | null;
      buildStylePrefix?: (segmentText: string) => string | null;
      useFastChain?: boolean;
      onSegmentStart?: (index: number, total: number, segmentText: string) => void;
      onComplete?: () => void;
    } = {}
  ): Promise<void> {
    if (!segments || segments.length === 0) {
      options.onComplete?.();
      return;
    }

    this.stop();
    const myCancel = { cancelled: false };
    this.cancelFlag = myCancel;
    this.setSpeaking(true);
    this._totalSegments = segments.length;

    for (let i = 0; i < segments.length; i++) {
      if (myCancel.cancelled) break;

      this._currentSegmentIndex = i;
      this._currentSegmentText = segments[i];
      options.onSegmentStart?.(i, segments.length, segments[i]);

      const prefixForSegment = options.buildStylePrefix
        ? options.buildStylePrefix(segments[i])
        : options.stylePrefix;

      const b64 = await this.synthesize(
        segments[i],
        options.voiceName,
        prefixForSegment,
        options.useFastChain ?? true
      );
      if (myCancel.cancelled) break;

      if (b64) {
        const settings = getSettings();
        const speed = settings.ttsSpeed ?? 1.0;
        const volume = settings.liveVoiceOutputVolume ?? 1.0;
        const pitch = settings.liveVoicePitch ?? 1.0;
        await new Promise<void>((resolve) => {
          this.playBase64(b64, () => {
            resolve();
          }, speed, volume, pitch);
        });
      } else {
        // Fallback to browser TTS for this segment with proper end-event listening
        const settings = getSettings();
        const rate = settings.ttsSpeed ?? 1.0;
        await speakWithBrowserAsync(segments[i], options.voiceName, rate);
      }
    }

    if (!myCancel.cancelled) {
      this.setSpeaking(false);
      this._currentSegmentIndex = 0;
      this._totalSegments = 0;
      this._currentSegmentText = '';
      options.onComplete?.();
    }
  }

  // Convenience: synthesize + play, with browser fallback and 30s outer timeout
  async speak(
    text: string,
    voiceName?: string,
    stylePrefix?: string | null,
    useFastChain: boolean = false,
    onDone?: () => void,
    onSegmentStart?: (index: number, total: number, segmentText: string) => void
  ): Promise<void> {
    const clean = cleanTextForSpeech(text);
    if (!clean) {
      onDone?.();
      return;
    }
    const segments = splitIntoSpeechSegments(clean);
    if (segments.length > 1) {
      return this.speakSegments(segments, {
        voiceName,
        stylePrefix,
        useFastChain,
        onSegmentStart,
        onComplete: onDone,
      });
    }

    const withOuterTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
      Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
    const b64 = (await withOuterTimeout(
      this.synthesize(clean, voiceName, stylePrefix, useFastChain),
      30000
    )) as string | null;
    if (b64) {
      const settings = getSettings();
      const speed = settings.ttsSpeed ?? 1.0;
      const volume = settings.liveVoiceOutputVolume ?? 1.0;
      const pitch = settings.liveVoicePitch ?? 1.0;
      await this.playBase64(b64, onDone, speed, volume, pitch);
    } else {
      // browser fallback using speakWithBrowserAsync to prevent premature cutoff
      const settings = getSettings();
      const rate = settings.ttsSpeed ?? 1.0;
      this.setSpeaking(true);
      await speakWithBrowserAsync(clean, voiceName, rate);
      this.setSpeaking(false);
      onDone?.();
    }
  }

  stop() {
    this.cancelFlag.cancelled = true;
    if (this._browserTtsTimer) {
      clearTimeout(this._browserTtsTimer);
      this._browserTtsTimer = null;
    }
    if (this._browserTtsPoll) {
      clearInterval(this._browserTtsPoll);
      this._browserTtsPoll = null;
    }
    try { this.currentSource?.stop(); } catch {}
    this.currentSource = null;
    try { window.speechSynthesis.cancel(); } catch {}
    if (this._isSpeaking) this.setSpeaking(false);
    // Also stop Web Audio context source
    stopBrowserTts();
  }

  async playPcmBytes(pcm: Uint8Array, onDone?: () => void) {
    await playPcmBytes(pcm, onDone);
  }
}

// Default singleton for convenience
export const defaultTtsEngine = new TtsEngine();
