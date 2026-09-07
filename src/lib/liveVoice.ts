import { GoogleGenAI } from "@google/genai";
import { sanitizeUserInput } from "./sanitize";
import { defaultTtsEngine } from "./ttsEngine";

export const LIVE_MODEL_CHAIN = [
  "gemini-3.1-flash-live-preview",
  "gemini-2.5-flash-native-audio-preview-12-2025",
  "gemini-2.5-flash-native-audio-preview-09-2025",
] as const;

export const LIVE_MODELS = LIVE_MODEL_CHAIN;

export const LIVE_VOICES = [
  // All 30 Gemini voices — matches ttsEngine.ALL_VOICES so any picker selection is valid in Live mode
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
] as const;

export const LIVE_VOICE_DESCRIPTIONS: Record<string, { label: string; tone: string; description: string }> = {
  Kore:          { label: "Kore",          tone: "Calm & Narrative",     description: "Balanced, articulate, and expressive storytelling voice." },
  Puck:          { label: "Puck",          tone: "Playful & Youthful",   description: "Energetic, bright, and spirited tone." },
  Charon:        { label: "Charon",        tone: "Deep & Resonant",      description: "Authoritative, grave, and cinematic narrator voice." },
  Fenrir:        { label: "Fenrir",        tone: "Gravelly & Bold",      description: "Intense, dramatic, and rugged persona." },
  Aoede:         { label: "Aoede",         tone: "Melodic & Elegant",    description: "Soft, graceful, and enchanting delivery." },
  Zephyr:        { label: "Zephyr",        tone: "Bright & Airy",        description: "Light, clear, and energetically uplifting." },
  Leda:          { label: "Leda",          tone: "Youthful & Clear",     description: "Fresh, youthful tone with natural warmth." },
  Orus:          { label: "Orus",          tone: "Firm & Steady",        description: "Grounded, reliable, and composed delivery." },
  Callirrhoe:    { label: "Callirrhoe",    tone: "Easy-Going",           description: "Relaxed and natural conversational tone." },
  Autonoe:       { label: "Autonoe",       tone: "Bright",               description: "Enthusiastic and upbeat character voice." },
  Enceladus:     { label: "Enceladus",     tone: "Breathy & Dramatic",   description: "Whisper-close and intensely atmospheric." },
  Iapetus:       { label: "Iapetus",       tone: "Clear & Precise",      description: "Crisp enunciation, perfect for narration." },
  Umbriel:       { label: "Umbriel",       tone: "Easy-Going",           description: "Smooth and unhurried storytelling pace." },
  Algieba:       { label: "Algieba",       tone: "Smooth",               description: "Polished and fluid delivery." },
  Despina:       { label: "Despina",       tone: "Smooth",               description: "Even-keeled and polished voice." },
  Erinome:       { label: "Erinome",       tone: "Clear",                description: "Clean and articulate roleplay voice." },
  Algenib:       { label: "Algenib",       tone: "Gravelly",             description: "Rough-edged and characterful." },
  Rasalgethi:    { label: "Rasalgethi",    tone: "Informative",          description: "Authoritative narrator with clear diction." },
  Laomedeia:     { label: "Laomedeia",     tone: "Upbeat",               description: "Buoyant and cheerfully energetic." },
  Achernar:      { label: "Achernar",      tone: "Soft",                 description: "Gentle and soothing presence." },
  Alnilam:       { label: "Alnilam",       tone: "Firm",                 description: "Steady and composed performance." },
  Schedar:       { label: "Schedar",       tone: "Even & Balanced",      description: "Neutral and professional narrator tone." },
  Gacrux:        { label: "Gacrux",        tone: "Mature & Rich",        description: "Deep, mature character with gravitas." },
  Pulcherrima:   { label: "Pulcherrima",   tone: "Forward & Assertive",  description: "Confident and forward-leaning delivery." },
  Achird:        { label: "Achird",        tone: "Friendly & Warm",      description: "Approachable, welcoming voice." },
  Zubenelgenubi: { label: "Zubenelgenubi", tone: "Casual",               description: "Laid-back and conversational." },
  Vindemiatrix:  { label: "Vindemiatrix",  tone: "Gentle",               description: "Soft-spoken and unhurried." },
  Sadachbia:     { label: "Sadachbia",     tone: "Lively",               description: "Vibrant and expressive character voice." },
  Sadaltager:    { label: "Sadaltager",    tone: "Knowledgeable",        description: "Scholarly narrator with measured delivery." },
  Sulafat:       { label: "Sulafat",       tone: "Warm",                 description: "Inviting and rich storytelling voice." },
};


export type LiveVoiceStatus = "idle" | "connecting" | "connected" | "error";
export type LiveVoiceMicMode = "hold" | "toggle" | "handsFree";

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: "audioinput" | "audiooutput";
  isDefault: boolean;
}

export async function getAudioDevices(): Promise<{ inputs: AudioDeviceInfo[]; outputs: AudioDeviceInfo[] }> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs: AudioDeviceInfo[] = [];
    const outputs: AudioDeviceInfo[] = [];
    for (const d of devices) {
      if (d.kind === "audioinput") {
        inputs.push({
          deviceId: d.deviceId,
          label: d.label || (d.deviceId === "default" ? "Default Microphone" : "Microphone"),
          kind: "audioinput",
          isDefault: d.deviceId === "default",
        });
      } else if (d.kind === "audiooutput") {
        outputs.push({
          deviceId: d.deviceId,
          label: d.label || (d.deviceId === "default" ? "Default Speaker" : "Speaker"),
          kind: "audiooutput",
          isDefault: d.deviceId === "default",
        });
      }
    }
    return { inputs, outputs };
  } catch (e) {
    console.warn("Failed to enumerate audio devices:", e);
    return { inputs: [], outputs: [] };
  }
}

export function isAudioContextSinkSupported(): boolean {
  return typeof window !== "undefined" && "setSinkId" in (window.AudioContext || (window as any).webkitAudioContext).prototype;
}

export interface LiveVoiceState {
  status: LiveVoiceStatus;
  isListening: boolean;
  isSpeaking: boolean;
  isMicMuted: boolean;
  isAiMuted: boolean;
  micMode: LiveVoiceMicMode;
  model: string;
  voiceName: string;
  inputLevel: number;
  outputLevel: number;
  outputVolume: number;
  bargeInEnabled: boolean;
  isReconnecting: boolean;
  isInterrupted?: boolean;
  canReplay?: boolean;
  canRecoverInterruption?: boolean;
  lastInterruptedStatement?: string;
  lastCompletedModelText?: string;
}

export interface LiveVoiceOptions {
  systemInstruction?: string;
  voiceName?: string;
  temperature?: number;
  preferredModel?: string;
  micMode?: LiveVoiceMicMode;
  micDeviceId?: string;
  outputDeviceId?: string;
  outputVolume?: number;
  bargeInEnabled?: boolean;
  contextTurns?: { role: string; text: string }[];
  onUserTranscript?: (text: string, final: boolean) => void;
  onModelTranscript?: (text: string, final: boolean) => void;
  onTurnEnd?: (userText: string, modelText: string) => void;
  onStateChange?: (state: LiveVoiceState) => void;
  onAudioLevels?: (inputLevel: number, outputLevel: number) => void;
  onError?: (message: string) => void;
  /** Fired when the failure looks like quota/rate-limit exhaustion so callers can fall back to turn-by-turn voice. */
  onQuotaExhausted?: (message: string) => void;
  onReconnect?: (history: { user: string; model: string }[]) => void;
}

