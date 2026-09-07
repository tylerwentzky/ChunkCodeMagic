import { useState, useEffect } from 'react';
import {
  X,
  Save,
  Sparkles,
  Loader2,
  RefreshCw,
  Keyboard,
  Check,
  AlertCircle,
  Cpu,
  Mic,
  Palette,
  Sliders,
  Volume2,
  FileText,
  Play,
  Square,
} from 'lucide-react';
import { useToast } from '../hooks/useToast';
import {
  AppSettings,
  getSettings,
  defaultSettings,
  saveSettings,
  ThemeAccent,
  FontFamilyOption,
  ChatDensityOption,
  WritingToneDims,
  DEFAULT_WRITING_TONE_DIMS,
} from '../lib/types';
import { refineText, fetchOpenRouterModels, validateOpenRouterKey } from '../lib/gemini';
import { RefineButton } from './RefineButton';
import { clear } from 'idb-keyval';
import { AMBIENT_PRESETS } from '../lib/ambientPresets';
import { TONE_PRESETS, TONE_DIM_LABELS, tonePresetLabel } from '../lib/tone';
import { ALL_VOICES, ROLEPLAY_VOICES, NARRATOR_VOICES, BRIGHT_VOICES, TtsEngine } from '../lib/ttsEngine';
import { useApiUsageMonitor } from '../hooks/useApiUsageMonitor';
import { UsageMonitorCard } from './UsageMonitorCard';

interface SettingsModalProps {
  onClose: () => void;
}

type SettingsTab = 'models' | 'voice' | 'theme' | 'style' | 'advanced';

