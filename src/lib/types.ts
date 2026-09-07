export enum AppMode {
  SCENARIO = 'Scenario',
  ROLEPLAY = 'Roleplay',
  GAME = 'Game',
  NARRATIVE = 'Novel'
}

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  type: 'Weapon' | 'Armor' | 'Consumable' | 'Quest' | 'Misc';
  rarity?: 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';
  value?: string;
  imageUrl?: string;
}

export interface PlayerProfile {
  name: string;
  description: string;
  personality?: string;
  backstory?: string;
  appearance?: string;
  clothing?: string;
  accessories?: string;
  hairStyle?: string;
  hairColor?: string;
  eyeColor?: string;
  // Full character-sheet depth (populated by quick-create / refined setup so the
  // player's character is built out as richly as the AI character).
  traits?: {
    friendliness?: number;
    assertiveness?: number;
    empathy?: number;
    [key: string]: number | undefined;
  };
  characterFlaws?: string;
  secretMotive?: string;
  speechPattern?: string;
  likesAndDislikes?: string;
  coreBeliefs?: string;
  quirks?: string;
  relationship?: string;
  pronouns?: string;
  gender?: string;
  age?: string;
  attire?: string;
  demeanor?: string;
  psychologicalDrivers?: string;
  relationshipDynamics?: string;
  // GAME MODE tracking (optional — only populated in Game mode sessions)
  currentHP?: number;
  maxHP?: number;
  level?: number;
  xp?: number;
  playerClass?: string;
  playerRace?: string;
}

export interface VoiceSettings {
  pitch: string;
  speed: string;
  accent: string;
}

export interface AdditionalCharacter {
  id: string;
  name: string;
  description: string;
  personality?: string;
  appearance?: string;
  avatarBase64?: string;
}

export interface CharacterProfile {
  mode: AppMode;
  name: string;
  personality: string;
  backstory: string;
  appearance: string;
  clothing?: string;
  accessories?: string;
  hairStyle?: string;
  hairColor?: string;
  eyeColor?: string;
  voiceName: string;
  voiceSettings: VoiceSettings;
  traits: {
    friendliness?: number;
    assertiveness?: number;
    empathy?: number;
    danger?: number;
    mystery?: number;
    supernatural?: number;
    strictness?: number;
    generosity?: number;
    lethality?: number;
    [key: string]: number | undefined;
  };
  storyTone: string;
  relationship: string;
  playerProfile: PlayerProfile;
  inventory?: InventoryItem[];
  additionalCharacters?: AdditionalCharacter[];
  worldSetting?: string;
  flaws?: string;
  keyCharacters?: string[];
  currentPlot?: string;
  genre?: string;
  premise?: string;
  themes?: string[];
  suggestedPlayerName?: string;
  suggestedPlayerDescription?: string;
  // ROLEPLAY MODE
  characterFlaws?: string;
  secretMotive?: string;
  speechPattern?: string;
  likesAndDislikes?: string;
  coreBeliefs?: string;
  quirks?: string;

  // SCENARIO MODE
  worldAtmosphere?: string;
  keyLocations?: string;
  scenarioStakes?: string;
  scenarioConflict?: string;
  timePeriod?: string;
  factions?: string;
  magicOrTechnologyLevel?: string;
  incitingIncident?: string;

  // GAME MODE
  gameSystem?: string;
  questObjective?: string;
  dungeonMasterStyle?: string;
  rulesComplexity?: string;
  difficultyLevel?: string;
  partyComposition?: string;
  startingEquipment?: string;
  currentCampaignArc?: string;

  // DYNAMIC STATE
  currentMood?: string;

  // VOICE PERFORMANCE — mirrors Android CharacterProfile voiceArchetype/style/pacing/accent
  voiceArchetype?: string; // e.g. "Ancient vampire lord"
  voiceStyle?: string;    // e.g. "Cold, imperious, barely suppressed menace"
  voicePacing?: string;   // e.g. "Slow, deliberate, long pauses between threats"
  voiceAccent?: string;   // e.g. "Eastern European, Transylvanian"

  // FICTIONLAB / NOVELAI PARITY FIELDS
  scenarioInstructions?: string; // Long-form Custom Scenario Instructions / director rules
  customInstructions?: string;   // Alias for custom scenario/director instructions
  lorePieces?: LorePiece[];      // Structured Lore Pieces / Lorebook
  greetingMessage?: string;      // First AI message when story opens
}

export type LoreType = 'CHARACTER' | 'LOCATION' | 'FACTION' | 'ITEM' | 'EVENT';

