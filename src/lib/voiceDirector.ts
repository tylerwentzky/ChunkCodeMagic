// Port of Android ChatViewModel.buildDirectorPrompt()
export function buildDirectorPrompt(
  characterName: string,
  characterArchetype: string,
  sceneContext: string,
  style: string,
  pacing: string,
  accent: string,
  _transcript?: string
): string {
  let header = `Speak as ${characterName}`;
  if (characterArchetype && characterArchetype.trim()) {
    header += ` (${characterArchetype.trim()})`;
  }
  const notes: string[] = [];
  if (style && style.trim()) notes.push(`style: ${style.trim()}`);
  if (pacing && pacing.trim()) notes.push(`pacing: ${pacing.trim()}`);
  if (accent && accent.trim()) notes.push(`accent: ${accent.trim()}`);
  if (sceneContext && sceneContext.trim()) notes.push(`scene: ${sceneContext.trim().slice(0, 150)}`);
  if (notes.length > 0) {
    header += ` [${notes.join(', ')}]`;
  }
  return header;
}

import type { CharacterProfile } from './types';

export function buildDirectorPromptFromProfile(
  profile: CharacterProfile,
  storySummary: string,
  backstory: string | undefined,
  _transcript?: string
): string | undefined {
  const hasVoiceProfile = !!(profile.voiceArchetype || profile.voiceStyle || profile.voicePacing || profile.voiceAccent);
  if (!hasVoiceProfile) return undefined;
  const sceneContext = storySummary?.slice(-150) || backstory?.slice(0, 150) || '';
  return buildDirectorPrompt(
    profile.name || 'Character',
    profile.voiceArchetype || profile.name || 'Character',
    sceneContext,
    profile.voiceStyle || '',
    profile.voicePacing || '',
    profile.voiceAccent || '',
    _transcript
  );
}