interface SessionHandle {
  session: any;
  model: string;
  voiceName: string;
  audioContext: AudioContext | null;
  stream: MediaStream | null;
  processor: ScriptProcessorNode | null;
  processorSink: GainNode | null;
  workletNode: AudioWorkletNode | null;
  workletSink: GainNode | null;
  workletDelivered: boolean;
  source: MediaStreamAudioSourceNode | null;
  inputAnalyser: AnalyserNode | null;
  outputAnalyser: AnalyserNode | null;
  outputGainNode: GainNode | null;
  outputVolume: number;
  micDeviceId: string;
  outputDeviceId: string;
  appliedSinkId: string;
  disposed: boolean;
  pushToTalk: boolean;
  isMicMuted: boolean;
  isAiMuted: boolean;
  micMode: LiveVoiceMicMode;
  bargeInEnabled: boolean;
  status: LiveVoiceStatus;
  isSpeaking: boolean;
  turnCancelled: boolean;
  inputLevel: number;
  outputLevel: number;
  userTranscript: string;
  modelTranscript: string;
  audioSentInCurrentTurn: boolean;
  // Persistent per-session turn history. This grows over the lifetime of the
  // call so that text messages sent mid-session don't blow away the context
  // that the model needs to stay in turn.
  turnHistory: { user: string; model: string }[];
  currentTurnAudioChunks: string[];
  lastCompletedAudioChunks: string[];
  lastCompletedModelText: string;
  isInterrupted: boolean;
  lastInterruptedStatement: string;
  playbackQueue: AudioBufferSourceNode[];
  pendingAudioChunks: string[];
  nextPlaybackTime: number;
  animFrameId: number | null;
  options: LiveVoiceOptions;
}

let active: SessionHandle | null = null;

// Auto-reconnect bookkeeping: when the WebSocket drops mid-call (network blip,
// headset mode switch, server hiccup) we quietly rejoin instead of dumping the
// user back to idle. `manualStop` distinguishes a user hang-up from a drop.
const MAX_RECONNECT_ATTEMPTS = 6;
let lastOptions: LiveVoiceOptions | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let manualStop = true;
let operationId = 0;
let isReconnecting = false;

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function teardownSession(handle: SessionHandle | null) {
  if (!handle) return;
  // Prevent a stale session's late onclose from clobbering the state of a
  // newer session (it would emit idle/connecting after the new one is live).
  handle.disposed = true;
  handle.pendingAudioChunks = [];
  if ((handle as any)._watchdogTimer) {
    clearTimeout((handle as any)._watchdogTimer);
    (handle as any)._watchdogTimer = null;
  }
  if (handle.animFrameId) {
    cancelAnimationFrame(handle.animFrameId);
  }
  try {
    handle.session?.close();
  } catch (e) {}
  try {
    handle.processor?.disconnect();
  } catch (e) {}
  try {
    handle.processorSink?.disconnect();
  } catch (e) {}
  try {
    handle.workletNode?.disconnect();
  } catch (e) {}
  try {
    handle.workletSink?.disconnect();
  } catch (e) {}
  try {
    handle.source?.disconnect();
  } catch (e) {}
  try {
    handle.inputAnalyser?.disconnect();
  } catch (e) {}
  try {
    handle.outputAnalyser?.disconnect();
  } catch (e) {}
  try {
    handle.outputGainNode?.disconnect();
  } catch (e) {}
  handle.stream?.getTracks().forEach((t) => t.stop());
  if (handle.audioContext && handle.audioContext.state !== "closed") {
    handle.audioContext.close().catch(() => {});
  }
}

function buildMicConstraints(micDeviceId?: string): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (micDeviceId && micDeviceId !== "default") {
    constraints.deviceId = { exact: micDeviceId };
  }
  return constraints;
}

function buildModelChain(preferredModel?: string): string[] {
  const chain: string[] = [];
  if (preferredModel) chain.push(preferredModel);
  for (const m of LIVE_MODELS) {
    if (!chain.includes(m)) chain.push(m);
  }
  return chain;
}

async function acquireMicStream(micDeviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: buildMicConstraints(micDeviceId) });
}

async function acquireMicWithFallback(micDeviceId?: string): Promise<MediaStream> {
  try {
    return await acquireMicStream(micDeviceId);
  } catch (e) {
    // A stale persisted mic id (headset unplugged) makes getUserMedia reject
    // outright with an exact deviceId — fall back to the default mic so the
    // call still starts instead of failing completely.
    if (micDeviceId && micDeviceId !== "default") {
      console.warn("Requested microphone unavailable, falling back to default:", e);
      return acquireMicStream(undefined);
    }
    throw e;
  }
}