export interface LorePiece {
  id: string;
  name: string;
  type: LoreType;
  summary: string;
  detailedLore: string;
  tags?: string[];
}

export interface Scenario {
  id: string;
  profile: CharacterProfile;
  avatarBase64: string;
  lastUpdated: number;
  scenarioInstructions?: string;
  lorePieces?: LorePiece[];
  greetingMessage?: string;
  backstory?: string;
}

export interface CodexEntry {
  id: string;
  title: string;
  content: string;
  category: 'Lore' | 'Mechanics' | 'Location' | 'Item';
  imageUrl?: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing?: {
    prompt: string;
    completion: string;
  };
  context_length?: number;
}

export type ThemeAccent = 'emerald' | 'amethyst' | 'cyan' | 'crimson' | 'amber' | 'slate';
export type FontFamilyOption = 'sans' | 'serif' | 'mono';
export type ChatDensityOption = 'compact' | 'comfy' | 'cinematic';

// Global writing-tone dimensions (0-100). Persisted and applied across the app
// (main replies, suggestions, refinements, quick-create, live voice).
export interface WritingToneDims {
  prose: number;
  humor: number;
  romance: number;
  darkness: number;
  action: number;
  formality: number;
  pace: number;
}

export const DEFAULT_WRITING_TONE_DIMS: WritingToneDims = {
  prose: 60,
  humor: 40,
  romance: 40,
  darkness: 40,
  action: 50,
  formality: 40,
  pace: 50,
};