const THEME_PRESETS: { id: ThemeAccent; label: string; bg: string; border: string; glow: string }[] = [
  { id: 'emerald', label: 'Emerald Matrix', bg: 'from-emerald-950/40 to-teal-950/20', border: 'border-emerald-500/40', glow: 'bg-emerald-500' },
  { id: 'amethyst', label: 'Amethyst Arcana', bg: 'from-purple-950/40 to-indigo-950/20', border: 'border-purple-500/40', glow: 'bg-purple-500' },
  { id: 'cyan', label: 'Cyberpunk Neon', bg: 'from-cyan-950/40 to-blue-950/20', border: 'border-cyan-500/40', glow: 'bg-cyan-500' },
  { id: 'crimson', label: 'Crimson Velvet', bg: 'from-rose-950/40 to-red-950/20', border: 'border-rose-500/40', glow: 'bg-rose-500' },
  { id: 'amber', label: 'Classic Fantasy', bg: 'from-amber-950/40 to-yellow-950/20', border: 'border-amber-500/40', glow: 'bg-amber-500' },
  { id: 'slate', label: 'Slate Minimal', bg: 'from-zinc-900/40 to-zinc-950/20', border: 'border-zinc-500/40', glow: 'bg-zinc-400' },
];

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('models');
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const { usageState } = useApiUsageMonitor();
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const ttsEngineRef = (useState(() => new TtsEngine())[0] as any);
  const [isRefining, setIsRefining] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [keyValidationStatus, setKeyValidationStatus] = useState<'none' | 'valid' | 'invalid'>('none');
  const [showOnlyFree, setShowOnlyFree] = useState(true);
  const [modelSearch, setModelSearch] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const { toastSuccess, toastError } = useToast();

  useEffect(() => {
    setSettings(getSettings());
    return () => {
      try { ttsEngineRef?.stop(); } catch {}
      try { window.speechSynthesis?.cancel(); } catch {}
    };
  }, [ttsEngineRef]);

  const handleChange = (field: keyof AppSettings, value: any) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleToneDim = (dim: keyof WritingToneDims, value: number) => {
    setSettings((prev) => ({
      ...prev,
      writingToneDims: { ...(prev.writingToneDims || DEFAULT_WRITING_TONE_DIMS), [dim]: value },
      // Any manual slider move means the tone is no longer exactly a preset.
      writingTonePreset: 'custom',
    }));
  };

  const handleTonePreset = (presetId: string) => {
    const preset = TONE_PRESETS[presetId];
    if (!preset) return;
    setSettings((prev) => ({
      ...prev,
      writingTonePreset: presetId,
      writingToneDims: { ...preset.dims },
    }));
  };

  const handleMatureToggle = (enabled: boolean) => {
    if (enabled) {
      const confirmed = window.confirm(
        'This enables mature, adult-themed content (including erotic scenes) in your stories.\n\nBy enabling this you confirm you are an adult, 18 years or older. All romantic and sexual content is between adult characters only.\n\nEnable Mature Content?'
      );
      if (!confirmed) return;
    }
    setSettings((prev) => ({ ...prev, enableAdultContent: enabled }));
  };

  const handleRefineInstructions = async (guidance?: string) => {
    if (isRefining) return;
    setIsRefining(true);
    try {
      const refined = await refineText(
        settings.customRefineInstructions || '',
        'These are custom writing style instructions for an AI roleplay assistant.',
        guidance
      );
      setSettings((prev) => ({ ...prev, customRefineInstructions: refined }));
      toastSuccess('Instructions refined');
    } catch (err: any) {
      console.error('Refine error:', err);
      toastError('Failed to refine instructions');
    } finally {
      setIsRefining(false);
    }
  };

  const handleRefreshModels = async () => {
    setIsFetchingModels(true);
    try {
      const models = await fetchOpenRouterModels();
      if (models && models.length > 0) {
        handleChange('openRouterModels', models);
        toastSuccess(`Fetched ${models.length} models from OpenRouter`);
      } else {
        toastError('No models returned from OpenRouter');
      }
    } catch (err) {
      console.error('Failed to fetch models:', err);
      toastError('Failed to fetch OpenRouter models');
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleTestKey = async () => {
    if (!settings.openRouterApiKey || isValidatingKey) return;
    setIsValidatingKey(true);
    setKeyValidationStatus('none');
    try {
      const isValid = await validateOpenRouterKey(settings.openRouterApiKey);
      setKeyValidationStatus(isValid ? 'valid' : 'invalid');
      if (isValid) {
        toastSuccess('OpenRouter API key is valid!');
      } else {
        toastError('Invalid OpenRouter API key.');
      }
    } catch (err) {
      setKeyValidationStatus('invalid');
      toastError('Failed to test API key');
    } finally {
      setIsValidatingKey(false);
    }
  };

  const handleSave = () => {
    saveSettings(settings);
    // Apply font family and theme to body immediately
    if (typeof document !== 'undefined') {
      document.body.dataset.theme = settings.themeAccent || 'emerald';
    }
    toastSuccess('Customizations & settings saved!');
    onClose();
  };

  const handleClearData = async () => {
    try {
      await clear();
      localStorage.clear();
      toastSuccess('All data cleared. Reloading...');
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      console.error('Failed to clear data', e);
      toastError('Failed to clear data');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-3 sm:p-6">
      <div className="bg-zinc-950 border border-white/10 rounded-[2rem] w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <Sliders className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white font-serif tracking-tight">
                Studio Customizer & Settings
              </h2>
              <p className="text-xs text-zinc-400">Configure models, audio studio, UI themes, and AI rules</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-xl transition-colors text-zinc-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-white/10 bg-black/40 px-6 overflow-x-auto custom-scrollbar gap-1 py-2">
          {[
            { id: 'models' as SettingsTab, label: 'AI Models', icon: Cpu },
            { id: 'voice' as SettingsTab, label: 'Voice & Audio', icon: Mic },
            { id: 'theme' as SettingsTab, label: 'Themes & UI', icon: Palette },
            { id: 'style' as SettingsTab, label: 'Writing Style', icon: FileText },
            { id: 'advanced' as SettingsTab, label: 'Shortcuts & Data', icon: Keyboard },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-lg shadow-emerald-500/5'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[65vh] custom-scrollbar">
          {/* TAB 1: AI MODELS & PROVIDERS */}
          {activeTab === 'models' && (
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-200">Active Text Provider</label>
                <select
                  value={settings.activeTextProvider || 'Google'}
                  onChange={(e) => handleChange('activeTextProvider', e.target.value as any)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                >
                  <option value="Google">Google (Gemini AI Models)</option>
                  <option value="OpenRouter">OpenRouter (Third-Party Open Models)</option>
                </select>
              </div>

              {settings.activeTextProvider === 'Google' ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-200">Active Gemini Model</label>
                  <select
                    value={settings.activeModel}
                    onChange={(e) => handleChange('activeModel', e.target.value)}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  >
                    <optgroup label="Ultra-Fast & Responsive (Recommended)">
                      <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite (Fastest • Instant Sub-Second Responses)</option>
                      <option value="gemini-3.7-flash">Gemini 3.7 Flash (Creative Narrative & Depth)</option>
                      <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (Lightweight & Low Latency)</option>
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash (Balanced Standard)</option>
                    </optgroup>
                    <optgroup label="Deep Reasoning (Pro Models)">
                      <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview (Complex Reasoning)</option>
                      <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    </optgroup>
                    <optgroup label="Autonomous Agents">
                      <option value="antigravity-preview-05-2026">Antigravity Preview</option>
                      <option value="deep-research-preview-04-2026">Deep Research Preview</option>
                      <option value="deep-research-max-preview-04-2026">Deep Research Max Preview</option>
                    </optgroup>
                    <optgroup label="Open Weights (Gemma)">
                      <option value="gemma-4-31b-it">Gemma 4 31B IT</option>
                      <option value="gemma-4-26b-a4b-it">Gemma 4 26B MoE IT</option>
                    </optgroup>
                  </select>
                  <p className="text-[11px] text-zinc-500">
                    Automatic backoff chain falls back seamlessly if high demand or quota limits occur.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-sm font-medium text-gray-200">OpenRouter API Key</label>
                      <button
                        onClick={handleTestKey}
                        disabled={!settings.openRouterApiKey || isValidatingKey}
                        className={`text-[10px] font-bold px-3 py-1 rounded-lg border transition-all flex items-center gap-1.5 ${
                          keyValidationStatus === 'valid'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : keyValidationStatus === 'invalid'
                            ? 'bg-red-500/10 text-red-400 border-red-500/30'
                            : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/20'
                        } disabled:opacity-50`}
                      >
                        {isValidatingKey ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : keyValidationStatus === 'valid' ? (
                          <Check className="w-3 h-3" />
                        ) : keyValidationStatus === 'invalid' ? (
                          <AlertCircle className="w-3 h-3" />
                        ) : (
                          <Sparkles className="w-3 h-3" />
                        )}
                        {isValidatingKey
                          ? 'Testing...'
                          : keyValidationStatus === 'valid'
                          ? 'Valid'
                          : keyValidationStatus === 'invalid'
                          ? 'Invalid'
                          : 'Test Key'}
                      </button>
                    </div>
                    <input
                      type="password"
                      value={settings.openRouterApiKey || ''}
                      onChange={(e) => {
                        handleChange('openRouterApiKey', e.target.value);
                        if (keyValidationStatus !== 'none') setKeyValidationStatus('none');
                      }}
                      placeholder="sk-or-v1-..."
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-sm font-medium text-gray-200">OpenRouter Model</label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowOnlyFree(!showOnlyFree)}
                          className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                            showOnlyFree
                              ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                              : 'bg-zinc-800 text-zinc-500 border border-white/5'
                          }`}
                        >
                          {showOnlyFree ? 'Free Only' : 'All Models'}
                        </button>
                        <button
                          type="button"
                          onClick={handleRefreshModels}
                          disabled={isFetchingModels}
                          className="text-[10px] flex items-center gap-1 text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3 h-3 ${isFetchingModels ? 'animate-spin' : ''}`} />
                          Refresh
                        </button>
                      </div>
                    </div>

                    <input
                      type="text"
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder="Filter models by name or id..."
                      className="w-full bg-black/30 border border-white/10 rounded-t-xl px-4 py-2 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50"
                    />
                    <select
                      value={settings.openRouterModel || 'meta-llama/llama-3-8b-instruct:free'}
                      onChange={(e) => handleChange('openRouterModel', e.target.value)}
                      className="w-full bg-black/50 border border-white/10 border-t-0 rounded-b-xl px-4 py-2 text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="meta-llama/llama-3-8b-instruct:free">Llama 3 8B (Free)</option>
                      <option value="meta-llama/llama-3.1-70b-instruct">Llama 3.1 70B</option>
                      <option value="mistralai/mistral-7b-instruct:free">Mistral 7B (Free)</option>
                      <option value="google/gemma-2-9b-it:free">Gemma 2 9B (Free)</option>
                      <option value="anthropic/claude-3-haiku">Claude 3 Haiku</option>
                      <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: VOICE & AUDIO STUDIO — Section 7 parity */}
          {activeTab === 'voice' && (
            <div className="space-y-5">
              {/* Banner — current active config */}
              {(() => {
                const voiceDesc = ALL_VOICES.find(v=> v.name===(settings.liveVoiceName||'Kore'))?.character || 'Firm';
                const banner = settings.voiceMode === 'live' ? `🎙 Live Voice  ·  ${settings.liveVoiceName||'Kore'} (${voiceDesc})  ·  ${settings.liveVoiceModel?.includes('2.5') ? 'Stable' : 'Latest'} model`
                  : settings.voiceMode === 'voice_chat' ? `🎙 Voice Chat  ·  ${settings.liveVoiceName||'Kore'} (${voiceDesc})  ·  ${settings.voiceQuality==='speed' ? 'Speed (Flash TTS)' : 'Quality (Pro TTS)'}`
                  : `🎙 Turn-Based (TTS)  ·  ${settings.liveVoiceName||'Kore'} (${voiceDesc})  ·  Tap speaker per message`;
                return <div className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs font-bold text-emerald-300">{banner}</div>;
              })()}

              {/* SECTION 1 — Voice Mode (always visible, top) */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-200">Voice Mode</label>
                <div className="space-y-2">
                  {[
                    ['live', 'Live Voice — Real-time Gemini WebSocket', 'Real-time two-way conversation via Gemini\'s websocket. Lowest latency, talks as you talk. Gemini voice only.'],
                    ['voice_chat', 'Voice Chat — Speak & hear replies (STT + Gemini TTS)', 'You speak → AI thinks → AI speaks back. Uses the high-quality Gemini TTS engine with full director prompts and audio tags. Best for immersive roleplay.'],
                    ['tts', 'On-Demand Narration — AI reads each reply automatically', 'AI reads each reply automatically. Same Gemini TTS engine as Voice Chat, just on demand per message.'],
                  ].map(([key, title, desc]) => {
                    const selected = (settings.voiceMode||'live')===key;
                    return (
                      <button key={key} type="button" onClick={()=> handleChange('voiceMode', key as any)} className={`w-full text-left p-3 rounded-xl border flex gap-3 ${selected ? 'bg-emerald-500/15 border-emerald-500/30' : 'bg-white/[0.03] border-white/10 hover:bg-white/5'}`}>
                        <div className={`mt-1 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${selected ? 'border-emerald-400 bg-emerald-500' : 'border-zinc-600'}`}>{selected && <div className="w-2 h-2 rounded-full bg-white" />}</div>
                        <div>
                          <div className="text-sm font-bold text-white">{title}</div>
                          <div className="text-xs text-zinc-400 leading-snug">{desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* SECTION 2 — Live Voice Settings (show only when voiceMode === 'live') */}
              {(!settings.voiceMode || settings.voiceMode === 'live') && (
                <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/10 space-y-4">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-emerald-400" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                      Live Voice Settings
                    </h4>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-200">Live Voice Model</label>
                    <div className="space-y-2">
                      {[
                        ['latest', 'Latest (gemini-3.1-flash-live-preview)'],
                        ['stable', 'Stable (gemini-2.5-flash-native-audio)'],
                      ].map(([key, label]) => {
                        const currentKey = settings.liveVoiceModel?.includes('2.5') ? 'stable' : 'latest';
                        const selected = currentKey===key;
                        const full = key==='latest' ? 'gemini-3.1-flash-live-preview' : 'gemini-2.5-flash-native-audio-preview-12-2025';
                        return (
                          <button key={key} type="button" onClick={()=> handleChange('liveVoiceModel', full)} className={`w-full text-left p-3 rounded-xl border flex items-center gap-3 ${selected ? 'bg-emerald-500/15 border-emerald-500/30' : 'bg-white/[0.03] border-white/10 hover:bg-white/5'}`}>
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${selected ? 'border-emerald-400 bg-emerald-500' : 'border-zinc-600'}`}>{selected && <div className="w-2 h-2 rounded-full bg-white" />}</div>
                            <span className="text-sm text-white">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-zinc-500">Auto-falls back through gemini-3.1-flash-live-preview → gemini-2.5-flash-native-audio-preview-12-2025 → gemini-2.5-flash-native-audio-preview-09-2025 on 429.</p>
                  </div>

                  {/* Microphone Mode */}
                  <div className="space-y-2 pt-1">
                    <div className="flex justify-between items-center">
                      <label className="text-xs text-gray-300 font-medium">Microphone Mode</label>
                      <span className="text-[10px] text-zinc-500">
                        {settings.liveVoiceMicMode === 'handsFree'
                          ? 'Open mic'
                          : settings.liveVoiceMicMode === 'toggle'
                          ? 'Tap to start/stop'
                          : 'Press and hold'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { key: 'hold', label: 'Hold to Talk' },
                        { key: 'toggle', label: 'Tap to Talk' },
                        { key: 'handsFree', label: 'Hands-Free' },
                      ].map(({ key, label }) => {
                        const isSelected = (settings.liveVoiceMicMode || 'hold') === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => handleChange('liveVoiceMicMode', key as any)}
                            className={`py-2 text-xs font-semibold rounded-xl border transition-all ${
                              isSelected
                                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white hover:bg-white/5'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Barge-In */}
                  <div className="flex items-center justify-between pt-1">
                    <div>
                      <label className="text-xs text-gray-300 font-medium">Barge-In (Allow Interruptions)</label>
                      <p className="text-[10px] text-zinc-500">Allow speaking to interrupt Gemini during live conversation</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.liveVoiceBargeIn ?? true}
                      onChange={(e) => handleChange('liveVoiceBargeIn', e.target.checked)}
                      className="accent-emerald-500 w-4 h-4 rounded cursor-pointer"
                    />
                  </div>

                  {/* VAD Sensitivity */}
                  <div className="space-y-2 pt-1">
                    <div className="flex justify-between items-center">
                      <label className="text-xs text-gray-300 font-medium">Voice Activity Detection (VAD)</label>
                      <span className="text-[10px] text-zinc-500">
                        {settings.liveVoiceVadSensitivity === 'high'
                          ? 'Fast cutoff (200ms pad)'
                          : settings.liveVoiceVadSensitivity === 'low'
                          ? 'Tolerates pauses (400ms pad)'
                          : 'Balanced (300ms pad)'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { key: 'low', label: 'Low (Noisy)' },
                        { key: 'medium', label: 'Default' },
                        { key: 'high', label: 'High (Fast)' },
                      ].map(({ key, label }) => {
                        const isSelected = (settings.liveVoiceVadSensitivity || 'medium') === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => handleChange('liveVoiceVadSensitivity', key as any)}
                            className={`py-2 text-xs font-semibold rounded-xl border transition-all ${
                              isSelected
                                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white hover:bg-white/5'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Voice Output Volume */}
                  <div className="space-y-2 pt-1">
                    <div className="flex justify-between items-center">
                      <label className="text-xs text-gray-300 font-medium">
                        Voice Output Volume ({Math.round((settings.liveVoiceOutputVolume ?? 1.0) * 100)}%)
                      </label>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.05"
                      value={settings.liveVoiceOutputVolume ?? 1.0}
                      onChange={(e) => handleChange('liveVoiceOutputVolume', parseFloat(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>

                  <div className="space-y-2 pt-1">
                    <div className="flex justify-between items-center">
                      <label className="text-xs text-gray-300">
                        Sensitivity / Spontaneity ({settings.liveVoiceTemperature ?? 1.0})
                      </label>
                      <span className="text-[10px] text-zinc-500">
                        {settings.liveVoiceTemperature && settings.liveVoiceTemperature > 1.1
                          ? 'Creative & Unpredictable'
                          : 'Balanced & Steady'}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.2"
                      max="1.5"
                      step="0.1"
                      value={settings.liveVoiceTemperature ?? 1.0}
                      onChange={(e) => handleChange('liveVoiceTemperature', parseFloat(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>
                </div>
              )}

              {/* SECTION 3 — TTS Quality (show only when voiceMode === 'tts' or 'voice_chat') */}
              {(settings.voiceMode === 'tts' || settings.voiceMode === 'voice_chat') && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-200">Voice Quality</label>
                  <select
                    value={settings.voiceQuality || 'quality'}
                    onChange={(e) => handleChange('voiceQuality', e.target.value as any)}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="quality">Quality (Pro TTS — best fidelity, slower)</option>
                    <option value="speed">Speed (Flash TTS — fast, great for real-time)</option>
                  </select>
                </div>
              )}

              {/* SECTION 3.5 — Speech Speed / Rate */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-200">Speech Speed</label>
                  <span className="text-xs text-emerald-400 font-mono">{(settings.ttsSpeed ?? 1.0).toFixed(2)}x</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[0.75, 1.0, 1.25, 1.5].map((rate) => {
                    const isSelected = (settings.ttsSpeed ?? 1.0) === rate;
                    return (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => handleChange('ttsSpeed', rate)}
                        className={`py-2 text-xs font-semibold rounded-xl border transition-all ${
                          isSelected
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                            : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {rate}x
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-zinc-500">Controls narration and TTS playback rate.</p>
              </div>

              {/* SECTION 3.6 — Voice Pitch */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-200">Voice Pitch</label>
                  <span className="text-xs text-emerald-400 font-mono">{(settings.liveVoicePitch ?? 1.0).toFixed(2)}x</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { pitch: 0.85, label: '0.85x Low' },
                    { pitch: 1.0, label: '1.00x Normal' },
                    { pitch: 1.15, label: '1.15x High' },
                    { pitch: 1.3, label: '1.30x Sharp' },
                  ].map(({ pitch, label }) => {
                    const isSelected = (settings.liveVoicePitch ?? 1.0) === pitch;
                    return (
                      <button
                        key={pitch}
                        type="button"
                        onClick={() => handleChange('liveVoicePitch', pitch)}
                        className={`py-2 text-xs font-semibold rounded-xl border transition-all ${
                          isSelected
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                            : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-zinc-500">Controls voice pitch for Live Voice and narration audio.</p>
              </div>

              {/* SECTION 4 — Voice Picker — 30 Gemini Voices (always visible) */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-200">Voice Picker — 30 Gemini Voices</label>
                <p className="text-[11px] text-zinc-500">Grouped as Roleplay / Narration / Bright. Tap to select, ▶ to preview.</p>
                {(() => {
                  const groups: Array<[string, string[]]> = [
                    ['Roleplay / Character', [...ROLEPLAY_VOICES]],
                    ['Narration', [...NARRATOR_VOICES]],
                    ['Bright / Companion', [...BRIGHT_VOICES]],
                    ['All', ALL_VOICES.map(v=>v.name).filter(n=> ![...ROLEPLAY_VOICES, ...NARRATOR_VOICES, ...BRIGHT_VOICES].includes(n))],
                  ];
                  const handlePreview = async (voiceName: string, desc: string) => {
                    if (previewingVoice === voiceName) {
                      try { ttsEngineRef.stop(); } catch {}
                      try { window.speechSynthesis.cancel(); } catch {}
                      setPreviewingVoice(null);
                      return;
                    }
                    try { ttsEngineRef.stop(); window.speechSynthesis.cancel(); } catch {}
                    setPreviewingVoice(voiceName);
                    const sample = `Hello, I am ${voiceName}, ${desc}. This is a preview of my voice.`;
                    try {
                      await ttsEngineRef.speak(sample, voiceName, null, false, () => setPreviewingVoice(null));
                    } catch {
                      try {
                        const u = new SpeechSynthesisUtterance(sample);
                        u.onend = () => setPreviewingVoice(null);
                        window.speechSynthesis.speak(u);
                      } catch { setPreviewingVoice(null); }
                    }
                    setTimeout(() => setPreviewingVoice(prev => prev === voiceName ? null : prev), 8000);
                  };
                  return (
                    <div className="space-y-3">
                      {groups.map(([label, names]) => (
                        <div key={label} className="space-y-1">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
                          <div className="grid grid-cols-1 gap-1">
                            {names.map((name: string) => {
                              const desc = ALL_VOICES.find(v=>v.name===name)?.character || '';
                              const isSelected = settings.liveVoiceName === name;
                              const isPreviewing = previewingVoice === name;
                              return (
                                <div key={name} className={`flex items-center gap-1 px-3 py-2 rounded-xl border ${isSelected ? 'bg-emerald-500/15 border-emerald-500/30' : 'bg-white/[0.02] border-white/5'}`}>
                                  <button
                                    type="button"
                                    onClick={() => handleChange('liveVoiceName', name)}
                                    className={`flex-1 text-left flex justify-between items-center ${isSelected ? 'text-emerald-300' : 'text-zinc-400 hover:text-white'}`}
                                  >
                                    <span className="text-xs font-medium">{name} — <span className="text-[11px] opacity-70">{desc}</span></span>
                                    {isSelected && <Check className="w-3 h-3 text-emerald-400 shrink-0" />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handlePreview(name, desc)}
                                    className={`p-1.5 rounded-lg border transition-colors ${isPreviewing ? 'bg-red-500/20 border-red-500/30 text-red-400' : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white hover:bg-white/10'}`}
                                    title={isPreviewing ? 'Stop preview' : 'Preview voice'}
                                  >
                                    {isPreviewing ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* SECTION 6 — Usage Monitor (always visible, bottom) */}
              <UsageMonitorCard usageState={usageState} />
            </div>
          )}

          {/* TAB 3: THEMES & UI CUSTOMIZER */}
          {activeTab === 'theme' && (
            <div className="space-y-6">
              {/* Theme Accent Palettes */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-200">App Theme Accent</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {THEME_PRESETS.map((t) => {
                    const isSelected = (settings.themeAccent || 'emerald') === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleChange('themeAccent', t.id)}
                        className={`p-3 rounded-2xl text-left border transition-all flex items-center gap-2.5 ${
                          isSelected
                            ? `${t.border} bg-white/10 shadow-lg`
                            : 'border-white/5 bg-white/[0.02] hover:bg-white/5'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full ${t.glow} shadow-md`} />
                        <span className="text-xs font-bold text-white">{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Typography / Font Selector */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-200">Typography Style</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'sans' as FontFamilyOption, label: 'Modern Sans', preview: 'Clean & Sharp' },
                    { id: 'serif' as FontFamilyOption, label: 'Classic Book', preview: 'Storybook Serif' },
                    { id: 'mono' as FontFamilyOption, label: 'Arcade Mono', preview: 'Retro Terminal' },
                  ].map((f) => {
                    const isSelected = (settings.fontFamily || 'sans') === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => handleChange('fontFamily', f.id)}
                        className={`p-3 rounded-2xl text-left border transition-all ${
                          isSelected
                            ? 'border-emerald-500/40 bg-emerald-500/15'
                            : 'border-white/5 bg-white/[0.02] hover:bg-white/5'
                        }`}
                      >
                        <div className="text-xs font-bold text-white">{f.label}</div>
                        <div className="text-[10px] text-zinc-400 mt-0.5">{f.preview}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Chat Message Density */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-200">Chat Density</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'compact' as ChatDensityOption, label: 'Compact', desc: 'More lines on screen' },
                    { id: 'comfy' as ChatDensityOption, label: 'Comfy', desc: 'Balanced spacing' },
                    { id: 'cinematic' as ChatDensityOption, label: 'Cinematic', desc: 'Immersive margins' },
                  ].map((d) => {
                    const isSelected = (settings.chatDensity || 'comfy') === d.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => handleChange('chatDensity', d.id)}
                        className={`p-3 rounded-2xl text-left border transition-all ${
                          isSelected
                            ? 'border-emerald-500/40 bg-emerald-500/15'
                            : 'border-white/5 bg-white/[0.02] hover:bg-white/5'
                        }`}
                      >
                        <div className="text-xs font-bold text-white">{d.label}</div>
                        <div className="text-[10px] text-zinc-400 mt-0.5">{d.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Ambient Glow Toggle */}
              <div className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.02] border border-white/10">
                <div>
                  <h4 className="text-xs font-bold text-white">Atmospheric Ambient Glow</h4>
                  <p className="text-[11px] text-zinc-400">Enable soft radial lighting and background particle effects</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleChange('enableAmbientGlow', !settings.enableAmbientGlow)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${
                    settings.enableAmbientGlow ? 'bg-emerald-600' : 'bg-zinc-800'
                  }`}
                >
                  <div
                    className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${
                      settings.enableAmbientGlow ? 'left-6' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              {/* Ambient Soundscape Section */}
              <div className="space-y-4 p-4 rounded-2xl bg-white/[0.02] border border-white/10">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-white">Ambient Soundscape</h4>
                    <p className="text-[11px] text-zinc-400">
                      Procedural scene ambience matched to the world's atmosphere (no audio files needed)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleChange('enableAmbientSoundscape', !settings.enableAmbientSoundscape)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${
                      settings.enableAmbientSoundscape ? 'bg-emerald-600' : 'bg-zinc-800'
                    }`}
                    aria-label="Toggle Ambient Soundscape"
                  >
                    <div
                      className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${
                        settings.enableAmbientSoundscape ? 'left-6' : 'left-1'
                      }`}
                    />
                  </button>
                </div>

                {settings.enableAmbientSoundscape && (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                          Ambience Volume
                        </label>
                        <span className="text-[10px] text-zinc-500 font-mono tabular-nums">
                          {Math.round((settings.ambientVolume ?? 0.15) * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round((settings.ambientVolume ?? 0.15) * 100)}
                        onChange={(e) => handleChange('ambientVolume', Number(e.target.value) / 100)}
                        className="w-full accent-emerald-500"
                        title="Ambience volume"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block mb-1.5">
                        Soundscape
                      </label>
                      <select
                        value={settings.ambientSoundscape || 'auto'}
                        onChange={(e) =>
                          handleChange(
                            'ambientSoundscape',
                            e.target.value === 'auto' ? undefined : e.target.value
                          )
                        }
                        className="w-full bg-zinc-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/40"
                      >
                        <option value="auto">Auto — match the scene's atmosphere</option>
                        {(Object.keys(AMBIENT_PRESETS) as (keyof typeof AMBIENT_PRESETS)[]).map((key) => (
                          <option key={key} value={key}>
                            {AMBIENT_PRESETS[key].label} — {AMBIENT_PRESETS[key].description}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-zinc-600 mt-1">
                        Automatic detection reads the character's world atmosphere & story tone.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: WRITING STYLE & PROMPTING */}
          {activeTab === 'style' && (
            <div className="space-y-4">
              {/* Tone Studio */}
              <div className="space-y-3 p-4 rounded-2xl bg-white/[0.02] border border-white/10">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-white">Tone Studio</h4>
                    <p className="text-[11px] text-zinc-400">
                      Shape the overall voice of the writing — applied to replies, suggestions, refinements, quick-create and live voice. Persists across scenarios.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleChange('writingToneEnabled', !settings.writingToneEnabled)}
                    className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
                      settings.writingToneEnabled === false ? 'bg-zinc-800' : 'bg-emerald-600'
                    }`}
                    aria-label="Toggle Tone Studio"
                  >
                    <div
                      className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${
                        settings.writingToneEnabled === false ? 'left-1' : 'left-6'
                      }`}
                    />
                  </button>
                </div>

                {settings.writingToneEnabled !== false && (
                  <>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block mb-1.5">
                        Preset — {tonePresetLabel(settings.writingTonePreset)}
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {Object.entries(TONE_PRESETS).map(([id, p]) => {
                          const isSelected = (settings.writingTonePreset || 'custom') === id;
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => handleTonePreset(id)}
                              className={`p-3 rounded-2xl text-left border transition-all ${
                                isSelected
                                  ? 'border-emerald-500/40 bg-emerald-500/15'
                                  : 'border-white/5 bg-white/[0.02] hover:bg-white/5'
                              }`}
                            >
                              <div className="text-xs font-bold text-white">{p.label}</div>
                              <div className="text-[10px] text-zinc-400 mt-0.5 leading-snug">{p.description}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {(Object.keys(TONE_DIM_LABELS) as (keyof WritingToneDims)[]).map((dim) => {
                        const dims = settings.writingToneDims || DEFAULT_WRITING_TONE_DIMS;
                        return (
                          <div key={dim}>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[11px] font-medium text-gray-300">{TONE_DIM_LABELS[dim]}</label>
                              <span className="text-[10px] text-zinc-500 font-mono tabular-nums">{dims[dim]}/100</span>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={dims[dim]}
                              onChange={(e) => handleToneDim(dim, Number(e.target.value))}
                              className="w-full accent-emerald-500"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-200">Mature Content</label>
                  <button
                    onClick={() => handleMatureToggle(!settings.enableAdultContent)}
                    aria-label="Toggle Mature Content"
                    className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors ${
                      settings.enableAdultContent ? 'bg-rose-600' : 'bg-zinc-800'
                    }`}
                  >
                    <span
                      className={`inline-block w-5 h-5 transform rounded-full bg-white transition-transform ${
                        settings.enableAdultContent ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500">
                  {settings.enableAdultContent
                    ? 'On — mature, adult-themed and sensual content is allowed in this story (adults only, 18+).'
                    : 'Off — stories stay clean and family-friendly. Enabling requires confirming you are 18 or older.'}
                </p>
                {settings.enableAdultContent && (
                  <div className="mt-2 flex items-start gap-2 rounded-xl bg-rose-950/30 border border-rose-900/40 px-3 py-2">
                    <span className="text-[11px] leading-relaxed text-rose-200/80">
                      Adult content toggle. All characters in any romantic or sexual situation are adults (18+).
                      The AI provider still enforces its own content limits.
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-200">Global Writing Style Instructions</label>
                  <RefineButton onRefine={handleRefineInstructions} isRefining={isRefining} />
                </div>
                <textarea
                  value={settings.customRefineInstructions || ''}
                  onChange={(e) => handleChange('customRefineInstructions', e.target.value)}
                  placeholder="e.g. 'Use poetic sensory details', 'Keep dialogue punchy and natural', 'Incorporate dark psychological tension'..."
                  className="w-full bg-black/50 border border-white/10 rounded-2xl p-4 text-xs text-white focus:outline-none focus:border-emerald-500 min-h-[120px] resize-y"
                />
                <p className="text-[11px] text-zinc-500">
                  These custom instructions are automatically injected into message generation, suggestion algorithms, and refinements.
                </p>
              </div>
            </div>
          )}

          {/* TAB 5: SHORTCUTS & DATA MANAGEMENT */}
          {activeTab === 'advanced' && (
            <div className="space-y-6">
              {/* Keyboard Shortcuts Cheat Sheet */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Keyboard className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Keyboard Shortcuts
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'Alt+V', desc: 'Live Voice Call' },
                    { key: 'Alt+S', desc: 'Studio Settings' },
                    { key: 'Alt+N', desc: 'New Persona' },
                    { key: 'Alt+L', desc: 'Persona Library' },
                    { key: 'Alt+C', desc: 'World Codex' },
                    { key: 'Alt+I', desc: 'Inventory' },
                    { key: 'Alt+R', desc: 'Refine Input' },
                    { key: 'Alt+G', desc: 'AI Suggestion' },
                    { key: 'Ctrl+Enter', desc: 'Send Message' },
                    { key: 'Space', desc: 'Push-to-Talk (Call)' },
                  ].map((sc, i) => (
                    <div
                      key={i}
                      className="flex justify-between items-center bg-white/5 px-3 py-2 rounded-xl border border-white/5"
                    >
                      <span className="text-[10px] text-zinc-400 uppercase tracking-wider">{sc.desc}</span>
                      <kbd className="px-2 py-0.5 rounded bg-zinc-800 text-emerald-400 text-[10px] font-mono border border-white/10 font-bold">
                        {sc.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>

              {/* Data Reset */}
              <div className="pt-4 border-t border-white/10 space-y-3">
                <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider">Danger Zone</h4>
                <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-between">
                  <div>
                    <h5 className="text-xs font-bold text-white">Reset Local Database</h5>
                    <p className="text-[10px] text-zinc-400">Clears all cached IndexedDB keys & local settings</p>
                  </div>
                  {!showClearConfirm ? (
                    <button
                      onClick={() => setShowClearConfirm(true)}
                      className="px-3 py-1.5 bg-red-600/30 hover:bg-red-600/50 text-red-300 border border-red-500/30 rounded-xl text-xs font-bold transition-all"
                    >
                      Clear Data
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowClearConfirm(false)}
                        className="px-2 py-1 text-xs text-zinc-400 hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleClearData}
                        className="px-3 py-1 bg-red-600 text-white rounded-lg text-xs font-bold shadow-lg"
                      >
                        Confirm Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-white/[0.02] flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg shadow-emerald-600/20 flex items-center gap-2 transition-all"
          >
            <Save className="w-4 h-4" />
            <span>Save Customizations</span>
          </button>
        </div>
      </div>
    </div>
  );
}