async function fetchLiveToken(model: string, config: any): Promise<string> {
  const base = typeof window !== "undefined" ? "" : "http://localhost:3000";
  const accessToken = (import.meta as any)?.env?.VITE_API_ACCESS_TOKEN;
  const res = await fetch(`${base}/api/gemini/live/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { "x-api-token": String(accessToken) } : {}),
    },
    body: JSON.stringify({ model, config }),
  });
  if (!res.ok) {
    let errMsg = `Backend error ${res.status}`;
    try {
      const errData = await res.json();
      if (errData.error?.message) errMsg = errData.error.message;
    } catch (e) {}
    throw new Error(errMsg);
  }
  const data = await res.json();
  if (!data.token) throw new Error("No live token returned from server.");
  return data.token;
}

function base64EncodePcm(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.length * 2);
  for (let i = 0; i < int16.length; i++) {
    bytes[i * 2] = int16[i] & 0xff;
    bytes[i * 2 + 1] = (int16[i] >> 8) & 0xff;
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as any);
  }
  return btoa(binary);
}

function base64DecodeToPcm(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function buildConnectConfig(options: LiveVoiceOptions) {
  const config: any = {
    responseModalities: ["AUDIO"],
    outputAudioTranscription: {},
    inputAudioTranscription: {},
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName:
            options.voiceName && (LIVE_VOICES as readonly string[]).includes(options.voiceName)
              ? options.voiceName
              : "Kore",
        },
      },
    },
    // Tune automatic voice detection so the model doesn't interrupt itself.
    // In toggle / hands-free the mic stays open while the model speaks, and the
    // model's own voice echoing back triggers the server's VAD as if the user
    // started talking -> barge-in -> the response cuts in and out. A lower
    // start sensitivity plus a longer silence window make it robust to that
    // echo without making the user's real speech hard to detect.
    realtimeInputConfig: {
      automaticActivityDetection: {
        startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
        endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
        prefixPaddingMs: 400,
        silenceDurationMs: 900,
      },
    },
  };
  if (typeof options.temperature === "number") config.temperature = options.temperature;
  if (options.systemInstruction) {
    config.systemInstruction = { parts: [{ text: options.systemInstruction }] };
  }
  return config;
}

let contextReviverInstalled = false;
function installContextReviver() {
  if (contextReviverInstalled || typeof window === "undefined") return;
  contextReviverInstalled = true;
  // On visibilitychange to 'hidden', suspend or destroy the AudioContext.
  // On returning to 'visible', do not auto-resume — wait for a user gesture before resuming.
  const reviveOnGesture = () => {
    const ctx = active?.audioContext;
    if (ctx && ctx.state !== "running" && ctx.state !== "closed") {
      ctx.resume().catch(() => {});
    }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      const ctx = active?.audioContext;
      if (ctx && ctx.state === "running") {
        ctx.suspend().catch(() => {});
      }
    }
  };
  window.addEventListener("pointerdown", reviveOnGesture, { passive: true });
  window.addEventListener("pointerup", reviveOnGesture, { passive: true });
  window.addEventListener("keydown", reviveOnGesture, { passive: true });
  window.addEventListener("touchend", reviveOnGesture, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function setupAudioPlayback(handle: SessionHandle): AudioContext {
  if (!handle.audioContext || handle.audioContext.state === "closed") {
    // Use the device's native sample rate: requesting a non-native rate
    // (e.g. 24 kHz on a 48 kHz device) forces the browser to resample the
    // whole graph and is a known source of glitchy / cutting audio on
    // Android. Gemini's 24 kHz PCM is resampled to the context rate per
    // chunk in enqueuePcmAudio instead, so buffers always play natively.
    handle.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    // Auto-resume when the browser suspends the context (tab switch, power
    // management, Bluetooth device change, etc.) so playback doesn't go
    // silent mid-response. Android fires "interrupted" when audio focus is
    // taken away (e.g. a headset button or another app grabs the mic).
    handle.audioContext.onstatechange = () => {
      if (!handle.audioContext) return;
      if (handle.audioContext.state === "running") {
        // Drain buffered chunks that arrived while suspended.
        if (handle.pendingAudioChunks.length > 0) {
          const ctx = handle.audioContext;
          handle.nextPlaybackTime = ctx.currentTime; // resync head to now
          const drained = handle.pendingAudioChunks.splice(0);
          for (const chunk of drained) {
            _scheduleAudioChunk(handle, ctx, chunk);
          }
        } else if (handle.playbackQueue.length > 0) {
          // No pending chunks but stale scheduled buffers exist — clear them
          // so they don't avalanche (the original behavior, kept as fallback).
          for (const s of [...handle.playbackQueue]) {
            try {
              s.stop();
            } catch {}
          }
          handle.playbackQueue = [];
          handle.nextPlaybackTime = handle.audioContext.currentTime;
        }
        (handle as any)._wasSuspended = false;
      } else if (handle.audioContext.state !== "closed") {
        (handle as any)._wasSuspended = true;
        handle.audioContext.resume().catch(() => {});
      }
    };
  }
  if (handle.audioContext.state === "suspended" || (handle.audioContext.state as string) === "interrupted") {
    (handle as any)._wasSuspended = true;
    handle.audioContext.resume().catch(() => {});
  }
  installContextReviver();

  if (!handle.outputGainNode && handle.audioContext) {
    const gain = handle.audioContext.createGain();
    const analyser = handle.audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    gain.gain.value = handle.isAiMuted ? 0 : handle.outputVolume;
    gain.connect(analyser);
    analyser.connect(handle.audioContext.destination);
    handle.outputGainNode = gain;
    handle.outputAnalyser = analyser;
  }

  applyOutputSink(handle).catch(() => {});

  return handle.audioContext;
}

interface AudioContextWithSink {
  setSinkId?: (deviceId: string) => Promise<void>;
}

async function isOutputDevicePresent(deviceId: string): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === "audiooutput" && d.deviceId === deviceId);
  } catch (e) {
    // Can't enumerate right now — don't reset a user's choice on a guess.
    return true;
  }
}

async function applyOutputSink(handle: SessionHandle): Promise<void> {
  const ctx = handle.audioContext;
  if (!ctx || !handle.outputDeviceId) return;
  if (!isAudioContextSinkSupported()) return;
  if (handle.appliedSinkId === handle.outputDeviceId) return;
  // A persisted device id can go stale (headset unplugged, BT forgotten). Set a
  // sink to a device that's no longer present and audio goes silent with no
  // error anywhere. Validate against what's actually connected and fall back
  // to default routing instead of applying a dead sink.
  if (handle.outputDeviceId !== "default") {
    const present = await isOutputDevicePresent(handle.outputDeviceId);
    if (!present) {
      console.warn(`Output device "${handle.outputDeviceId}" no longer present; using default.`);
      handle.outputDeviceId = "";
      return;
    }
  }
  const withSink = ctx as AudioContext & AudioContextWithSink;
  try {
    if (withSink.setSinkId) {
      await withSink.setSinkId(handle.outputDeviceId);
      handle.appliedSinkId = handle.outputDeviceId;
    }
  } catch (e) {
    // No user gesture yet, or the sink isn't available (device unplugged).
    // The next explicit setLiveVoiceOutputDevice call (from the HUD, which is
    // always a user gesture) will re-apply it.
    console.warn("setSinkId failed:", e);
  }
}

if (typeof navigator !== "undefined" && navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    if (!active || !active.outputDeviceId || active.outputDeviceId === "default") return;
    // Headset was unplugged mid-call: route back to the default speaker and
    // forget the dead sink so the next chunk doesn't retry it.
    isOutputDevicePresent(active.outputDeviceId).then((present) => {
      if (!present && active) {
        console.warn("Audio output device disconnected; routed back to default.");
        active.outputDeviceId = "";
        active.appliedSinkId = "";
      }
    });
  });
}

function resampleAudio(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = toRate / fromRate;
  const outLen = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const next = Math.min(input.length - 1, idx + 1);
    out[i] = input[idx] * (1 - frac) + input[next] * frac;
  }
  return out;
}

// Keep the playback head this far ahead of the live stream. Bluetooth
// headsets add noticeable transport delay and are prone to micro-stalls, so a
// slightly larger budget than the bare minimum smooths those out.
const TARGET_PLAYBACK_LATENCY = 0.22;

function enqueuePcmAudio(handle: SessionHandle, base64: string) {
  const ctx = setupAudioPlayback(handle);

  if (ctx.state !== "running") {
    // Buffer the chunk instead of dropping it — the context will drain
    // these when it resumes via onstatechange.
    handle.pendingAudioChunks.push(base64);
    handle.isSpeaking = true;
    emitState(handle);
    ctx.resume().catch(() => {});
    return;
  }

  // Drain any chunks that arrived while we were suspended, then play this one.
  if (handle.pendingAudioChunks.length > 0) {
    const drained = handle.pendingAudioChunks.splice(0);
    for (const chunk of drained) {
      _scheduleAudioChunk(handle, ctx, chunk);
    }
  }

  _scheduleAudioChunk(handle, ctx, base64);
}

function _scheduleAudioChunk(handle: SessionHandle, ctx: AudioContext, base64: string) {
  // Context just resumed from suspension — clear any stale queued buffers
  // that accumulated while suspended before scheduling fresh audio, otherwise
  // they avalanche as a jumbled burst playing all at once.
  if ((handle as any)._wasSuspended && handle.playbackQueue.length > 0) {
    for (const s of [...handle.playbackQueue]) {
      try {
        s.stop();
      } catch {}
    }
    handle.playbackQueue = [];
    handle.nextPlaybackTime = ctx.currentTime;
  }
  (handle as any)._wasSuspended = false;

  const pcm = base64DecodeToPcm(base64);
  if (pcm.length === 0) return;

  // Gemini streams 24 kHz PCM. Create the buffer at the context's ACTUAL
  // sample rate (resampling here once) so every chunk plays natively instead
  // of relying on the browser to resample a rate-mismatched buffer per chunk.
  const outRate = ctx.sampleRate || 24000;
  const pcmFloat = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    pcmFloat[i] = pcm[i] / 32768.0;
  }
  const audio = outRate === 24000 ? pcmFloat : resampleAudio(pcmFloat, 24000, outRate);
  const buffer = ctx.createBuffer(1, audio.length, outRate);
  buffer.getChannelData(0).set(audio);

  // Jitter buffer: keep the playback head ~220ms ahead so brief stalls
  // between chunks (network / server buffering) don't turn into audible gaps.
  // If we fell behind (stall, context suspend/resume), resync to now instead
  // of scheduling stale audio with dead air.
  const now = ctx.currentTime;
  if (handle.nextPlaybackTime < now) {
    handle.nextPlaybackTime = now;
  }
  const startTime = Math.max(now + TARGET_PLAYBACK_LATENCY, handle.nextPlaybackTime);
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  if (handle.outputGainNode) {
    source.connect(handle.outputGainNode);
  } else {
    source.connect(ctx.destination);
  }

  try {
    source.start(startTime);
  } catch (e) {
    console.warn("Failed to schedule live audio chunk:", e);
    return;
  }
  handle.nextPlaybackTime = startTime + buffer.duration;
  handle.playbackQueue.push(source);
  handle.isSpeaking = true;
  emitState(handle);

  source.onended = () => {
    handle.playbackQueue = handle.playbackQueue.filter((s) => s !== source);
    if (handle.playbackQueue.length === 0) {
      handle.isSpeaking = false;
      handle.outputLevel = 0;
      emitState(handle);
    }
  };
}

export function stopPlayback(handle: SessionHandle) {
  handle.pendingAudioChunks = [];
  for (const source of handle.playbackQueue) {
    try {
      source.stop();
    } catch (e) {}
  }
  handle.playbackQueue = [];
  handle.nextPlaybackTime = 0;
  handle.isSpeaking = false;
  handle.outputLevel = 0;
  emitState(handle);
}

function isMicSending(handle: SessionHandle): boolean {
  if (handle.isMicMuted) return false;
  if (handle.micMode === "handsFree") return true;
  return handle.pushToTalk;
}

function emitState(handle: SessionHandle) {
  handle.options?.onStateChange?.({
    status: handle.status,
    isListening: isMicSending(handle),
    isSpeaking: handle.isSpeaking,
    isMicMuted: handle.isMicMuted,
    isAiMuted: handle.isAiMuted,
    micMode: handle.micMode,
    model: handle.model,
    voiceName: handle.voiceName,
    inputLevel: handle.inputLevel,
    outputLevel: handle.outputLevel,
    outputVolume: handle.outputVolume,
    bargeInEnabled: handle.bargeInEnabled,
    isReconnecting,
    isInterrupted: handle.isInterrupted ?? false,
    canReplay: (handle.lastCompletedAudioChunks?.length ?? 0) > 0 || !!handle.lastCompletedModelText,
    canRecoverInterruption: !!handle.isInterrupted && !!handle.lastInterruptedStatement,
    lastInterruptedStatement: handle.lastInterruptedStatement || "",
    lastCompletedModelText: handle.lastCompletedModelText || "",
  });
}

function startAudioMeterLoop(handle: SessionHandle) {
  const inputBuffer = new Uint8Array(128);
  const outputBuffer = new Uint8Array(128);

  const tick = () => {
    if (!active || active !== handle) return;

    let inLevel = 0;
    if (handle.inputAnalyser && isMicSending(handle)) {
      handle.inputAnalyser.getByteFrequencyData(inputBuffer);
      let sum = 0;
      for (let i = 0; i < inputBuffer.length; i++) {
        sum += inputBuffer[i];
      }
      inLevel = Math.min(1, (sum / inputBuffer.length) / 128);
    }

    let outLevel = 0;
    if (handle.outputAnalyser && handle.isSpeaking && !handle.isAiMuted) {
      handle.outputAnalyser.getByteFrequencyData(outputBuffer);
      let sum = 0;
      for (let i = 0; i < outputBuffer.length; i++) {
        sum += outputBuffer[i];
      }
      outLevel = Math.min(1, (sum / outputBuffer.length) / 128);
    }

    handle.inputLevel = inLevel;
    handle.outputLevel = outLevel;
    handle.options?.onAudioLevels?.(inLevel, outLevel);

    handle.animFrameId = requestAnimationFrame(tick);
  };

  handle.animFrameId = requestAnimationFrame(tick);
}

const WORKLET_PROCESSOR_NAME = "pcm-capture";

// AudioWorklet processor: converts the mic stream to 16 kHz mono PCM on the
// audio render thread and posts base64 chunks to the main thread. Runs off the
// main thread (ScriptProcessorNode runs on it and is a known source of glitchy
// audio on Android). The processor is self-contained: AudioWorklet modules
// cannot import, so the resampler/base64 helpers live inline.
const WORKLET_SOURCE = `
const PCM_RATE = 16000;
const CHUNK_SAMPLES = 320;
function encodePcm(int16) {
  const bytes = new Uint8Array(int16.length * 2);
  for (let i = 0; i < int16.length; i++) {
    bytes[i * 2] = int16[i] & 0xff;
    bytes[i * 2 + 1] = (int16[i] >> 8) & 0xff;
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.pending = [];
    this.pendingSamples = 0;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'setActive') {
        this.active = !!e.data.active;
        if (!this.active) {
          this.pending = [];
          this.pendingSamples = 0;
        }
      }
    };
  }
  process(inputs) {
    if (!this.active) return true;
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    // Resample the context rate down to 16 kHz once here.
    const ratio = PCM_RATE / sampleRate;
    const outLen = Math.max(1, Math.round(channel.length * ratio));
    for (let i = 0; i < outLen; i++) {
      const srcPos = i / ratio;
      const idx = Math.floor(srcPos);
      const frac = srcPos - idx;
      const next = Math.min(channel.length - 1, idx + 1);
      this.pending.push(channel[idx] * (1 - frac) + channel[next] * frac);
      this.pendingSamples++;
    }
    if (this.pendingSamples >= CHUNK_SAMPLES) {
      const chunk = new Int16Array(this.pendingSamples);
      for (let i = 0; i < this.pendingSamples; i++) {
        const s = Math.max(-1, Math.min(1, this.pending[i]));
        chunk[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.pending = [];
      this.pendingSamples = 0;
      this.port.postMessage({ pcm: encodePcm(chunk) });
    }
    return true;
  }
}
registerProcessor("${WORKLET_PROCESSOR_NAME}", PcmCaptureProcessor);
`;

let workletUrl: string | null = null;

function getWorkletUrl(): string {
  if (!workletUrl) {
    workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
  }
  return workletUrl;
}

// Each createObjectURL pins the blob for the lifetime of the document; without
// this, long-running apps that start/stop many voice sessions accumulate
// blobs forever. Only safe to call while NO session is alive — a reconnecting
// session's brand-new AudioContext still needs the same URL for addModule().
function releaseWorkletUrl(): void {
  if (!workletUrl) return;
  try {
    URL.revokeObjectURL(workletUrl);
  } catch (e) {}
  workletUrl = null;
}

function isWorkletSupported(ctx: AudioContext): boolean {
  return !!(ctx.audioWorklet && typeof AudioWorkletNode === "function");
}

function syncWorkletState(handle: SessionHandle) {
  if (handle.workletNode) {
    try {
      handle.workletNode.port.postMessage({ type: "setActive", active: isMicSending(handle) });
    } catch (e) {}
  }
}

function detachMicCapture(handle: SessionHandle) {
  if ((handle as any)._watchdogTimer) {
    clearTimeout((handle as any)._watchdogTimer);
    (handle as any)._watchdogTimer = null;
  }
  try {
    handle.processor?.disconnect();
  } catch (e) {}
  try {
    handle.processorSink?.disconnect();
  } catch (e) {}
  try {
    handle.workletNode?.disconnect();
  } catch (e) {}
  try {
    handle.workletSink?.disconnect();
  } catch (e) {}
  try {
    handle.source?.disconnect();
  } catch (e) {}
  try {
    handle.inputAnalyser?.disconnect();
  } catch (e) {}
  handle.processor = null;
  handle.processorSink = null;
  handle.workletNode = null;
  handle.workletSink = null;
  handle.workletDelivered = false;
  handle.source = null;
  handle.inputAnalyser = null;
}

// If an AudioWorklet node is silent (not pulled by the render graph, a
// device/browser quirk, or a dead message port) the mic would go dead with no
// error anywhere. When the mic should be sending but the worklet has delivered
// nothing after a grace period, tear it down and re-attach using the
// ScriptProcessor fallback so speech keeps flowing.
// When the mic is currently off, reschedule the check for 1 s from now.
// When the mic opens later this pending timer fires and correctly detects a
// dead worklet. Store timer ID and clear any existing timer before scheduling
// to avoid two parallel watchdog loops (boolean flag alone has a race window).
function scheduleWorkletWatchdog(handle: SessionHandle) {
  if ((handle as any)._watchdogTimer) {
    clearTimeout((handle as any)._watchdogTimer);
    (handle as any)._watchdogTimer = null;
  }
  const check = () => {
    (handle as any)._watchdogTimer = null;
    if (!handle.workletNode || handle.disposed || handle.workletDelivered) return;
    if (isMicSending(handle)) {
      console.warn("AudioWorklet produced no mic audio; falling back to ScriptProcessor.");
      attachMicCapture(handle, true).catch(() => {});
    } else {
      // Mic is off right now — re-arm so we catch when it opens next.
      (handle as any)._watchdogTimer = setTimeout(check, 1000);
    }
  };
  (handle as any)._watchdogTimer = setTimeout(check, 2000);
}

async function attachMicCapture(handle: SessionHandle, forceProcessor = false) {
  if (!handle.stream) return;
  detachMicCapture(handle);
  const ctx = setupAudioPlayback(handle);
  if (ctx.state !== "running") {
    await ctx.resume().catch(() => {});
  }
  const sourceNode = ctx.createMediaStreamSource(handle.stream);

  const inputAnalyser = ctx.createAnalyser();
  inputAnalyser.fftSize = 256;
  inputAnalyser.smoothingTimeConstant = 0.5;
  sourceNode.connect(inputAnalyser);

  const sending = isMicSending(handle);
  handle.stream.getAudioTracks().forEach((t) => {
    t.enabled = sending;
  });

  const sendChunk = (base64: string) => {
    if (!isMicSending(handle) || !handle.session) return;
    // Hands-Free: the open mic hears the AI's own voice through the speakers /
    // headset. Feeding that back to the model makes the server's VAD treat it
    // as user speech and barge in on itself, cutting the reply in and out.
    // Suppress mic audio while the AI is speaking — tap/hold modes close the
    // mic anyway, so this only affects Hands-Free. Barge-in still works via
    // the Interrupt button (or a typed message). When the user enables the
    // barge-in toggle, let the voice through so the server's VAD can cut the
    // AI off mid-sentence naturally.
    if (handle.isSpeaking && handle.micMode === "handsFree" && !handle.bargeInEnabled) return;
    try {
      handle.session.sendRealtimeInput({
        audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
      });
      handle.audioSentInCurrentTurn = true;
    } catch (e) {
      console.warn("Failed to stream audio chunk:", e);
    }
  };

  if (!forceProcessor && isWorkletSupported(ctx)) {
    try {
      // Timeout so a hanging addModule can't block the session from activating.
      const addModule = ctx.audioWorklet.addModule(getWorkletUrl());
      await Promise.race([
        addModule,
        new Promise((_, reject) => setTimeout(() => reject(new Error("addModule timeout")), 3000)),
      ]);
      const workletNode = new AudioWorkletNode(ctx, WORKLET_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: "explicit",
      });
      // Route the worklet output through a muted gain to the destination. The
      // node MUST be pulled by the graph for process() to run — an
      // AudioWorkletNode left unconnected downstream is not guaranteed to
      // process, which silently kills the mic. The muted gain keeps it silent.
      const workletSink = ctx.createGain();
      workletSink.gain.value = 0;
      sourceNode.connect(workletNode);
      workletNode.connect(workletSink);
      workletSink.connect(ctx.destination);
      workletNode.port.onmessage = (e) => {
        if (e.data && e.data.pcm) {
          handle.workletDelivered = true;
          sendChunk(e.data.pcm);
        }
      };
      handle.workletNode = workletNode;
      handle.workletSink = workletSink;
      handle.workletDelivered = false;
      handle.source = sourceNode;
      handle.inputAnalyser = inputAnalyser;
      syncWorkletState(handle);
      scheduleWorkletWatchdog(handle);
      return;
    } catch (e) {
      console.warn("AudioWorklet unavailable, falling back to ScriptProcessor:", e);
      detachMicCapture(handle);
    }
  }

  // Fallback: ScriptProcessorNode. It must be pulled by the graph for
  // onaudioprocess to fire, but routing it straight to the destination pipes
  // the mic into the speakers (audible self-echo that trips the model's VAD on
  // headsets). Sink it through a muted gain instead: processing still runs.
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  sourceNode.connect(processor);
  const processorSink = ctx.createGain();
  processorSink.gain.value = 0;
  processor.connect(processorSink);
  processorSink.connect(ctx.destination);

  processor.onaudioprocess = (event) => {
    const inputData = event.inputBuffer.getChannelData(0);
    const sampleRate = ctx.sampleRate || 48000;
    const resampled = resampleAudio(inputData, sampleRate, 16000);
    const int16 = new Int16Array(resampled.length);
    for (let i = 0; i < resampled.length; i++) {
      const s = Math.max(-1, Math.min(1, resampled[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    sendChunk(base64EncodePcm(int16));
  };

  handle.processor = processor;
  handle.processorSink = processorSink;
  handle.source = sourceNode;
  handle.inputAnalyser = inputAnalyser;
}

function finalizeTurn(handle: SessionHandle) {
  const rawUserText = handle.userTranscript.trim();
  const userText = sanitizeUserInput(rawUserText).trim();
  const modelText = handle.modelTranscript.trim();
  const turnEndMs = Date.now();
  if (userText || modelText) {
    handle.turnHistory.push({ user: userText, model: modelText });
    // Keep the history bounded so the seed payload never gets unwieldy.
    if (handle.turnHistory.length > 50) {
      handle.turnHistory = handle.turnHistory.slice(-50);
    }
    if (modelText) {
      handle.lastCompletedModelText = modelText;
      handle.lastCompletedAudioChunks = [...handle.currentTurnAudioChunks];
      handle.currentTurnAudioChunks = [];
      handle.isInterrupted = false;
      handle.lastInterruptedStatement = "";
    }
    handle.options?.onTurnEnd?.(userText, modelText);
    // #13: Turn latency log (user stopped speaking → model finished responding).
    const turnStartMs = (handle as any)._turnStartMs as number | undefined;
    if (turnStartMs && turnStartMs > 0) {
      const latencyMs = turnEndMs - turnStartMs;
      console.log(`[LiveVoice] Turn latency: ${(latencyMs / 1000).toFixed(2)}s`);
      (handle as any)._turnStartMs = 0;
    }
  }
  handle.userTranscript = "";
  handle.modelTranscript = "";
  handle.turnCancelled = false;
  // Reset for next turn so a stale true from an interrupted/jumbled turn
  // doesn't bleed into the following turn's Force Reply logic.
  handle.audioSentInCurrentTurn = false;
  // Pass final=true so callers can distinguish a committed transcript from a live partial.
  handle.options?.onUserTranscript?.("", true);
  handle.options?.onModelTranscript?.("", true);
  emitState(handle);
}

function seedContext(handle: SessionHandle) {
  // Seed with the *initial* contextTurns passed by the caller (the chat
  // history the user had when they pressed "Live Voice"). This only runs once
  // at connect time; subsequent message history is preserved by the model's
  // own turn tracking, so we don't re-seed every reconnect.
  const context = handle.options.contextTurns;
  if (!context?.length) return;
  // Enforce strict user/model alternation — Gemini Live requires turns to
  // strictly alternate, two same-role turns in a row throw 400 INVALID_ARGUMENT.
  // Keep the last of each consecutive duplicate-role group.
  const filtered: typeof context = [];
  for (const c of context) {
    const role = c.role === "user" ? "user" : "model";
    if (filtered.length > 0 && filtered[filtered.length - 1].role === role) {
      filtered[filtered.length - 1] = c;
    } else {
      filtered.push(c);
    }
  }
  if (!filtered.length) return;
  const turns = filtered.map((c) => ({
    role: c.role === "user" ? "user" : "model",
    parts: [{ text: c.text }],
  }));
  try {
    handle.session.sendClientContent({
      turns,
      turnComplete: false,
    });
  } catch (e) {
    console.warn("Failed to seed live voice context:", e);
  }
}

async function connectSession(
  token: string,
  model: string,
  stream: MediaStream,
  options: LiveVoiceOptions
): Promise<SessionHandle> {
  const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } as any });
  const config = buildConnectConfig(options);

  const handle: SessionHandle = {
    session: null,
    model,
    voiceName: options.voiceName || "Kore",
    audioContext: null,
    stream,
    processor: null,
    processorSink: null,
    workletNode: null,
    workletSink: null,
    workletDelivered: false,
    source: null,
    inputAnalyser: null,
    outputAnalyser: null,
    outputGainNode: null,
    micDeviceId: options.micDeviceId || "",
    outputDeviceId: options.outputDeviceId || "",
    outputVolume: options.outputVolume ?? 1,
    appliedSinkId: "",
    disposed: false,
    pushToTalk: options.micMode === "handsFree",
    isMicMuted: false,
    isAiMuted: false,
    micMode: options.micMode || "hold",
    bargeInEnabled: options.bargeInEnabled ?? false,
    status: "connecting",
    isSpeaking: false,
    turnCancelled: false,
    inputLevel: 0,
    outputLevel: 0,
    userTranscript: "",
    modelTranscript: "",
    audioSentInCurrentTurn: false,
    turnHistory: [],
    currentTurnAudioChunks: [],
    lastCompletedAudioChunks: [],
    lastCompletedModelText: "",
    isInterrupted: false,
    lastInterruptedStatement: "",
    playbackQueue: [],
    pendingAudioChunks: [],
    nextPlaybackTime: 0,
    animFrameId: null,
    options,
  };

  const session = await ai.live.connect({
    model,
    config,
    callbacks: {
      onopen: () => {
        handle.status = "connected";
        if (handle.turnHistory.length > 0) {
          handle.options?.onReconnect?.([...handle.turnHistory]);
        }
        emitState(handle);
        startAudioMeterLoop(handle);
      },
      onmessage: (message: any) => {
        const content = message.serverContent;
        if (!content) return;

        if (content.interrupted) {
          // The model's current turn was cut off (barge-in / user interrupt).
          // Stop playback and preserve the partial turn in history rather than
          // silently dropping the user's question.
          stopPlayback(handle);
          const rawUserText = handle.userTranscript.trim();
          const userText = sanitizeUserInput(rawUserText).trim();
          const rawModelText = handle.modelTranscript.trim();
          const modelText = rawModelText ? `${rawModelText} … [interrupted]` : "";
          if (rawModelText) {
            handle.isInterrupted = true;
            handle.lastInterruptedStatement = rawModelText;
          }
          handle.currentTurnAudioChunks = [];
          if (userText || modelText) {
            handle.turnHistory.push({ user: userText, model: modelText });
            if (handle.turnHistory.length > 50) {
              handle.turnHistory = handle.turnHistory.slice(-50);
            }
            handle.options?.onTurnEnd?.(userText, modelText);
          }
          handle.userTranscript = "";
          handle.modelTranscript = "";
          handle.turnCancelled = false;
          // Reset for next turn so stale flag doesn't bleed into the new turn
          // (hands-free mic stays open, so onMicSendingChanged won't fire).
          handle.audioSentInCurrentTurn = false;
          handle.options?.onUserTranscript?.("", false);
          handle.options?.onModelTranscript?.("", false);
          emitState(handle);
          return;
        }

        if (handle.turnCancelled) {
          // Interrupt during playback: drop stale model chunks.
        } else if (content.modelTurn?.parts) {
          for (const part of content.modelTurn.parts) {
            if (part.inlineData?.data) {
              handle.currentTurnAudioChunks.push(part.inlineData.data);
              if (!handle.isAiMuted) {
                enqueuePcmAudio(handle, part.inlineData.data);
              }
            } else if (part.text) {
              handle.modelTranscript += part.text;
              handle.options?.onModelTranscript?.(handle.modelTranscript, false);
            }
          }
        }

        if (content.inputTranscription?.text) {
          handle.userTranscript += content.inputTranscription.text;
          handle.options?.onUserTranscript?.(handle.userTranscript, false);
          // Stamp when we first receive user speech so we can compute latency at turn end.
          if (!(handle as any)._turnStartMs) {
            (handle as any)._turnStartMs = Date.now();
          }
        }

        if (!handle.turnCancelled && content.outputTranscription?.text) {
          handle.modelTranscript += content.outputTranscription.text;
          handle.options?.onModelTranscript?.(handle.modelTranscript, false);
        }

        if (content.turnComplete) {
          finalizeTurn(handle);
        }
      },
      onerror: (e: any) => {
        const msg = e?.message || "Live voice error";
        handle.options?.onError?.(msg);
        if (/(?:quota|429|resource.?exhausted|RESOURCE_EXHAUSTED)/i.test(msg)) {
          handle.options?.onQuotaExhausted?.(msg);
        }
      },
      onclose: () => {
        if (handle.disposed) return;
        stopPlayback(handle);
        if (active === handle && !manualStop) {
          // Unexpected drop. Keep the HUD up in a "connecting" state and
          // rejoin quietly instead of throwing the user back to idle.
          isReconnecting = true;
          handle.status = "connecting";
          emitState(handle);
          scheduleReconnect();
        } else {
          handle.status = "idle";
          emitState(handle);
        }
      },
    },
  });

  handle.session = session;
  // The connect promise resolves AFTER onopen fires, so handle.session is only
  // guaranteed here — seeding context in onopen was silently no-op'ing before.
  seedContext(handle);
  return handle;
}

export async function startLiveVoice(options: LiveVoiceOptions): Promise<void> {
  const op = ++operationId;
  manualStop = false;
  isReconnecting = false;
  clearReconnectTimer();
  lastOptions = options;
  reconnectAttempts = 0;
  teardownSession(active);
  active = null;

  const stream = await acquireMicWithFallback(options.micDeviceId);
  if (op !== operationId) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }
  let lastError: Error | null = null;
  let micAttachError: Error | null = null;

  for (const model of buildModelChain(options.preferredModel)) {
    try {
      const token = await fetchLiveToken(model, buildConnectConfig(options));
      if (op !== operationId) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const handle = await connectSession(token, model, stream, options);
      if (op !== operationId) {
        stream.getTracks().forEach((t) => t.stop());
        teardownSession(handle);
        return;
      }
      try {
        await attachMicCapture(handle);
      } catch (attachErr: any) {
        // Mic capture isn't model-specific: tear the live session down (don't
        // leak an open WebSocket) and fail fast instead of replaying the whole
        // model chain against the same broken mic.
        teardownSession(handle);
        micAttachError = attachErr;
        throw attachErr;
      }
      syncMicSendingState(handle);
      active = handle;
      handle.status = "connected";
      emitState(handle);
      return;
    } catch (err: any) {
      if (micAttachError) {
        throw micAttachError;
      }
      lastError = err;
      console.warn(`Live voice model ${model} failed: ${err?.message}`);
    }
  }

  stream.getTracks().forEach((t) => t.stop());
  releaseWorkletUrl();
  throw lastError || new Error("All Live voice models failed to connect.");
}

function scheduleReconnect() {
  if (manualStop || !lastOptions || reconnectTimer) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    // Give up: mark the (dead) session as errored so the HUD collapses, and
    // tell the user why the call ended.
    if (active) {
      active.status = "error";
      active.stream?.getTracks().forEach((t) => t.stop());
      emitState(active);
    }
    lastOptions?.onError?.("Live connection was lost and could not be restored.");
    lastOptions = null;
    return;
  }
  const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectNow().catch(() => scheduleReconnect());
  }, delay);
}

async function reconnectNow(): Promise<void> {
  if (manualStop || !lastOptions) return;
  const op = operationId;
  const options = lastOptions;
  const stale = active;

  // A fresh Live session starts with an empty context window. Seed it ONCE
  // with the initial snapshot PLUS every turn completed during the call so
  // far. Re-seeding only the original contextTurns (what connectSession did
  // before) duplicated pre-call history on every reconnect while dropping
  // everything said mid-session.
  const inCallTurns: { role: string; text: string }[] = [];
  for (const turn of stale?.turnHistory || []) {
    if (turn.user) inCallTurns.push({ role: "user", text: turn.user });
    if (turn.model) inCallTurns.push({ role: "model", text: turn.model });
  }
  let combinedTurns = [...(options.contextTurns || []), ...inCallTurns].slice(-50);

  // #9: Secondary guard — trim oldest turns until total character count is under 15,000
  // to prevent oversized reconnect payloads that can cause 400/413 errors.
  const MAX_CONTEXT_CHARS = 15000;
  let totalChars = combinedTurns.reduce((sum, t) => sum + t.text.length, 0);
  while (totalChars > MAX_CONTEXT_CHARS && combinedTurns.length > 1) {
    const removed = combinedTurns.shift()!;
    totalChars -= removed.text.length;
  }
  // If a single remaining turn alone exceeds the cap, truncate its text
  // instead of sending the oversized payload as-is (which bypasses the limit).
  if (totalChars > MAX_CONTEXT_CHARS && combinedTurns.length === 1) {
    const only = combinedTurns[0];
    only.text = only.text.slice(-MAX_CONTEXT_CHARS);
    totalChars = only.text.length;
  }

  // Enforce strict user/model alternation for the reconnect payload as well.
  {
    const alt: typeof combinedTurns = [];
    for (const t of combinedTurns) {
      if (alt.length > 0 && alt[alt.length - 1].role === t.role) {
        alt[alt.length - 1] = t;
      } else {
        alt.push(t);
      }
    }
    combinedTurns = alt;
  }

  const reconnectOptions: LiveVoiceOptions = combinedTurns.length
    ? { ...options, contextTurns: combinedTurns }
    : options;

  const stream = await acquireMicWithFallback(options.micDeviceId);
  if (op !== operationId || manualStop || !lastOptions) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }
  let micAttachError: Error | null = null;

  for (const model of buildModelChain(options.preferredModel)) {
    try {
      const token = await fetchLiveToken(model, buildConnectConfig(reconnectOptions));
      if (op !== operationId || manualStop || !lastOptions) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const handle = await connectSession(token, model, stream, reconnectOptions);
      if (op !== operationId || manualStop || !lastOptions) {
        stream.getTracks().forEach((t) => t.stop());
        teardownSession(handle);
        return;
      }
      // Carry the user's in-call settings across to the fresh session.
      if (stale) {
        handle.micMode = stale.micMode;
        handle.isMicMuted = stale.isMicMuted;
        handle.isAiMuted = stale.isAiMuted;
        handle.outputVolume = stale.outputVolume;
        handle.bargeInEnabled = stale.bargeInEnabled;
        handle.pushToTalk = stale.micMode === "handsFree" || isMicSending(stale);
        // Preserve the conversation record so future reconnects keep merging
        // correctly instead of replaying from the original snapshot again.
        handle.turnHistory = [...stale.turnHistory];
        handle.lastCompletedAudioChunks = stale.lastCompletedAudioChunks ? [...stale.lastCompletedAudioChunks] : [];
        handle.lastCompletedModelText = stale.lastCompletedModelText || "";
        handle.isInterrupted = stale.isInterrupted ?? false;
        handle.lastInterruptedStatement = stale.lastInterruptedStatement || "";
      }
      try {
        await attachMicCapture(handle);
      } catch (attachErr: any) {
        teardownSession(handle);
        micAttachError = attachErr;
        throw attachErr;
      }
      if (handle.outputGainNode) {
        handle.outputGainNode.gain.value = handle.isAiMuted ? 0 : handle.outputVolume;
      }
      syncMicSendingState(handle);
      // Swap in the live session before tearing the stale one down so the
      // stale onclose doesn't clobber the fresh state.
      active = null;
      teardownSession(stale);
      active = handle;
      handle.status = "connected";
      if (handle.turnHistory.length > 0) {
        handle.options?.onReconnect?.([...handle.turnHistory]);
      }
      reconnectAttempts = 0;
      isReconnecting = false;
      emitState(handle);
      return;
    } catch (err: any) {
      if (micAttachError) {
        throw micAttachError;
      }
      console.warn(`Live voice reconnect model ${model} failed: ${err?.message}`);
    }
  }

  stream.getTracks().forEach((t) => t.stop());
  if (active) {
    // Keep the dead handle in "connecting" so the HUD stays alive for retries.
    active.status = "connecting";
    emitState(active);
  }
  scheduleReconnect();
}

function sendAudioStreamEnd(handle: SessionHandle): void {
  if (!handle.session) return;
  try {
    handle.session.sendRealtimeInput({ audioStreamEnd: true });
    handle.audioSentInCurrentTurn = false;
  } catch (e) {
    console.warn("Failed to send audioStreamEnd:", e);
  }
  // Explicitly signal turn completion so Gemini starts replying immediately,
  // bypassing server-side silence (VAD) detection. Without this the model
  // keeps waiting for a silence window even though the user already let go.
  sendTurnComplete(handle);
}

function sendTurnComplete(handle: SessionHandle): void {
  if (!handle.session) return;
  try {
    handle.session.sendClientContent({ turns: [], turnComplete: true });
  } catch (e) {
    console.warn("Failed to send turnComplete:", e);
  }
}



// In Hold / Tap-to-Talk modes the mic only needs to be captured while the user
// is actually talking. Holding it open the whole session is what makes Android
// treat the page as an active call — audio focus gets pulled, the context gets
// "interrupted", and responses go silent (transcripts still stream). Release
// the capture between sends and re-acquire on the next press; Hands-Free keeps
// it continuous.
function syncMicSendingState(handle: SessionHandle): void {
  const sending = isMicSending(handle);
  if (handle.stream) {
    handle.stream.getAudioTracks().forEach((t) => {
      t.enabled = sending;
    });
  }
  syncWorkletState(handle);
}

async function onMicSendingChanged(handle: SessionHandle, wasSending: boolean): Promise<void> {
  const nowSending = isMicSending(handle);
  if (wasSending && !nowSending) {
    // Only flush the user's turn if they actually said something this press —
    // otherwise a stray tap / tap-release makes the model reply "I didn't
    // catch that" to silence.
    if (handle.audioSentInCurrentTurn) {
      sendAudioStreamEnd(handle);
    }
  } else if (!wasSending && nowSending) {
    handle.audioSentInCurrentTurn = false;
    if (!handle.stream) {
      try {
        const stream = await acquireMicWithFallback(handle.micDeviceId);
        if (!handle.disposed) {
          handle.stream = stream;
          await attachMicCapture(handle);
        } else {
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch (e: any) {
        console.warn("Failed to start microphone:", e);
        handle.options?.onError?.(e?.message || "Microphone unavailable");
      }
    }
  }
  syncMicSendingState(handle);
}

export function setPushToTalk(listening: boolean): void {
  if (!active) return;
  setupAudioPlayback(active);
  const wasSending = isMicSending(active);
  active.pushToTalk = listening;
  if (!wasSending && listening && active.isSpeaking) {
    // Clean barge-in: stop playback immediately instead of letting the
    // server's VAD cut the AI's speech erratically mid-syllable.
    stopPlayback(active);
  }
  onMicSendingChanged(active, wasSending);
  emitState(active);
}

export function setLiveVoiceMicMode(mode: LiveVoiceMicMode): void {
  if (!active) return;
  const wasSending = isMicSending(active);
  active.micMode = mode;
  active.pushToTalk = mode === "handsFree";
  onMicSendingChanged(active, wasSending);
  emitState(active);
}

export function setLiveVoiceOutputDevice(deviceId: string): boolean {
  if (!active) return false;
  active.outputDeviceId = deviceId;
  setupAudioPlayback(active);
  applyOutputSink(active).catch(() => {});
  return true;
}

export async function setLiveVoiceInputDevice(deviceId: string): Promise<boolean> {
  if (!active) return false;
  if (deviceId === active.micDeviceId) return true;
  active.micDeviceId = deviceId;
  if (!active.stream) {
    // Mic is currently released (Hold/Tap mode between turns); the next
    // press will re-acquire with this device automatically.
    return true;
  }
  const wasSending = isMicSending(active);
  const oldStream = active.stream;
  try {
    // Use the same stale-device fallback path as initial acquisition so a
    // headset that was unplugged between sessions doesn't dead-end the switch.
    const newStream = await acquireMicWithFallback(deviceId);
    oldStream.getTracks().forEach((t) => t.stop());
    active.stream = newStream;
    await attachMicCapture(active);
    onMicSendingChanged(active, wasSending);
    emitState(active);
    return true;
  } catch (e: any) {
    active.options?.onError?.(e?.message || "Failed to switch microphone");
    return false;
  }
}

export function toggleLiveVoiceMicMute(): boolean {
  if (!active) return false;
  const wasSending = isMicSending(active);
  active.isMicMuted = !active.isMicMuted;
  onMicSendingChanged(active, wasSending);
  emitState(active);
  return active.isMicMuted;
}

export function toggleLiveVoiceAiMute(): boolean {
  if (!active) return false;
  active.isAiMuted = !active.isAiMuted;
  if (active.outputGainNode) {
    active.outputGainNode.gain.value = active.isAiMuted ? 0 : active.outputVolume;
  }
  if (active.isAiMuted) {
    stopPlayback(active);
  }
  emitState(active);
  return active.isAiMuted;
}

export function setLiveVoiceOutputVolume(volume: number): boolean {
  if (!active) return false;
  active.outputVolume = Math.max(0, Math.min(1, volume));
  if (active.outputGainNode) {
    active.outputGainNode.gain.value = active.isAiMuted ? 0 : active.outputVolume;
  }
  emitState(active);
  return true;
}

// Toggle Hands-Free voice barge-in. When enabled the open mic keeps streaming
// while the AI speaks, so the server's VAD can cut it off naturally when you
// talk over it (headsets may feed the AI's own voice back and self-barge-in).
// When disabled the mic is gated while the AI speaks and the Interrupt button
// or a typed message is the way to cut in.
export function setLiveVoiceBargeIn(enabled: boolean): boolean {
  if (!active) return false;
  active.bargeInEnabled = enabled;
  emitState(active);
  return true;
}

// Play a short two-tone chirp through a chosen output device (or the system
// default) so the user can confirm speaker routing without waiting for the
// AI to talk. Uses its own throwaway AudioContext so the live session's
// graph and jitter buffer are never disturbed.
export async function playOutputTest(deviceId?: string): Promise<void> {
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctor();
    if (deviceId && deviceId !== "default" && isAudioContextSinkSupported()) {
      const present = await isOutputDevicePresent(deviceId);
      if (present) {
        const withSink = ctx as AudioContext & AudioContextWithSink;
        try {
          await withSink.setSinkId?.(deviceId);
        } catch (e) {
          console.warn("Test tone could not use requested device:", e);
        }
      }
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.62);
    osc.onended = () => {
      ctx.close().catch(() => {});
    };
  } catch (e) {
    console.warn("Failed to play output test tone:", e);
  }
}

export function interruptAiSpeech(): void {
  if (!active) return;
  active.turnCancelled = true;
  const rawMt = active.modelTranscript.trim();
  if (rawMt) {
    active.isInterrupted = true;
    active.lastInterruptedStatement = rawMt;
  }
  stopPlayback(active);
  active.modelTranscript = "";
  // Reset for next turn so stale flag doesn't bleed (see Fix D)
  active.audioSentInCurrentTurn = false;
  active.options?.onModelTranscript?.("", false);
  emitState(active);
}

// Rewind the in-session conversation to the current point. Stops playback,
// clears active transcripts and pops the last turn from the turn history, and
// fires callbacks so the UI can purge its visible transcript / message list.
export function rewindLiveVoice(onRewind?: () => void): void {
  if (!active) return;
  stopPlayback(active);
  active.userTranscript = "";
  active.modelTranscript = "";
  active.audioSentInCurrentTurn = false;
  active.turnCancelled = false;
  active.lastCompletedAudioChunks = [];
  active.lastCompletedModelText = "";
  active.isInterrupted = false;
  active.lastInterruptedStatement = "";
  if (active.turnHistory.length > 0) {
    active.turnHistory.pop();
  }
  active.options?.onUserTranscript?.("", false);
  active.options?.onModelTranscript?.("", false);
  emitState(active);
  onRewind?.();
  reconnectAttempts = 0;
  reconnectNow().catch(() => scheduleReconnect());
}

/**
 * Check if Live Voice is currently speaking audio
 */
export function isLiveVoiceSpeaking(): boolean {
  return !!active?.isSpeaking;
}

/**
 * Repeat / Replay: Replays the AI's last completed response.
 * Plays cached audio chunks if available, or speaks text via TTS engine directly.
 */
export function replayLastStatement(): boolean {
  if (!active) return false;
  if (active.lastCompletedAudioChunks && active.lastCompletedAudioChunks.length > 0) {
    stopPlayback(active);
    active.isSpeaking = true;
    emitState(active);
    const ctx = setupAudioPlayback(active);
    for (const chunk of active.lastCompletedAudioChunks) {
      _scheduleAudioChunk(active, ctx, chunk);
    }
    return true;
  } else if (active.lastCompletedModelText) {
    // Client-side TTS replay guarantees exact speech without server hallucination or chat pollution
    defaultTtsEngine.speak(active.lastCompletedModelText, active.options?.voiceName);
    return true;
  }
  return false;
}

/**
 * Interrupted Speech Recovery: Resumes or restarts speech after talkover or barge-in interruption.
 * @param restart If true, restarts from the beginning; otherwise continues the thought.
 */
export function recoverInterruptedStatement(restart = false): boolean {
  if (!active) return false;
  const text = active.lastInterruptedStatement;
  if (!text) return false;
  const prompt = restart
    ? `You were interrupted while saying: "${text}". Please restart and say your complete response again from the beginning.`
    : `You were interrupted while saying: "${text}". Please continue your thought and finish what you were saying from that point.`;
  active.isInterrupted = false;
  active.lastInterruptedStatement = "";
  emitState(active);
  sendTextMessage(prompt);
  return true;
}

export function sendTextMessage(text: string, turnComplete = true): void {
  if (!active?.session) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  // Ensure the audio context is running: the send button / Enter key counts as
  // a user gesture, so this is the reliable place to recover an interrupted
  // context (mic release in hold/tap mode makes Android pull audio focus).
  setupAudioPlayback(active);
  active.userTranscript = trimmed;
  active.options?.onUserTranscript?.(trimmed, true);
  // gemini-3.1-flash-live-preview only accepts live text through
  // sendRealtimeInput. sendClientContent mid-conversation is documented as
  // seed-only for that model and returns a text-only reply instead of speech.
  active.session.sendRealtimeInput({ text: trimmed });
  if (turnComplete) {
    forceSendTurn();
  }
}

export function stopLiveVoice(): void {
  operationId += 1;
  manualStop = true;
  isReconnecting = false;
  clearReconnectTimer();
  teardownSession(active);
  active = null;
  releaseWorkletUrl();
}

/**
 * Force Gemini to reply immediately: stops mic capture, sends audioStreamEnd,
 * then sends clientContent { turnComplete: true } so the model doesn't keep
 * waiting for VAD silence detection. Equivalent to Android's forceSendTurn().
 * Always sends both signals regardless of audioSentInCurrentTurn stale state,
 * so Force Reply never does nothing or sends a duplicate pair on retry.
 */
export function forceSendTurn(): void {
  if (!active) return;
  if (active.isSpeaking) {
    interruptAiSpeech();
    active.turnCancelled = false;
  }
  // Stop mic so we don't keep streaming while Gemini is generating
  active.pushToTalk = false;
  syncMicSendingState(active);
  // Always send both audioStreamEnd and turnComplete regardless of the
  // audioSentInCurrentTurn flag which can be stuck from a previous turn.
  if (!active.session) {
    emitState(active);
    return;
  }
  try {
    active.session.sendRealtimeInput({ audioStreamEnd: true });
  } catch (e) {
    console.warn("Failed to send audioStreamEnd:", e);
  }
  active.audioSentInCurrentTurn = false;
  sendTurnComplete(active);
  emitState(active);
}



export function getLiveVoiceState(): LiveVoiceState {
  if (!active) {
    return {
      status: "idle",
      isListening: false,
      isSpeaking: false,
      isMicMuted: false,
      isAiMuted: false,
      micMode: "hold",
      model: "",
      voiceName: "Kore",
      inputLevel: 0,
      outputLevel: 0,
      outputVolume: 1,
      bargeInEnabled: false,
      isReconnecting: false,
    };
  }
  return {
    status: active.status,
    isListening: isMicSending(active),
    isSpeaking: active.isSpeaking,
    isMicMuted: active.isMicMuted,
    isAiMuted: active.isAiMuted,
    micMode: active.micMode,
    model: active.model,
    voiceName: active.voiceName,
    inputLevel: active.inputLevel,
    outputLevel: active.outputLevel,
    outputVolume: active.outputVolume,
    bargeInEnabled: active.bargeInEnabled,
    isReconnecting,
  };
}

export function getLiveVoiceTurnHistory(): { user: string; model: string }[] {
  return active?.turnHistory ? [...active.turnHistory] : [];
}