export interface AppSettings {
  activeTextProvider: 'Google' | 'OpenRouter';
  activeModel: string;
  openRouterApiKey?: string;
  openRouterModel?: string;
  openRouterModels?: OpenRouterModel[];
  voiceEngine: 'Cinematic' | 'Fast Browser';
  activeTTSModel: string;
  liveVoiceModel: string;
  liveVoiceName: string;
  liveVoiceTemperature?: number;
  liveVoiceMicDeviceId?: string;
  liveVoiceOutputDeviceId?: string;
  liveVoiceOutputVolume?: number;
  liveVoiceBargeIn?: boolean;
  liveVoiceMicMode?: 'hold' | 'toggle' | 'handsFree';
  liveVoiceVadSensitivity?: 'low' | 'medium' | 'high';
  // Ported from Android AppSettings — voice chat mode & quality
  voiceMode?: 'live' | 'tts' | 'voice_chat';
  voiceQuality?: 'quality' | 'speed';
  ttsSpeed?: number;
  liveVoicePitch?: number;
  themeAccent?: ThemeAccent;
  fontFamily?: FontFamilyOption;
  chatDensity?: ChatDensityOption;
  enableAmbientGlow?: boolean;
  enableAmbientSoundscape?: boolean;
  ambientVolume?: number;
  ambientSoundscape?: string;
  writingToneEnabled?: boolean;
  writingTonePreset?: string;
  writingToneDims?: WritingToneDims;
  enableAdultContent?: boolean;
  customRefineInstructions?: string;
  premiumCustomVoices?: boolean;
  premiumContextAnimations?: boolean;
  premiumAutoAvatar?: boolean;
  schemaVersion?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  isSummarized?: boolean;
  timestamp?: number;
  versions?: string[]; // Multiple drafts for this message
  activeVersionIndex?: number;
  isPinned?: boolean;
  isOoc?: boolean; // Out of character / director guidance
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export const CURRENT_SCHEMA_VERSION = 1;

export const defaultSettings: AppSettings = {
  activeTextProvider: 'Google',
  activeModel: 'gemini-3.1-flash-lite',
  openRouterModel: 'meta-llama/llama-3-8b-instruct:free',
  voiceEngine: 'Cinematic',
  activeTTSModel: 'gemini-3.1-flash-tts-preview',
  liveVoiceModel: 'gemini-3.1-flash-live-preview',
  liveVoiceName: 'Kore',
  liveVoiceTemperature: 1.0,
  liveVoiceOutputVolume: 1,
  liveVoiceBargeIn: false,
  liveVoiceMicMode: 'hold',
  liveVoiceVadSensitivity: 'medium',
  voiceMode: 'live',
  voiceQuality: 'quality',
  ttsSpeed: 1.0,
  liveVoicePitch: 1.0,
  themeAccent: 'emerald',
  fontFamily: 'sans',
  chatDensity: 'comfy',
  enableAmbientGlow: true,
  enableAmbientSoundscape: false,
  ambientVolume: 0.15,
  writingToneEnabled: true,
  writingTonePreset: 'cinematic',
  writingToneDims: DEFAULT_WRITING_TONE_DIMS,
  enableAdultContent: false,
  premiumCustomVoices: true,
  premiumContextAnimations: true,
  premiumAutoAvatar: true,
  schemaVersion: CURRENT_SCHEMA_VERSION
};

export function getSettings(): AppSettings {
  try {
    const stored = localStorage.getItem('personaforge_settings');
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migrate deprecated and legacy models to modern Google models
      if (
        !parsed.activeModel ||
        parsed.activeModel === 'gemini-3.6-flash' || 
        parsed.activeModel === 'gemini-3.5-flash' || 
        parsed.activeModel === 'gemini-3.5-flash-lite' || 
        parsed.activeModel === 'gemini-1.5-flash' || 
        parsed.activeModel === 'gemini-2.0-flash-exp' ||
        parsed.activeModel === 'gemini-3-flash-preview'
      ) {
        parsed.activeModel = 'gemini-3.1-flash-lite';
      } else if (parsed.activeModel === 'gemini-pro-latest' || parsed.activeModel === 'gemini-1.5-pro') {
        parsed.activeModel = 'gemini-3.1-pro-preview';
      }
      
      if (
        !parsed.activeTTSModel ||
        parsed.activeTTSModel === 'gemini-3.5-flash' ||
        parsed.activeTTSModel === 'gemini-1.5-flash'
      ) {
        parsed.activeTTSModel = 'gemini-3.1-flash-tts-preview';
      } else if (parsed.activeTTSModel === 'gemini-1.5-pro' || parsed.activeTTSModel === 'gemini-pro-latest') {
        parsed.activeTTSModel = 'gemini-3.1-pro-preview';
      }
      if (!parsed.liveVoiceModel) {
        parsed.liveVoiceModel = 'gemini-3.1-flash-live-preview';
      }
      if (!parsed.liveVoiceName) {
        parsed.liveVoiceName = 'Kore';
      }
      if (parsed.liveVoiceTemperature === undefined) {
        parsed.liveVoiceTemperature = 1.0;
      }
      if (parsed.liveVoiceOutputVolume === undefined) {
        parsed.liveVoiceOutputVolume = 1;
      }
      if (parsed.liveVoiceBargeIn === undefined) {
        parsed.liveVoiceBargeIn = false;
      }
      if (!parsed.liveVoiceMicMode) {
        parsed.liveVoiceMicMode = 'hold';
      }
      if (!parsed.liveVoiceVadSensitivity) {
        parsed.liveVoiceVadSensitivity = 'medium';
      }
      if (!parsed.voiceMode) {
        parsed.voiceMode = 'live';
      }
      if (!parsed.voiceQuality) {
        parsed.voiceQuality = 'quality';
      }
      if (parsed.ttsSpeed === undefined) {
        parsed.ttsSpeed = 1.0;
      }
      if (parsed.liveVoicePitch === undefined) {
        parsed.liveVoicePitch = 1.0;
      }
      if (!parsed.themeAccent) {
        parsed.themeAccent = 'emerald';
      }
      if (!parsed.fontFamily) {
        parsed.fontFamily = 'sans';
      }
      if (!parsed.chatDensity) {
        parsed.chatDensity = 'comfy';
      }
      if (parsed.enableAmbientGlow === undefined) {
        parsed.enableAmbientGlow = true;
      }
      if (parsed.enableAmbientSoundscape === undefined) {
        parsed.enableAmbientSoundscape = false;
      }
      if (parsed.ambientVolume === undefined) {
        parsed.ambientVolume = 0.15;
      }
      if (parsed.writingToneEnabled === undefined) {
        parsed.writingToneEnabled = true;
      }
      if (parsed.writingTonePreset === undefined) {
        parsed.writingTonePreset = 'cinematic';
      }
      if (parsed.writingToneDims === undefined) {
        parsed.writingToneDims = DEFAULT_WRITING_TONE_DIMS;
      }
      if (parsed.enableAdultContent === undefined) {
        parsed.enableAdultContent = false;
      }
      return { ...defaultSettings, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load settings', e);
  }
  return defaultSettings;
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem('personaforge_settings', JSON.stringify({ ...settings, schemaVersion: CURRENT_SCHEMA_VERSION }));
    // Let live listeners (e.g. the ambient soundscape) pick up changes even if
    // the calling component doesn't re-render.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('personaforge:settings'));
    }
  } catch (e) {
    console.error('Failed to save settings', e);
  }
}
