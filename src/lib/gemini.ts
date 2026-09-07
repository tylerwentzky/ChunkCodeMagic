import { CharacterProfile, CodexEntry, InventoryItem, AppMode, VoiceSettings, getSettings } from "./types";
import { getToneDirective, getMatureContentDirective, getAdultSafetySettings } from "./tone";
import { sanitizeUserInput } from "./sanitize";
import { recordRequest } from "../hooks/useApiUsageMonitor";
import { buildDirectorPrompt } from "./voiceDirector";
import { synthesizeSpeech } from "./ttsEngine";

export { AppMode };
export type { CharacterProfile, CodexEntry, InventoryItem, VoiceSettings };

// Re-export Type for existing schema definitions in this file
export const Type = {
  STRING: "string",
  OBJECT: "object",
  ARRAY: "array",
  INTEGER: "integer",
  NUMBER: "number",
  BOOLEAN: "boolean"
};

/**
 * A custom client that mimics the ai.models.generateContent signature but routes requests 
 * through our backend's /api/gemini/interact endpoint (which uses ai.interactions.create).
 * This ensures we comply with the requirement to never call the Interactions API directly 
 * from the client, while avoiding a full rewrite of all functions in this file.
 */

// The server can require a shared access token (API_ACCESS_TOKEN env var on
// the backend); when the matching Vite var is present we attach it.
function apiAccessHeaders(): Record<string, string> {
  const token = (import.meta as any)?.env?.VITE_API_ACCESS_TOKEN;
  return token ? { "x-api-token": String(token) } : {};
}

function jsonPostInit(body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...apiAccessHeaders() },
    body: JSON.stringify(body),
    signal,
  };
}

export function getGenAI() {
  return {
    models: {
      generateContent: async ({ model, contents, config }: any) => {
        try { recordRequest(model); } catch {}
        const controller = new AbortController();
        try {
          const isAgent = model.startsWith('antigravity') || model.startsWith('deep-research');
          const isOmni = model.includes('omni') || model.includes('lyria');

          if (isAgent || isOmni) {
            // Route to interactions API
            const requestBody = {
              agent: isAgent ? model : undefined,
              model: !isAgent ? model : undefined,
              environment: isAgent ? 'remote' : undefined,
              input: contents,
              system_instruction: config?.systemInstruction,
              response_format: config?.responseMimeType === "application/json"
                ? (config?.responseSchema ? config.responseSchema : { type: "object" })
                : undefined,
              generation_config: {
                temperature: config?.temperature,
                top_p: config?.topP,
                max_output_tokens: config?.maxOutputTokens,
              },
              response_modalities: config?.responseModalities,
            };

            const res = await fetch(typeof window !== 'undefined' ? '/api/gemini/interact' : 'http://localhost:3000/api/gemini/interact', jsonPostInit(requestBody, controller.signal));

            if (!res.ok) {
              let errMsg = `Backend error ${res.status}`;
              try {
                const errData = await res.json();
                if (errData.error?.message) errMsg = errData.error.message;
              } catch (e) {}
              throw new Error(errMsg);
            }

            const interaction = await res.json();
            let fullOutput = "";
            const imageCandidates: any[] = [];
            const audioCandidates: any[] = [];

            for (const step of interaction.steps || []) {
              if (step.type === 'model_output') {
                for (const c of step.content || []) {
                  if (c.type === 'text' && c.text) fullOutput += c.text;
                  else if (c.type === 'image') imageCandidates.push(c);
                  else if (c.type === 'audio') audioCandidates.push(c);
                }
              }
            }

            return {
              text: fullOutput,
              candidates: [{
                content: {
                  parts: [
                    ...(fullOutput ? [{ text: fullOutput }] : []),
                    ...imageCandidates.map(img => ({ inlineData: { data: img.data, mimeType: img.mime_type }})),
                    ...audioCandidates.map(aud => ({ inlineData: { data: aud.data, mimeType: aud.mime_type }}))
                  ]
                }
              }]
            };
          } else {
            // Route to standard generateContent
            const requestBody = {
              model,
              contents,
              config: { ...config, ...(getAdultSafetySettings() || {}) }
            };

            const res = await fetch(typeof window !== 'undefined' ? '/api/gemini/generate' : 'http://localhost:3000/api/gemini/generate', jsonPostInit(requestBody, controller.signal));

            if (!res.ok) {
              let errMsg = `Backend error ${res.status}`;
              try {
                const errData = await res.json();
                if (errData.error?.message) errMsg = errData.error.message;
              } catch (e) {}
              throw new Error(errMsg);
            }

            const rawResponse = await res.json();
            if (!rawResponse.text && rawResponse.candidates && rawResponse.candidates[0]?.content?.parts?.[0]?.text) {
               rawResponse.text = rawResponse.candidates[0].content.parts[0].text;
            }
            return rawResponse;
          }
        } finally {
          // Harmless once the response is fully consumed; cancels the socket
          // if the caller abandoned the request mid-flight.
          controller.abort();
        }
      },
      
      generateContentStream: async function* ({ model, contents, config }: any) {
        try { recordRequest(model); } catch {}
        const controller = new AbortController();
        try {
          const isAgent = model.startsWith('antigravity') || model.startsWith('deep-research');
          const isOmni = model.includes('omni') || model.includes('lyria');

          if (isAgent || isOmni) {
            // Route to interactions stream API
            const requestBody = {
              agent: isAgent ? model : undefined,
              model: !isAgent ? model : undefined,
              environment: isAgent ? 'remote' : undefined,
              input: contents,
              system_instruction: config?.systemInstruction,
              response_format: config?.responseMimeType === "application/json"
                ? (config?.responseSchema ? config.responseSchema : { type: "object" })
                : undefined,
              generation_config: {
                temperature: config?.temperature,
                top_p: config?.topP,
                max_output_tokens: config?.maxOutputTokens,
              },
              response_modalities: config?.responseModalities,
            };

            const res = await fetch("/api/gemini/interact/stream", jsonPostInit(requestBody, controller.signal));

            if (!res.ok) {
              let errMsg = `Backend error ${res.status}`;
              try {
                const errData = await res.json();
                if (errData.error?.message) errMsg = errData.error.message;
              } catch (e) {}
              throw new Error(errMsg);
            }

            if (!res.body) throw new Error("No response body");

            const reader = res.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                  let data: any = null;
                  try {
                    data = JSON.parse(line.slice(6));
                  } catch (e) {
                    // Ignore parse errors for incomplete chunks
                    continue;
                  }
                  if (data) {
                    if (data.error) {
                      const msg = typeof data.error === 'object'
                        ? (data.error.message || JSON.stringify(data.error))
                        : String(data.error);
                      throw new Error(msg);
                    }
                    if (data.event_type === "step.delta") {
                       if (data.delta?.type === "text") {
                         yield {
                           text: data.delta.text,
                           candidates: [{ content: { parts: [{ text: data.delta.text }] } }]
                         };
                       }
                    }
                  }
                }
              }
            }
          } else {
            // Route to standard generateContentStream
            const requestBody = {
              model,
              contents,
              config: { ...config, ...(getAdultSafetySettings() || {}) }
            };

            const res = await fetch("/api/gemini/generate/stream", jsonPostInit(requestBody, controller.signal));

            if (!res.ok) {
              let errMsg = `Backend error ${res.status}`;
              try {
                const errData = await res.json();
                if (errData.error?.message) errMsg = errData.error.message;
              } catch (e) {}
              throw new Error(errMsg);
            }

            if (!res.body) throw new Error("No response body");

            const reader = res.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                  let data: any = null;
                  try {
                    data = JSON.parse(line.slice(6));
                  } catch (e) {
                    // Ignore parse errors for incomplete chunks
                    continue;
                  }
                  if (data) {
                    if (data.error) {
                      const msg = typeof data.error === 'object'
                        ? (data.error.message || JSON.stringify(data.error))
                        : String(data.error);
                      throw new Error(msg);
                    }
                    // the standard streaming chunk format:
                    if (!data.text && data.candidates && data.candidates[0]?.content?.parts) {
                      const parts = data.candidates[0].content.parts;
                      data.text = parts
                        .filter((p: any) => typeof p.text === 'string')
                        .map((p: any) => p.text)
                        .join('');
                    } else if (!data.text && typeof data.candidates?.[0]?.content?.parts?.[0]?.text === 'string') {
                      data.text = data.candidates[0].content.parts[0].text;
                    }
                    yield data;
                  }
                }
              }
            }
          }
        } finally {
          // Runs on completion, early break, or consumer error so an abandoned
          // stream never leaves its socket open.
          controller.abort();
        }
      }

    },
    chats: {
      create: ({ model, config, history }: any) => {
        return {
          sendMessage: async ({ message }: any) => {
            const contents = [...(history || []), { role: 'user', parts: [{ text: message }] }];
            return await getGenAI().models.generateContent({ model, contents, config });
          },
          sendMessageStream: async ({ message }: any) => {
            const contents = [...(history || []), { role: 'user', parts: [{ text: message }] }];
            return await getGenAI().models.generateContentStream({ model, contents, config });
          }
        };
      }
    }
  };
}

export function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch (e) {
    return `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1500): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    const status = error?.status || error?.code;
    
    if (errorMessage.includes('API key not valid')) {
      throw new Error("Invalid Gemini API Key. Please check your settings.");
    }
    
    if (status === 403 || errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('403')) {
      throw new Error("Permission Denied: The current model may not be available with the default key. Try switching to a 'Stable' model in Settings.");
    }

    if (errorMessage.includes('User location is not supported')) {
      throw new Error("Gemini is not available in your current location.");
    }

    // If it's a 503 or high demand error, throw immediately so the caller's fallback mechanism can switch to the fast alternative without delay
    const isDemandSpike = 
      status === 503 ||
      errorMessage.includes('503') ||
      errorMessage.includes('high demand') ||
      errorMessage.includes('UNAVAILABLE') ||
      errorMessage.includes('Service Unavailable') ||
      errorMessage.includes('overloaded');

    if (isDemandSpike) {
      throw error;
    }

    const isTransient = 
      status === 429 || 
      status === 500 || 
      errorMessage.includes('429') || 
      errorMessage.includes('500') || 
      errorMessage.includes('quota') || 
      errorMessage.includes('limit') || 
      errorMessage.includes('exhausted') ||
      errorMessage.includes('temporary');

    if (retries > 0 && isTransient) {
      const waitTime = delay + Math.random() * 500;
      console.warn(`Transient error hit (status ${status}), retrying in ${Math.round(waitTime)}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return withRetry(fn, retries - 1, delay * 2);
    }
    
    throw error;
  }
}

function getQuickFallbackModel(activeModel: string): string {
  if (activeModel === 'gemini-3.1-flash-lite' || activeModel === 'gemini-2.5-flash-lite') {
    return 'gemini-2.5-flash';
  }
  return 'gemini-3.1-flash-lite';
}

function isFallbackable(err: any): boolean {
  const errMsg = String(err?.message || err || '');
  const status = err?.status || err?.code;
  return (
    status === 400 ||
    status === 403 ||
    status === 404 ||
    status === 429 ||
    status === 500 ||
    status === 503 ||
    errMsg.includes('Permission Denied') ||
    errMsg.includes('PERMISSION_DENIED') ||
    errMsg.includes('RESOURCE_EXHAUSTED') ||
    errMsg.includes('UNAVAILABLE') ||
    errMsg.includes('not found') ||
    errMsg.includes('not supported') ||
    errMsg.includes('400') ||
    errMsg.includes('403') ||
    errMsg.includes('404') ||
    errMsg.includes('429') ||
    errMsg.includes('500') ||
    errMsg.includes('503') ||
    errMsg.includes('high demand') ||
    errMsg.includes('temporary') ||
    errMsg.includes('quota') ||
    errMsg.includes('limit') ||
    errMsg.includes('exhausted') ||
    errMsg.includes('overloaded') ||
    errMsg.includes('Service Unavailable')
  );
}

function buildPlayerBlock(profile: CharacterProfile): string {
  const inventoryBlock = (profile.mode === AppMode.GAME && profile.inventory?.length)
    ? `\nPLAYER INVENTORY:\n${profile.inventory.map(i => `- ${i.name} (${i.type}${i.rarity ? `, ${i.rarity}` : ''}): ${i.description} [Qty: ${i.quantity}]`).join('\n')}\n`
    : '';

  const pp = profile.playerProfile;
  const ppPersonality = sanitizeUserInput(pp?.personality || 'Unknown');
  const ppBackstory = sanitizeUserInput(pp?.backstory || 'Unknown');
  const deepSheet = pp?.characterFlaws || pp?.secretMotive || pp?.speechPattern || pp?.likesAndDislikes || pp?.coreBeliefs || pp?.quirks || pp?.relationship
    ? `\nPlayer Character Depth:
${pp.characterFlaws ? `- Flaws: ${pp.characterFlaws}` : ''}
${pp.secretMotive ? `- Secret Motive: ${pp.secretMotive}` : ''}
${pp.speechPattern ? `- Speech Pattern: ${pp.speechPattern}` : ''}
${pp.likesAndDislikes ? `- Likes/Dislikes: ${pp.likesAndDislikes}` : ''}
${pp.coreBeliefs ? `- Core Beliefs: ${pp.coreBeliefs}` : ''}
${pp.quirks ? `- Quirks: ${pp.quirks}` : ''}
${pp.relationship ? `- Relationship / Dynamics: ${pp.relationship}` : ''}
`
    : '';
  const pTraits = pp?.traits;
  const pTraitLines: string[] = [];
  if (pTraits) {
    Object.entries(pTraits).forEach(([trait, val]) => {
      if (val !== undefined) {
        pTraitLines.push(`- ${trait.charAt(0).toUpperCase() + trait.slice(1)}: ${val}/100`);
      }
    });
  }
  const pTraitBlock = pTraitLines.length > 0
    ? `\nPlayer Personality Traits:\n${pTraitLines.join('\n')}\n`
    : '';

  return `\nPLAYER CHARACTER (The Human Player / Protagonist):
Name: ${pp?.name || 'The Protagonist'}
Description: ${pp?.description || 'A central protagonist in the narrative'}
Personality: ${ppPersonality}
Backstory: ${ppBackstory}
Appearance: ${pp?.appearance || 'Unspecified'}
Clothing: ${pp?.clothing || 'Unspecified'}
Accessories: ${pp?.accessories || 'None'}
Hair: ${pp?.hairStyle || ''} ${pp?.hairColor || ''}`.trim() + `
Eyes: ${pp?.eyeColor || 'Unspecified'}
${profile.mode === AppMode.GAME ? `Class: ${pp?.playerClass || 'Adventurer'}\nRace: ${pp?.playerRace || 'Human'}\nHP: ${pp?.currentHP ?? '?'}/${pp?.maxHP ?? '?'}\nLevel: ${pp?.level ?? 1}\nXP: ${pp?.xp ?? 0}` : ''}
${deepSheet}${pTraitBlock}${inventoryBlock}`;
}

function buildCodexContext(codexEntries: CodexEntry[]): string {
  return codexEntries.length > 0
    ? `\nWORLD CODEX & LORE REPOSITORY (Established Facts & Canon):\n${codexEntries.slice(-20).map(e => `[${e.category.toUpperCase()}: ${e.title}] - ${e.content}`).join('\n')}\n`
    : '';
}

export function buildScenarioDirective(profile: CharacterProfile): string {
  const lines: string[] = [];

  lines.push("[SCENARIO METADATA]");
  lines.push(`Name: ${profile.name || 'Untitled'}`);
  lines.push(`Mode: ${profile.mode}`);
  const tags: string[] = [];
  if (profile.storyTone) tags.push(`Tone: ${profile.storyTone}`);
  if (profile.worldAtmosphere) tags.push(`Atmosphere: ${profile.worldAtmosphere}`);
  if (tags.length > 0) lines.push(`Tags: ${tags.join(' | ')}`);
  lines.push("");

  lines.push("[WORLD & SETTING]");
  lines.push(`Setting / Environment: ${profile.worldAtmosphere || profile.clothing || profile.name}`);
  if (profile.timePeriod) lines.push(`Time Period / Era: ${profile.timePeriod}`);
  if (profile.keyLocations) lines.push(`Key Locations & Geography: ${profile.keyLocations}`);
  if (profile.factions) lines.push(`Factions, Powers & Societies: ${profile.factions}`);
  if (profile.magicOrTechnologyLevel) lines.push(`Magic / Technology Level: ${profile.magicOrTechnologyLevel}`);
  lines.push("");

  lines.push("[NARRATIVE MODE & STORYTELLING PHILOSOPHY]");
  if (profile.mode === AppMode.ROLEPLAY) {
    lines.push("Mode: Deep First-Person Character Roleplay");
    lines.push("Perspective: Second-person narrative interacting directly with the player (\"you\").");
    lines.push(`Portrayal: You embody '${profile.name}' with complete psychological depth, distinct conversational voice, internal motivations, and emotional reactivity.`);
    lines.push("Narrative Standard: Write immersive, sensory-rich prose. Combine distinct dialogue cadence with expressive physical actions, environmental awareness, and subtle emotional cues. Leave natural room for the player to react.");
  } else if (profile.mode === AppMode.SCENARIO) {
    lines.push("Mode: Interactive Campaign Scenario & World Simulator");
    lines.push("Perspective: Second-person Game Master (GM) addressing the player.");
    lines.push("Role: Act as the Game Master (GM), describing the dynamic living world, environmental physics, hazards, NPCs, and unfolding consequences.");
  } else if (profile.mode === AppMode.NARRATIVE) {
    lines.push("Mode: Novel & Writing Generator Mode");
    lines.push("Perspective: Third-person or cinematic second-person narrative prose.");
    lines.push("Role: Act as a master novelist and storyteller focusing purely on literary depth, prose elegance, worldbuilding, and character development without any RPG mechanics, stat checks, or inventory.");
    lines.push("Narrative Standard: High-quality literary prose, exquisite dialogue tags, evocative pacing, and emotional depth.");
  } else {
    // AppMode.GAME
    lines.push("Mode: Tabletop RPG Dungeon Master & Rules Adjudicator");
    lines.push("Perspective: Second-person Dungeon Master perspective addressing the player.");
    lines.push("Role: Adjudicate rules, track tactical choices, present challenges, and simulate dice outcomes.");
    if (profile.gameSystem) lines.push(`Game System / Ruleset: ${profile.gameSystem}`);
    if (profile.questObjective) lines.push(`Current Quest / Objective: ${profile.questObjective}`);
    if (profile.rulesComplexity) lines.push(`Rules Complexity: ${profile.rulesComplexity}`);
    if (profile.difficultyLevel) lines.push(`Difficulty / Lethality: ${profile.difficultyLevel}`);
    if (profile.partyComposition) lines.push(`Party Composition: ${profile.partyComposition}`);
    if (profile.startingEquipment) lines.push(`Starting Equipment / Resources: ${profile.startingEquipment}`);
    if (profile.currentCampaignArc) lines.push(`Current Campaign Arc: ${profile.currentCampaignArc}`);
    lines.push("Narrative Standard: Fast, reactive, tactically clear, rewarding player strategy while making danger tangible.");
  }
  if (profile.dungeonMasterStyle) lines.push(`GM / Narration Style: ${profile.dungeonMasterStyle}`);
  lines.push("");

  lines.push("[ATMOSPHERE, CONFLICT & STAKES]");
  if (profile.storyTone) lines.push(`Tone: ${profile.storyTone}`);
  if (profile.worldAtmosphere) lines.push(`Atmosphere: ${profile.worldAtmosphere}`);
  if (profile.incitingIncident) lines.push(`Inciting Incident: ${profile.incitingIncident}`);
  if (profile.scenarioConflict) lines.push(`Central Conflict: ${profile.scenarioConflict}`);
  if (profile.scenarioStakes) lines.push(`Stakes: ${profile.scenarioStakes}`);
  lines.push("");

  lines.push("[CHARACTER DIALOGUE, PSYCHOLOGY & BEHAVIOR]");
  if (profile.mode === AppMode.ROLEPLAY) {
    lines.push(`Primary Character: ${profile.name}`);
    if (profile.personality) lines.push(`Personality: ${profile.personality}`);
    if (profile.backstory) lines.push(`Backstory & History: ${profile.backstory}`);
    if (profile.appearance) lines.push(`Visual Appearance: ${profile.appearance}`);
    if (profile.clothing) lines.push(`Attire & Clothing: ${profile.clothing}`);
    if (profile.accessories) lines.push(`Accessories & Carried Gear: ${profile.accessories}`);
    if (profile.hairStyle || profile.hairColor) lines.push(`Hair: ${profile.hairStyle || ''} ${profile.hairColor || ''}`.trim());
    if (profile.eyeColor) lines.push(`Eyes: ${profile.eyeColor}`);
    if (profile.relationship) lines.push(`Relationship to Player: ${profile.relationship}`);
    
    // Personality Trait Dimensions
    if (profile.traits) {
      const traitEntries = Object.entries(profile.traits).filter(([_, v]) => v !== undefined);
      if (traitEntries.length > 0) {
        lines.push("Core Trait Sliders (1-100 scale guide):");
        traitEntries.forEach(([trait, val]) => {
          lines.push(`- ${trait.charAt(0).toUpperCase() + trait.slice(1)}: ${val}/100`);
        });
      }
    }

    if (profile.likesAndDislikes) lines.push(`Likes & Dislikes: ${profile.likesAndDislikes}`);
    if (profile.quirks) lines.push(`Mannerisms & Quirks: ${profile.quirks}`);
    if (profile.characterFlaws) lines.push(`Flaws & Insecurities: ${profile.characterFlaws}`);
    if (profile.speechPattern) lines.push(`Speech Pattern, Accent & Cadence: ${profile.speechPattern}`);
    if (profile.coreBeliefs) lines.push(`Core Beliefs & Values: ${profile.coreBeliefs}`);
    if (profile.secretMotive) lines.push(`Secret Motive / Hidden Agenda: ${profile.secretMotive}`);
    if (profile.currentMood) lines.push(`Current Emotional State: ${profile.currentMood}`);
  } else {
    if (profile.additionalCharacters && profile.additionalCharacters.length > 0) {
      lines.push("Key Characters / NPCs in Play:");
      profile.additionalCharacters.forEach(c => {
        lines.push(`- ${c.name}: ${c.description}${c.personality ? ` | Personality: ${c.personality}` : ''}${c.appearance ? ` | Looks: ${c.appearance}` : ''}`);
      });
    }
    if (profile.name && profile.personality) {
      lines.push(`Featured Guide / Persona: ${profile.name} (${profile.personality})`);
    }
  }
  lines.push("NPC Behavior Principle: Every character acts with psychological realism, personal agency, and consistent motivations. They are not mindless assistants; they push back, hold secrets, experience fear, desire, curiosity, or suspicion.");
  lines.push("");

  lines.push("[TONE, GENRE & EMOTION]");
  const toneDirective = getToneDirective().trim();
  if (toneDirective) lines.push(toneDirective);
  const matureDirective = getMatureContentDirective().trim();
  if (matureDirective) lines.push(matureDirective);
  lines.push("");

  lines.push("[HIGH-LITERARY QUALITY & ANTI-GENERIC DIRECTIVES]");
  lines.push("1. Show, Don't Tell: Avoid shallow clichés (e.g. \"A chill ran down your spine\", \"You feel a surge of power\", \"Little did you know\"). Describe tangible physical sensation, shifts in lighting, spatial acoustics, scents, and subtle micro-expressions instead.");
  lines.push("2. No Echoing / Paraphrasing: Do NOT repeat the player's action back to them before responding. React directly and drive the scene forward.");
  lines.push("3. Conversational Momentum & Tension: Characters should have distinct cadence, hesitation, humor, or sharp wit. Avoid sycophantic agreement or sterile AI-like politeness.");
  lines.push("4. World Continuity & Physics: Adhere strictly to established lore, geography, injuries, and consequences. If an action is risky or irreversible, portray the realistic fallout.");
  lines.push("5. Affinity Tracking: If any NPC's trust, romantic attraction, respect, or hostility toward the player shifts, append a tag formatted as [AFFINITY: CharacterName +Delta] or [AFFINITY: CharacterName -Delta] at the very end of your response.");
  lines.push("");

  lines.push("[STRICT PLAYER AUTONOMY RULE]");
  lines.push("- Never, under any circumstances, speak, think, or act as the player.");
  lines.push("- Do not assume the player's thoughts, feelings, intentions, or dialogue.");
  lines.push("- Do not describe the player taking actions unless they explicitly commanded it in their input.");
  lines.push("- Do not fast-forward time or resolve player conflicts without giving them the opportunity to react.");
  lines.push("- Always conclude your turn at a compelling moment that invites the player's next move.");
  lines.push("");

  lines.push("[DIRECTOR INSTRUCTION HANDLING]");
  lines.push("- Messages tagged with [DIRECTOR INSTRUCTION] or [LIVE SESSION INSTRUCTIONS] are meta-level authorial directives.");
  lines.push("- Obey these constraints seamlessly without ever mentioning or narrating them in-character.");
  if (profile.mode === AppMode.ROLEPLAY) {
    lines.push("- In Roleplay mode, you MUST start your response with your character's current emotion in brackets, like: [MOOD: Intense] or [MOOD: Guarded], immediately followed by your narrative.");
  }
  lines.push("");

  // Voice performance direction
  const voiceEnabled = !!(
    profile.voiceArchetype?.trim() ||
    profile.voiceStyle?.trim() ||
    profile.voicePacing?.trim() ||
    profile.voiceAccent?.trim() ||
    profile.voiceName?.trim()
  );
  if (voiceEnabled) {
    const hasExpressionCues = lines.some((l) => l.includes('[whispers]') && l.includes('[laughs]'));
    if (!hasExpressionCues) {
      lines.push("[VOICE PERFORMANCE DIRECTION]");
      lines.push("Dialogue in this story will be synthesized aloud by an AI voice engine.");
      if (profile.voiceArchetype?.trim()) {
        lines.push(`Voice Archetype: ${profile.voiceArchetype.trim()}`);
      }
      if (profile.voiceStyle?.trim()) {
        lines.push(`Vocal Style: ${profile.voiceStyle.trim()}`);
      }
      if (profile.voicePacing?.trim()) {
        lines.push(`Pacing: ${profile.voicePacing.trim()}`);
      }
      if (profile.voiceAccent?.trim()) {
        lines.push(`Accent: ${profile.voiceAccent.trim()}`);
      }
      lines.push("To enhance vocal realism, incorporate appropriate inline expression cues within dialogue:");
      lines.push("- Available cues: [whispers], [shouting], [laughs], [sighs], [gasps], [trembling], [panicked], [mischievously], [excitedly], [bored], [crying], [tired], [nervously], [angrily], [sadly], [warmly], [mockingly]");
      lines.push("- Example: \"I told you [whispers] never to open that door.\"");
      lines.push("- Use cues judiciously to accentuate key dramatic beats. Do NOT over-tag every sentence.");
    }
  }

  return lines.join("\n");
}

export function buildSystemInstruction(
  profile: CharacterProfile,
  codexEntries: CodexEntry[],
  currentSummary: string,
  customInstructions?: string,
  scenarioInstructions?: string,
  sessionUserPersona?: string,
  pinnedMessages?: any[]
): string {
  // Sanitize user inputs
  profile = {
    ...profile,
    personality: sanitizeUserInput(profile.personality || ''),
    backstory: sanitizeUserInput(profile.backstory || ''),
    playerProfile: profile.playerProfile
      ? {
          ...profile.playerProfile,
          personality: sanitizeUserInput(profile.playerProfile.personality || ''),
          backstory: sanitizeUserInput(profile.playerProfile.backstory || '')
        }
      : profile.playerProfile
  };

  const directive = buildScenarioDirective(profile);

  const effectiveScenarioInstructions = scenarioInstructions || profile.scenarioInstructions;
  const scenarioInstBlock = effectiveScenarioInstructions?.trim()
    ? `\n\n[SCENARIO DIRECTIVES & WORLD RULES]\n${effectiveScenarioInstructions.trim()}`
    : '';

  const sessionInstBlock = customInstructions?.trim()
    ? `\n\n[SESSION INSTRUCTIONS & AUTHORIAL PREFERENCES]\n${customInstructions.trim()}`
    : '';

  const userPersonaBlock = sessionUserPersona?.trim()
    ? `\n\n[USER PERSONA & PREFERENCES]\n${sessionUserPersona.trim()}`
    : '';

  const playerBlock = buildPlayerBlock(profile);

  const additionalChars = profile.additionalCharacters?.length 
    ? `\n\n[ADDITIONAL CHARACTERS & NPCS IN SCENE]:\n${profile.additionalCharacters.map(c => `- ${c.name} (${c.description}): ${c.personality || ''} ${c.appearance || ''}`).join('\n')}`
    : '';

  const pinnedBlock = pinnedMessages && pinnedMessages.length > 0
    ? `\n\n[PERMANENT STORY MEMORIES & PINNED EVENTS (Must Never Be Forgotten)]:\n${pinnedMessages.map((m, idx) => `[Memory ${idx + 1} (${m.role === 'user' ? 'Player' : profile.name})]: ${typeof m.text === 'string' ? m.text : JSON.stringify(m.text || m)}`).join('\n')}`
    : '';

  const summaryBlock = currentSummary?.trim()
    ? `\n\n[STORY SUMMARY & MAJOR ARC MILESTONES]:\n${currentSummary.trim()}`
    : '';

  const codexBlock = codexEntries.length > 0
    ? `\n\n[RELEVANT CODEX & DISCOVERED LORE]:\n${codexEntries.slice(-20).map(e => `- [${e.category.toUpperCase()}] ${e.title}: ${e.content}`).join('\n')}`
    : '';

  const lorePiecesBlock = profile.lorePieces?.length
    ? `\n\n[LOREBOOK CANON PIECES]:\n${profile.lorePieces.map(p => `- ${p.type.toUpperCase()}: ${p.name} — ${p.summary || p.detailedLore}`).join('\n')}`
    : '';

  return directive +
    scenarioInstBlock +
    sessionInstBlock +
    userPersonaBlock +
    playerBlock +
    additionalChars +
    pinnedBlock +
    summaryBlock +
    codexBlock +
    lorePiecesBlock;
}

export function buildHistory(messages: any[]): Array<{ role: 'user' | 'model'; parts: any[] }> {
  const filtered = messages
    .filter(m => m && Array.isArray(m.parts) && m.parts.length > 0)
    .map(m => ({
      role: (m.role === 'model' ? 'model' : 'user') as 'user' | 'model',
      parts: m.parts.map((p: any) =>
        p && typeof p.text === 'string' && p.text.trim() === '' && !p.inlineData && !p.fileData
          ? { ...p, text: '(no content)' }
          : p
      )
    }));

  if (filtered.length === 0) return [];

  // Merge consecutive same-role messages to guarantee strict user/model alternation
  const alternating: Array<{ role: 'user' | 'model'; parts: any[] }> = [];
  for (const msg of filtered) {
    if (alternating.length === 0) {
      alternating.push({ ...msg });
    } else {
      const prev = alternating[alternating.length - 1];
      if (prev.role === msg.role) {
        // Merge parts
        prev.parts = [...prev.parts, ...msg.parts];
      } else {
        alternating.push({ ...msg });
      }
    }
  }

  // If the last history turn is a model message and the conversation continues,
  // ensure it does not violate expectations by appending a synthetic continue turn if needed
  return alternating;
}

function parseJsonWithRecovery(responseText: string): any {
  let cleanedText = responseText.trim();
  
  // 1. Recover from markdown wrappers
  if (cleanedText.includes("```")) {
    const match = cleanedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match && match[1]) {
      cleanedText = match[1].trim();
    } else {
      cleanedText = cleanedText
        .replace(/```(?:json)?/gi, "")
        .replace(/```/g, "")
        .trim();
    }
  }

  // Double-check if we can parse directly
  try {
    return JSON.parse(cleanedText);
  } catch (e: any) {
    console.error("JSON Parse Error. Attempting recovery. Raw length:", responseText.length, "Cleaned length:", cleanedText.length, "Error:", e.message);
    try {
      let fixedText = cleanedText;

      // Handle trailing comma before any modifications
      if (fixedText.endsWith(',')) {
        fixedText = fixedText.slice(0, -1).trim();
      }

      // Re-scan stack of open brackets/braces from left to right, ignoring characters inside strings
      const stack: ("brace" | "bracket")[] = [];
      let inString = false;
      let escaped = false;
      for (let i = 0; i < fixedText.length; i++) {
        const char = fixedText[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (char === '{') {
            stack.push("brace");
          } else if (char === '[') {
            stack.push("bracket");
          } else if (char === '}') {
            if (stack[stack.length - 1] === "brace") {
              stack.pop();
            }
          } else if (char === ']') {
            if (stack[stack.length - 1] === "bracket") {
              stack.pop();
            }
          }
        }
      }

      if (inString && escaped) {
        fixedText = fixedText.slice(0, -1);
      }
      if (inString) {
        fixedText += '"';
      }
      // Pop everything remaining from stack in reverse order and close it
      while (stack.length > 0) {
        const top = stack.pop();
        if (top === "brace") {
          fixedText += "}";
        } else if (top === "bracket") {
          fixedText += "]";
        }
      }

      return JSON.parse(fixedText);
    } catch (e2: any) {
      console.error("Recovery failed. Error:", e2?.message);
      throw new Error(`Failed to parse JSON. Error: ${e.message}. Recovery Error: ${e2.message}`);
    }
  }
}

function convertHistoryToOpenRouter(history: any[]) {
  // Mirror buildHistory(): preserve one entry per message so user/model
  // alternation stays aligned even when a turn's text is empty.
  return history
    .filter(m => m && m.parts && m.parts.length > 0)
    .map(m => ({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: (m.parts[0]?.text || '').trim() === '' ? '(no content)' : m.parts[0].text
    }));
}

async function callOpenRouter(history: any[], systemInstruction: string, userInput: string, settings: any): Promise<string> {
  if (!settings.openRouterApiKey) {
    throw new Error("OpenRouter API key is missing. Please configure it in Settings.");
  }

  const apiKey = settings.openRouterApiKey.trim();
  const referer = "https://personaforge.app";
  const controller = new AbortController();

  const messages = [
    { role: "system", content: systemInstruction },
    ...convertHistoryToOpenRouter(history),
    { role: "user", content: userInput }
  ].filter(m => m.content && m.content.trim());

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": referer,
        "X-Title": "PersonaForge"
      },
      body: JSON.stringify({
        model: settings.openRouterModel || "meta-llama/llama-3-8b-instruct:free",
        messages: messages,
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData = {};
      try {
        errorData = JSON.parse(errorText);
      } catch {
        // Ignore parse error if it's an HTML page
        console.error("OpenRouter returned non-JSON error:", errorText.substring(0,200));
      }
      const msg = (errorData as any).error?.message || response.statusText || 'Unknown OpenRouter Error';
      if (response.status === 401) {
        throw new Error(`OpenRouter Unauthorized (401): ${msg}. Please check if your API key is valid and if you have credits for paid models.`);
      }
      throw new Error(`OpenRouter Error: ${response.status} ${msg}`);
    }

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      console.error("OpenRouter returned invalid JSON. Raw response:", rawText.substring(0,200));
      throw new Error(`OpenRouter returned an invalid response (not JSON). ` + rawText.substring(0, 100));
    }
    return data.choices?.[0]?.message?.content || "";
  } finally {
    controller.abort();
  }
}

async function* generateOpenRouterStream(history: any[], systemInstruction: string, userInput: string, settings: any) {
  if (!settings.openRouterApiKey) {
    throw new Error("OpenRouter API key is missing. Please configure it in Settings.");
  }

  const apiKey = settings.openRouterApiKey.trim();
  const referer = "https://personaforge.app";
  const controller = new AbortController();

  const messages = [
    { role: "system", content: systemInstruction },
    ...convertHistoryToOpenRouter(history),
    { role: "user", content: userInput }
  ].filter(m => m.content && m.content.trim());

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": referer,
        "X-Title": "PersonaForge"
      },
      body: JSON.stringify({
        model: settings.openRouterModel || "meta-llama/llama-3-8b-instruct:free",
        messages: messages,
        stream: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData = {};
      try {
        errorData = JSON.parse(errorText);
      } catch {
        console.error("OpenRouter Stream returned non-JSON error:", errorText.substring(0,200));
      }
      const msg = (errorData as any).error?.message || response.statusText || 'Unknown OpenRouter Error';
      if (response.status === 401) {
        throw new Error(`OpenRouter Unauthorized (401): ${msg}. Please check if your API key is valid and if you have credits for paid models.`);
      }
      throw new Error(`OpenRouter Error: ${response.status} ${msg}`);
    }

    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch (e) {
            // Ignore parse errors for incomplete chunks
          }
        }
      }
    }
  } finally {
    // Aborting a completed request is a no-op; abandoning one mid-stream
    // closes the connection instead of leaking it.
    controller.abort();
  }
}

export async function fetchOpenRouterModels(): Promise<any[]> {
  const controller = new AbortController();
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      signal: controller.signal,
      headers: {
        "HTTP-Referer": window.location.origin,
        "X-Title": "PersonaForge"
      }
    });
    if (!response.ok) throw new Error("Failed to fetch OpenRouter models");
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error("Error fetching OpenRouter models:", error);
    return [];
  } finally {
    controller.abort();
  }
}

export async function validateOpenRouterKey(apiKey: string): Promise<boolean> {
  if (!apiKey) return false;
  const controller = new AbortController();
  try {
    const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey.trim()}`,
      }
    });
    return response.ok;
  } catch (error) {
    console.error("OpenRouter Key Validation Error:", error);
    return false;
  } finally {
    controller.abort();
  }
}

async function generateStructuredData(prompt: string, systemPrompt: string, schema?: any): Promise<any> {
  const settings = getSettings();
  
  if (settings.activeTextProvider === 'OpenRouter') {
    const responseText = await callOpenRouter([], systemPrompt, prompt, settings);
    return parseJsonWithRecovery(responseText);
  }

  const ai = getGenAI();
  let response;
  try {
    response = await withRetry(() => ai.models.generateContent({
      model: settings.activeModel,
      contents: prompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        ...(schema ? { responseSchema: schema } : {})
      }
    }));
  } catch (err: any) {
    const isFallbackableError = 
      err?.message?.includes('Permission Denied') || 
      err?.status === 403 || 
      err?.code === 403 ||
      err?.status === 429 ||
      err?.code === 429 ||
      String(err).includes('PERMISSION_DENIED') ||
      String(err).includes('RESOURCE_EXHAUSTED') ||
      String(err).includes('429') ||
      String(err).includes('403');

    const fallbackModel = getQuickFallbackModel(settings.activeModel);
    if (isFallbackableError && settings.activeModel !== fallbackModel) {
      console.warn(`Structured Data: Fallback to ${fallbackModel} due to error with ${settings.activeModel}:`, err.message);
      response = await withRetry(() => ai.models.generateContent({
        model: fallbackModel,
        contents: prompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          ...(schema ? { responseSchema: schema } : {})
        }
      }));
    } else {
      throw err;
    }
  }

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  return parseJsonWithRecovery(text);
}

export async function getSmartSuggestions(field: string, profile: Partial<CharacterProfile>): Promise<string[]> {
  const prompt = `Based on the current narrative setting:
Mode: ${profile.mode}
Main Idea/Context: ${profile.backstory || 'General'}
Current Name: ${profile.name || 'Unknown'}

Provide 5 short, creative suggestions (keywords or short phrases) for the field: "${field}".
Return ONLY a JSON array of strings.`;

  try {
    const result = await generateStructuredData(
      prompt, 
      "You are a narrative assistant. Return ONLY a JSON array of 5 creative string suggestions.",
      {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    );
    if (Array.isArray(result)) return result.map(s => String(s));
    return [];
  } catch (error) {
    console.error("Smart Suggestions Error:", error);
    return [];
  }
}

export async function generateAdditionalCharacter(idea: string, mode: AppMode | string): Promise<{ name: string; description: string; personality: string; appearance: string }> {
  const prompt = `Generate a detailed NPC or additional character based on this idea: "${idea}" for a ${mode} setting.`;
  const systemPrompt = "You are a creative character creation assistant. Return ONLY a valid JSON object with: name, description, personality, appearance. IMPORTANT: For description, personality, and appearance, provide rich, detailed, multi-sentence paragraphs (at least 3-4 sentences). Do not use single-word or generic answers.";
  const schema = {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "A creative and fitting name." },
      description: { type: Type.STRING, description: "Detailed, multi-sentence paragraph describing the character." },
      personality: { type: Type.STRING, description: "Detailed, multi-sentence paragraph describing personality." },
      appearance: { type: Type.STRING, description: "Detailed, multi-sentence paragraph detailing physical appearance." },
    },
    required: ["name", "description", "personality", "appearance"]
  };

  return await generateStructuredData(prompt, systemPrompt, schema);
}

export async function generateCharacterProfile(idea: string, mode: AppMode): Promise<CharacterProfile> {
  console.log("generateCharacterProfile: Calling Gemini API...");
  const settings = getSettings();
  
  const modeGuidance = mode === AppMode.GAME
    ? `This is a GAME (tabletop RPG) mode. 
       - "name" is the Campaign Name.
       - "personality" is the Dungeon Master's style (e.g., "Merciless but fair", "Focuses on high-fantasy wonder").
       - "backstory" is the campaign's lore and origin.
       - "appearance" is a vivid description of the starting world.
       - "clothing" is the Setting Type (e.g., "Grimy Dungeon", "Bustling Tavern").
       - "accessories" are Key Elements/Props (e.g., "Ancient maps, glowing crystals").
       - "hairStyle" is the Atmosphere (e.g., "Dark fantasy", "High magic").
       - "hairColor" is the Color Theme (e.g., "Crimson and gold").
       - "eyeColor" is the Art Style (e.g., "Oil painting", "Sketch").
       - Populate gameSystem, questObjective, dungeonMasterStyle, rulesComplexity, difficultyLevel, partyComposition, startingEquipment, and currentCampaignArc with rich, specific values. 
       - The DM's "personality" is their DMing style.`
    : mode === AppMode.SCENARIO
    ? `This is a SCENARIO (interactive story) mode. 
       - "name" is the Scenario Title.
       - "personality" is the world's narrative voice (e.g., "Noir detective style", "Epic poetic").
       - "backstory" is the world's history.
       - "appearance" is a visual description of the setting.
       - "clothing" is the Environment Type (e.g., "Cyberpunk City", "Fantasy Forest").
       - "accessories" are Lighting/Weather (e.g., "Neon glow", "Moonlit").
       - "hairStyle" is the Primary Color Palette (e.g., "Cool blues").
       - "hairColor" is the Secondary Color Palette (e.g., "Gritty browns").
       - "eyeColor" is the Key Landmark (e.g., "Giant glowing tree").
       - Populate worldAtmosphere, keyLocations, scenarioStakes, scenarioConflict, timePeriod, factions, magicOrTechnologyLevel, and incitingIncident with vivid, specific details. 
       - The narrator's "personality" is the world's narrative voice.`
    : mode === AppMode.NARRATIVE
    ? `This is a NOVEL / WRITING GENERATOR mode.
       - "name" is the Novel or Story Title.
       - "personality" is the literary narrator voice (e.g., "Atmospheric prose stylist", "Cinematic third-person narrator").
       - "backstory" is the novel's core premise and narrative world.
       - "appearance" is the visual scene description and aesthetic.
       - "clothing" is the Literary Setting & Genre (e.g., "Gothic Victorian", "Hard Sci-Fi").
       - "accessories" are Key Motifs and Themes.
       - "hairStyle" is the Prose Rhythm & Mood.
       - "hairColor" is the Dominant Visual Motif.
       - "eyeColor" is the Core Metaphor.
       - Populate worldAtmosphere, keyLocations, scenarioStakes, scenarioConflict, timePeriod, factions, and incitingIncident with rich narrative depth. Do NOT include tabletop RPG rules, stats, or inventory mechanics.`
    : `This is a ROLEPLAY mode. Create a compelling single character for deep one-on-one interaction. 
       - Populate characterFlaws, secretMotive, speechPattern, likesAndDislikes, coreBeliefs, and quirks with specific, interesting values.
       - "name", "personality", "backstory", "appearance", "clothing", "accessories", "hairStyle", "hairColor", "eyeColor" are all for the character.
       - Build out the playerProfile (the USER's character) to the SAME depth as the main character: personality, backstory, appearance, characterFlaws, secretMotive, speechPattern, likesAndDislikes, coreBeliefs, quirks, traits (friendliness/assertiveness/empathy 0-100), and relationship to the main character. The player's character must be a fully-realized sheet, never thin.
       - Generate additionalCharacters for every person the idea mentions or implies (see instructions).`;

  const contents = `Generate a detailed character profile based on this idea: "${idea}"

${modeGuidance}

Instructions:
1. You MUST fill in EVERY field in the schema. Do not leave any field empty or as a placeholder.
2. Ensure the content is HIGHLY creative, deeply immersive, and fits the ${mode} mode perfectly.
3. For all descriptive text fields (e.g., backstory, appearance, personality, worldAtmosphere, keyLocations, etc.), you MUST write detailed, multi-sentence paragraphs (at least 3-5 sentences). DO NOT use single-word or generic answers. Be highly descriptive, rich in narrative detail, and creative.
4. Also generate a detailed player character profile (playerProfile) that would be a compelling fit for this story/session. Fill in all fields for the player character too with rich descriptions.

CRITICAL INSTRUCTIONS FOR FIELDS:
- worldAtmosphere: Describe the WORLD'S mood, environment, and general feel (e.g., "A dark, rainy cyberpunk city with neon lights and constant surveillance"). Do NOT describe a person.
- keyLocations: List 3-4 specific, interesting locations in the WORLD.
- gameSystem: Describe the rules or mechanics if in GAME mode (e.g., "D&D 5e", "Powered by the Apocalypse").
- playerProfile: This is the profile for the USER'S character. Ensure it is distinct from the main character.
- additionalCharacters: Generate a character for EVERY person the idea mentions or implies the player will meet (allies, rivals, companions, passersby, faction leaders, shopkeepers, monsters that talk, etc.). If the idea names specific people, each named person gets an entry. If it implies a crowd/group, generate 2-4 members of it. Minimum 0 if the idea is a solitary encounter, maximum 6. Each entry needs a name, a one-line description, a personality, and an appearance.

${getToneDirective()}${getMatureContentDirective()}`;

  let responseText = "{}";

  if (settings.activeTextProvider === 'OpenRouter') {
    const systemPrompt = `You are a creative character and world creation assistant for an interactive fiction app. Return ONLY a valid JSON object with no markdown, no backticks, no explanation. IMPORTANT: For all descriptive fields, provide rich, detailed, multi-sentence paragraphs. Do not use generic single-word answers. 
    
    CRITICAL INSTRUCTIONS FOR FIELDS:
    - worldAtmosphere: Describe the WORLD'S mood, environment, and general feel (e.g., "A dark, rainy cyberpunk city with neon lights and constant surveillance"). Do NOT describe a person.
    - keyLocations: List 3-4 specific, interesting locations in the WORLD.
    - gameSystem: Describe the rules or mechanics if in GAME mode (e.g., "D&D 5e", "Powered by the Apocalypse").
    - playerProfile: This is the profile for the USER'S character. Build it to the SAME depth as the main character: personality, backstory, appearance, characterFlaws, secretMotive, speechPattern, likesAndDislikes, coreBeliefs, quirks, traits (friendliness/assertiveness/empathy 0-100), and relationship.
    - additionalCharacters: An array of characters for EVERY person the idea mentions or implies the player will meet (allies, rivals, companions, passersby, leaders, shopkeepers, monsters that talk, etc.). Each entry: name, description, personality, appearance. 0-6 entries based on what the idea implies.
    
    Include all of these fields: name, personality, backstory, appearance, clothing, accessories, hairStyle, hairColor, eyeColor, storyTone, relationship, characterFlaws, secretMotive, speechPattern, likesAndDislikes, coreBeliefs, quirks, worldAtmosphere, keyLocations, scenarioStakes, scenarioConflict, timePeriod, factions, magicOrTechnologyLevel, incitingIncident, gameSystem, questObjective, dungeonMasterStyle, rulesComplexity, difficultyLevel, partyComposition, startingEquipment, currentCampaignArc, currentMood, a playerProfile object with name, description, personality, backstory, appearance, clothing, accessories, hairStyle, hairColor, eyeColor, relationship, characterFlaws, secretMotive, speechPattern, likesAndDislikes, coreBeliefs, quirks, traits (friendliness/assertiveness/empathy), and an additionalCharacters array with name, description, personality, appearance.`;
    responseText = await callOpenRouter([], systemPrompt, contents, settings);
  } else {
    const ai = getGenAI();
    const schemaConfig = {
      maxOutputTokens: 12288,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "A creative and fitting name." },
          personality: { type: Type.STRING, description: "Detailed, multi-sentence paragraph describing personality." },
          backstory: { type: Type.STRING, description: "Detailed, rich multi-sentence paragraph detailing backstory." },
          appearance: { type: Type.STRING, description: "Detailed, multi-sentence paragraph detailing physical appearance." },
          clothing: { type: Type.STRING, description: "Detailed description of clothing/environment." },
          accessories: { type: Type.STRING, description: "Detailed description of accessories/weather/lighting." },
          hairStyle: { type: Type.STRING, description: "Detailed description of hair style/atmosphere." },
          hairColor: { type: Type.STRING, description: "Detailed description of color palette." },
          eyeColor: { type: Type.STRING, description: "Detailed description of eyes or landmarks." },
          storyTone: { type: Type.STRING, description: "Detailed description of the story tone." },
          relationship: { type: Type.STRING, description: "Detailed description of relationships." },
          characterFlaws: { type: Type.STRING, description: "Detailed description of character flaws." },
          secretMotive: { type: Type.STRING, description: "Detailed description of secret motives." },
          speechPattern: { type: Type.STRING, description: "Detailed description of speech patterns." },
          likesAndDislikes: { type: Type.STRING, description: "Detailed description of likes and dislikes." },
          coreBeliefs: { type: Type.STRING, description: "Detailed description of core beliefs." },
          quirks: { type: Type.STRING, description: "Detailed description of quirks." },
          worldAtmosphere: { type: Type.STRING, description: "Detailed, multi-sentence paragraph describing world atmosphere." },
          keyLocations: { type: Type.STRING, description: "Detailed, multi-sentence paragraph describing key locations." },
          scenarioStakes: { type: Type.STRING, description: "Detailed description of stakes." },
          scenarioConflict: { type: Type.STRING, description: "Detailed description of conflict." },
          timePeriod: { type: Type.STRING, description: "Detailed description of time period." },
          factions: { type: Type.STRING, description: "Detailed description of factions." },
          magicOrTechnologyLevel: { type: Type.STRING, description: "Detailed description of magic/tech level." },
          incitingIncident: { type: Type.STRING, description: "Detailed description of inciting incident." },
          gameSystem: { type: Type.STRING, description: "Detailed description of game system." },
          questObjective: { type: Type.STRING, description: "Detailed description of quest objective." },
          dungeonMasterStyle: { type: Type.STRING, description: "Detailed description of DM style." },
          rulesComplexity: { type: Type.STRING, description: "Detailed description of rules complexity." },
          difficultyLevel: { type: Type.STRING, description: "Detailed description of difficulty." },
          partyComposition: { type: Type.STRING, description: "Detailed description of party composition." },
          startingEquipment: { type: Type.STRING, description: "Detailed description of starting equipment." },
          currentCampaignArc: { type: Type.STRING, description: "Detailed description of current campaign arc." },
          currentMood: { type: Type.STRING, description: "Detailed description of mood." },
          playerProfile: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING, description: "Detailed, multi-sentence paragraph." },
              personality: { type: Type.STRING, description: "Detailed, multi-sentence paragraph." },
              backstory: { type: Type.STRING, description: "Detailed, multi-sentence paragraph." },
              appearance: { type: Type.STRING, description: "Detailed, multi-sentence paragraph." },
              clothing: { type: Type.STRING },
              accessories: { type: Type.STRING },
              hairStyle: { type: Type.STRING },
              hairColor: { type: Type.STRING },
              eyeColor: { type: Type.STRING },
              relationship: { type: Type.STRING, description: "The player character's relationship to the main character / world." },
              characterFlaws: { type: Type.STRING, description: "Detailed description of the player character's flaws." },
              secretMotive: { type: Type.STRING, description: "Detailed description of the player character's secret motive." },
              speechPattern: { type: Type.STRING, description: "Detailed description of how the player character talks." },
              likesAndDislikes: { type: Type.STRING, description: "Detailed description of the player character's likes and dislikes." },
              coreBeliefs: { type: Type.STRING, description: "Detailed description of the player character's core beliefs." },
              quirks: { type: Type.STRING, description: "Detailed description of the player character's quirks." },
              traits: {
                type: Type.OBJECT,
                properties: {
                  friendliness: { type: Type.NUMBER, description: "0-100." },
                  assertiveness: { type: Type.NUMBER, description: "0-100." },
                  empathy: { type: Type.NUMBER, description: "0-100." }
                },
                required: ["friendliness", "assertiveness", "empathy"]
              }
            },
            required: ["name", "description", "personality", "backstory", "appearance", "clothing", "accessories", "hairStyle", "hairColor", "eyeColor", "relationship", "characterFlaws", "secretMotive", "speechPattern", "likesAndDislikes", "coreBeliefs", "quirks", "traits"]
          },
          additionalCharacters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING, description: "One-line description of who they are." },
                personality: { type: Type.STRING, description: "Detailed description of their personality." },
                appearance: { type: Type.STRING, description: "Detailed description of their appearance." }
              },
              required: ["name", "description", "personality", "appearance"]
            }
          }
        },
        required: [
          "name", "personality", "backstory", "appearance", "clothing", "accessories", "hairStyle", "hairColor", "eyeColor",
          "storyTone", "relationship", "characterFlaws", "secretMotive", "speechPattern", "likesAndDislikes", "coreBeliefs", "quirks",
          "worldAtmosphere", "keyLocations", "scenarioStakes", "scenarioConflict", "timePeriod", "factions", "magicOrTechnologyLevel", "incitingIncident",
          "gameSystem", "questObjective", "dungeonMasterStyle", "rulesComplexity", "difficultyLevel", "partyComposition", "startingEquipment", "currentCampaignArc",
          "currentMood", "playerProfile", "additionalCharacters"
        ]
      }
    };

    let response;
    try {
      response = await withRetry(() => ai.models.generateContent({
        model: settings.activeModel,
        contents,
        config: schemaConfig
      }));
    } catch (err: any) {
      const isFallbackableError = 
      err?.message?.includes('Permission Denied') || 
      err?.status === 403 || 
      err?.code === 403 ||
      err?.status === 429 ||
      err?.code === 429 ||
      String(err).includes('PERMISSION_DENIED') ||
      String(err).includes('RESOURCE_EXHAUSTED') ||
      String(err).includes('429') ||
      String(err).includes('403');

      const fallbackModel = getQuickFallbackModel(settings.activeModel);
      if (isFallbackableError && settings.activeModel !== fallbackModel) {
        console.warn(`Profile Generation: Fallback to ${fallbackModel} due to error with ${settings.activeModel}:`, err.message);
        response = await withRetry(() => ai.models.generateContent({
          model: fallbackModel,
          contents,
          config: schemaConfig
        }));
      } else {
        throw err;
      }
    }
    console.log("generateCharacterProfile: API call successful.");
    responseText = response.text || "{}";
  }

  const data = parseJsonWithRecovery(responseText);
  
  const defaultTraits = mode === AppMode.GAME 
    ? { strictness: 50, generosity: 50, lethality: 50 }
    : mode === AppMode.SCENARIO
    ? { danger: 50, mystery: 50, supernatural: 50 }
    : { friendliness: 50, assertiveness: 50, empathy: 50 };
  
  return {
    mode,
    name: data.name || "Unknown",
    personality: data.personality || "Mysterious and deep.",
    backstory: data.backstory || "A tale lost to time.",
    appearance: data.appearance || "Striking and memorable.",
    clothing: data.clothing || "Appropriate for the setting.",
    accessories: data.accessories || "None.",
    hairStyle: data.hairStyle || "Natural.",
    hairColor: data.hairColor || "Natural.",
    eyeColor: data.eyeColor || "Natural.",
    voiceName: "Kore",
    voiceSettings: { pitch: "Normal", speed: "Normal", accent: "None" },
    traits: defaultTraits,
    storyTone: data.storyTone || "Dramatic",
    relationship: data.relationship || "Strangers",
    playerProfile: {
      ...(data.playerProfile || { 
        name: "The Protagonist", 
        description: "A mysterious traveler.",
        personality: "Determined.",
        backstory: "Seeking answers.",
        appearance: "Average build.",
        clothing: "Traveler's gear.",
        accessories: "None.",
        hairStyle: "Short.",
        hairColor: "Brown.",
        eyeColor: "Brown."
      }),
      // The model fills the new full-sheet fields; fall back to defaults if it
      // skipped them so the player character is never a bare shell.
      relationship: data.playerProfile?.relationship || "Strangers",
      characterFlaws: data.playerProfile?.characterFlaws || "None.",
      secretMotive: data.playerProfile?.secretMotive || "None.",
      speechPattern: data.playerProfile?.speechPattern || "Natural.",
      likesAndDislikes: data.playerProfile?.likesAndDislikes || "None.",
      coreBeliefs: data.playerProfile?.coreBeliefs || "None.",
      quirks: data.playerProfile?.quirks || "None.",
      traits: data.playerProfile?.traits || { friendliness: 50, assertiveness: 50, empathy: 50 }
    },
    additionalCharacters: Array.isArray(data.additionalCharacters)
      ? data.additionalCharacters.map((c: any, i: number) => ({
          id: c.id || `npc-${Date.now()}-${i}`,
          name: c.name || `Character ${i + 1}`,
          description: c.description || "A person in the world.",
          personality: c.personality || "Friendly.",
          appearance: c.appearance || "Unremarkable.",
        }))
      : [],
    inventory: [],
    worldAtmosphere: data.worldAtmosphere || "Atmospheric.",
    keyLocations: data.keyLocations || "Vast lands.",
    characterFlaws: data.characterFlaws || "None.",
    secretMotive: data.secretMotive || "None.",
    speechPattern: data.speechPattern || "Natural.",
    likesAndDislikes: data.likesAndDislikes || "None.",
    coreBeliefs: data.coreBeliefs || "None.",
    quirks: data.quirks || "None.",
    gameSystem: data.gameSystem || "Narrative.",
    questObjective: data.questObjective || "Explore.",
    scenarioStakes: data.scenarioStakes || "Survival.",
    scenarioConflict: data.scenarioConflict || "Man vs Nature.",
    timePeriod: data.timePeriod || "Unknown.",
    factions: data.factions || "None.",
    magicOrTechnologyLevel: data.magicOrTechnologyLevel || "None.",
    incitingIncident: data.incitingIncident || "A chance encounter.",
    dungeonMasterStyle: data.dungeonMasterStyle || "Narrative.",
    rulesComplexity: data.rulesComplexity || "Simple.",
    difficultyLevel: data.difficultyLevel || "Balanced.",
    partyComposition: data.partyComposition || "Solo.",
    startingEquipment: data.startingEquipment || "Standard gear.",
    currentCampaignArc: data.currentCampaignArc || "The Beginning.",
    currentMood: data.currentMood || "Neutral"
  };
}

function hashSeed(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getPollinationsUrl(prompt: string, width = 512, height = 512): string {
  const cleanPrompt = prompt
    .replace(/[\n\r]+/g, ' ')
    .replace(/[^\w\s,.-]/g, '')
    .trim()
    .slice(0, 300);
  const encoded = encodeURIComponent(cleanPrompt || 'cinematic portrait character illustration');
  return `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&nologo=true`;
}

export async function generateAvatar(profile: CharacterProfile): Promise<string> {
  const prompt = `portrait of ${profile.name || 'character'}, ${profile.appearance || ''}, ${profile.clothing || ''}, ${profile.hairStyle || ''} ${profile.hairColor || ''} hair, ${profile.eyeColor || ''} eyes, ${profile.worldAtmosphere || ''}, cinematic lighting, 8k portrait`;

  try {
    return getPollinationsUrl(prompt, 512, 512);
  } catch (error) {
    console.error("generateAvatar Error:", error);
    const seed = encodeURIComponent(profile.name || 'personaforge');
    return `https://api.dicebear.com/9.x/adventurer/svg?seed=${seed}`;
  }
}

export async function generateSceneBackground(profile: CharacterProfile): Promise<string> {
  const atmosphere = profile.worldAtmosphere || profile.appearance || 'ambient atmosphere';
  const seed = hashSeed(atmosphere) || 1;
  return `https://picsum.photos/seed/${seed}/1080/1920`;
}

export async function generateCodexImage(entry: CodexEntry, profile: CharacterProfile): Promise<string> {
  const prompt = `illustration of ${entry.title}, ${entry.category}, ${entry.content.slice(0, 150)}, ${profile.worldAtmosphere || ''}, high detail fantasy concept art`;
  return getPollinationsUrl(prompt, 512, 512);
}

export async function generateItemImage(item: InventoryItem, profile: CharacterProfile): Promise<string> {
  const prompt = `game item icon of ${item.name}, ${item.type}, ${item.rarity || 'rare'}, ${item.description.slice(0, 120)}, ${profile.worldAtmosphere || ''}, dark background, detailed item art`;
  return getPollinationsUrl(prompt, 512, 512);
}

export async function extractInventoryUpdates(history: any[], currentInventory: InventoryItem[]): Promise<{
  added: Partial<InventoryItem>[];
  removed: string[];
  updated: { id: string; quantity: number }[];
}> {
  const ai = getGenAI();
  const response = await withRetry(() => ai.models.generateContent({
    model: getSettings().activeModel,
    contents: `Analyze the following roleplay history and identify any changes to the player's inventory.
Current Inventory: ${JSON.stringify(currentInventory)}
Recent History: ${JSON.stringify(history.slice(-10))}

Identify:
1. New items gained (name, description, type, quantity).
2. Items lost or consumed (name or id).
3. Changes in quantity of existing items.

Return a JSON object with:
- "added": Array of new items.
- "removed": Array of item names or IDs that were lost.
- "updated": Array of { id, quantity } for existing items.

Only include items that were explicitly mentioned as gained, lost, or used in the recent history.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          added: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING },
                type: { type: Type.STRING, enum: ['Weapon', 'Armor', 'Consumable', 'Quest', 'Misc'] },
                quantity: { type: Type.INTEGER },
                rarity: { type: Type.STRING, enum: ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'] },
                value: { type: Type.STRING }
              },
              required: ["name", "description", "type", "quantity"]
            }
          },
          removed: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          updated: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                quantity: { type: Type.INTEGER }
              }
            }
          }
        }
      }
    }
  }));

  try {
    return parseJsonWithRecovery(response.text || '{"added":[], "removed":[], "updated":[]}');
  } catch (e) {
    return { added: [], removed: [], updated: [] };
  }
}

export async function refineText(text: string, context?: string, guidance?: string): Promise<string> {
  const ai = getGenAI();
  const contextText = context ? `\nContext: ${context}` : '';
  const guidanceText = guidance ? `\nGuidance: ${guidance}` : '';
  const response = await withRetry(() => ai.models.generateContent({
    model: getSettings().activeModel,
    contents: `Refine the following text.${contextText}${guidanceText}\nText: "${text}"\nReturn ONLY the refined text.`
  }));
  return response.text?.trim() || text;
}

export async function refineField(field: string, profile: CharacterProfile, guidance?: string): Promise<string> {
  const ai = getGenAI();
  const guidanceText = guidance ? `\nGuidance: ${guidance}` : '';
  const response = await withRetry(() => ai.models.generateContent({
    model: getSettings().activeModel,
    contents: `Refine the ${field} for this character: ${JSON.stringify(profile)}.${guidanceText}
Return ONLY the refined text for the ${field}. 
IMPORTANT: Do NOT include the field name, label, or any prefix like "${field}:" in your response. Just the content.`
  }));
  return response.text?.trim() || "";
}

export async function refinePlayerProfile(field: string, profile: CharacterProfile, guidance?: string): Promise<string> {
  const ai = getGenAI();
  const guidanceText = guidance ? `\nGuidance: ${guidance}` : '';
  const response = await withRetry(() => ai.models.generateContent({
    model: getSettings().activeModel,
    contents: `Refine the player's ${field} for this roleplay scenario.
Player Profile: ${JSON.stringify(profile.playerProfile || {})}
Character they are interacting with: ${profile.name}
World Atmosphere: ${profile.worldAtmosphere || 'Not specified'}
${guidanceText}

Return ONLY the refined ${field} text.
IMPORTANT: Do NOT include the field name, label, or any prefix like "${field}:" in your response. Just the content.`
  }));
  return response.text?.trim() || "";
}

export async function refineTraits(profile: CharacterProfile, guidance?: string): Promise<any> {
  const ai = getGenAI();
  const response = await withRetry(() => ai.models.generateContent({
    model: getSettings().activeModel,
    contents: `Suggest traits (0-100) for this character: ${JSON.stringify(profile)}. ${guidance ? `Guidance: ${guidance}` : ''}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          friendliness: { type: Type.INTEGER },
          assertiveness: { type: Type.INTEGER },
          empathy: { type: Type.INTEGER },
          danger: { type: Type.INTEGER },
          mystery: { type: Type.INTEGER },
          supernatural: { type: Type.INTEGER },
          strictness: { type: Type.INTEGER },
          generosity: { type: Type.INTEGER },
          lethality: { type: Type.INTEGER }
        }
      }
    }
  }));
  return parseJsonWithRecovery(response.text || "{}");
}

export async function refineProfile(profile: CharacterProfile): Promise<CharacterProfile> {
  const ai = getGenAI();
  
  const modeGuidance = profile.mode === AppMode.GAME
    ? `This is a GAME (tabletop RPG) mode. 
       - "name" is the Campaign Name.
       - "personality" is the Dungeon Master's style.
       - "backstory" is the campaign's lore.
       - "appearance" is the world description.
       - "clothing" is the Setting Type.
       - "accessories" are Key Elements/Props.
       - "hairStyle" is the Atmosphere.
       - "hairColor" is the Color Theme.
       - "eyeColor" is the Art Style.
       - You MUST populate gameSystem, questObjective, dungeonMasterStyle, rulesComplexity, difficultyLevel, partyComposition, startingEquipment, and currentCampaignArc with rich, specific values.`
    : profile.mode === AppMode.SCENARIO
    ? `This is a SCENARIO (interactive story) mode. 
       - "name" is the Scenario Title.
       - "personality" is the world's narrative voice.
       - "backstory" is the world's history.
       - "appearance" is the visual description of the setting.
       - "clothing" is the Environment Type.
       - "accessories" are Lighting/Weather.
       - "hairStyle" is the Primary Color Palette.
       - "hairColor" is the Secondary Color Palette.
       - "eyeColor" is the Key Landmark.
       - You MUST populate worldAtmosphere, keyLocations, scenarioStakes, scenarioConflict, timePeriod, factions, magicOrTechnologyLevel, and incitingIncident with vivid, specific details.`
    : profile.mode === AppMode.NARRATIVE
    ? `This is a NOVEL / WRITING GENERATOR mode.
       - "name" is the Novel Title.
       - "personality" is the literary narrator voice.
       - "backstory" is the novel's core premise and world history.
       - "appearance" is the visual scene description and aesthetic.
       - "clothing" is the Literary Setting & Genre.
       - "accessories" are Key Motifs and Themes.
       - "hairStyle" is the Prose Rhythm & Mood.
       - "hairColor" is the Dominant Visual Motif.
       - "eyeColor" is the Core Metaphor.
       - You MUST populate worldAtmosphere, keyLocations, scenarioStakes, scenarioConflict, timePeriod, factions, and incitingIncident with rich narrative depth. Do NOT populate tabletop RPG mechanics.`
    : `This is a ROLEPLAY mode. 
       - You MUST populate characterFlaws, secretMotive, speechPattern, likesAndDislikes, coreBeliefs, and quirks with specific, interesting values.`;

  const contents = `You are an expert creative writer and game designer. Your task is to refine, expand, and complete this ${profile.mode} profile. 

Instructions:
1. Refine and expand ALL fields, even if they are already filled, to ensure they are compelling, consistent, and well-developed. 
2. Fill in EVERY missing or sparse field with contextually relevant and creative content. Do not leave any field empty.
3. ${modeGuidance}
4. Ensure all fields are contextually consistent with each other (e.g., personality matches backstory, world atmosphere matches factions).
5. For the "traits" section, ensure the values (0-100) accurately reflect the character's personality and role.
6. For the "playerProfile", ensure it fits naturally into the scenario or game mode. Fill in all fields for the player character too (description, personality, backstory, appearance, clothing, accessories, hairStyle, hairColor, eyeColor).
7. IMPORTANT: Do NOT include field names or labels within the values of the fields themselves.

CRITICAL INSTRUCTIONS FOR FIELDS:
- worldAtmosphere: Describe the WORLD'S mood, environment, and general feel. Do NOT describe a person.
- keyLocations: List 3-4 specific, interesting locations in the WORLD.
- gameSystem: Describe the rules or mechanics if in GAME mode.
- playerProfile: This is the profile for the USER'S character. Ensure it is distinct from the main character.

Current Profile: ${JSON.stringify(profile)}

Return the complete, updated profile as a JSON object with the exact same structure.`;

  const response = await withRetry(() => ai.models.generateContent({
    model: getSettings().activeModel,
    contents,
    config: {
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          personality: { type: Type.STRING },
          backstory: { type: Type.STRING },
          appearance: { type: Type.STRING },
          clothing: { type: Type.STRING },
          accessories: { type: Type.STRING },
          hairStyle: { type: Type.STRING },
          hairColor: { type: Type.STRING },
          eyeColor: { type: Type.STRING },
          storyTone: { type: Type.STRING },
          relationship: { type: Type.STRING },
          characterFlaws: { type: Type.STRING },
          secretMotive: { type: Type.STRING },
          speechPattern: { type: Type.STRING },
          likesAndDislikes: { type: Type.STRING },
          coreBeliefs: { type: Type.STRING },
          quirks: { type: Type.STRING },
          worldAtmosphere: { type: Type.STRING },
          keyLocations: { type: Type.STRING },
          scenarioStakes: { type: Type.STRING },
          scenarioConflict: { type: Type.STRING },
          timePeriod: { type: Type.STRING },
          factions: { type: Type.STRING },
          magicOrTechnologyLevel: { type: Type.STRING },
          incitingIncident: { type: Type.STRING },
          gameSystem: { type: Type.STRING },
          questObjective: { type: Type.STRING },
          dungeonMasterStyle: { type: Type.STRING },
          rulesComplexity: { type: Type.STRING },
          difficultyLevel: { type: Type.STRING },
          partyComposition: { type: Type.STRING },
          startingEquipment: { type: Type.STRING },
          currentCampaignArc: { type: Type.STRING },
          currentMood: { type: Type.STRING },
          playerProfile: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
              personality: { type: Type.STRING },
              backstory: { type: Type.STRING },
              appearance: { type: Type.STRING },
              clothing: { type: Type.STRING },
              accessories: { type: Type.STRING },
              hairStyle: { type: Type.STRING },
              hairColor: { type: Type.STRING },
              eyeColor: { type: Type.STRING },
            },
            required: ["name", "description", "personality", "backstory", "appearance", "clothing", "accessories", "hairStyle", "hairColor", "eyeColor"]
          }
        },
        required: [
          "name", "personality", "backstory", "appearance", "clothing", "accessories", "hairStyle", "hairColor", "eyeColor",
          "storyTone", "relationship", "characterFlaws", "secretMotive", "speechPattern", "likesAndDislikes", "coreBeliefs", "quirks",
          "worldAtmosphere", "keyLocations", "scenarioStakes", "scenarioConflict", "timePeriod", "factions", "magicOrTechnologyLevel", "incitingIncident",
          "gameSystem", "questObjective", "dungeonMasterStyle", "rulesComplexity", "difficultyLevel", "partyComposition", "startingEquipment", "currentCampaignArc",
          "currentMood", "playerProfile"
        ]
      }
    }
  }));

  try {
    const data = parseJsonWithRecovery(response.text || "{}");
    return {
      ...profile,
      ...data,
      traits: { ...profile.traits, ...(data.traits || {}) },
      voiceSettings: { ...profile.voiceSettings, ...(data.voiceSettings || {}) },
      playerProfile: { ...profile.playerProfile, ...(data.playerProfile || {}) }
    };
  } catch (e) {
    console.error("refineProfile: JSON Parse Error", e);
    return profile;
  }
}

export async function applyGlobalEdit(profile: CharacterProfile, prompt: string): Promise<CharacterProfile> {
  const systemPrompt = `You are an expert creative writer and game designer. The user wants to modify the following ${profile.mode} profile based on their request.

Instructions:
1. Analyze the user's request and determine which fields in the profile need to be updated to fulfill it.
2. Modify those specific fields while keeping the rest of the profile intact and consistent.
3. Ensure the changes fit naturally into the existing context.
4. Return the complete, updated profile as a JSON object with the exact same structure.

Return ONLY a valid JSON object matching the requested schema.`;

  const contents = `User's Request: "${prompt}"

Current Profile JSON:
${JSON.stringify(profile)}`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      personality: { type: Type.STRING },
      backstory: { type: Type.STRING },
      appearance: { type: Type.STRING },
      clothing: { type: Type.STRING },
      accessories: { type: Type.STRING },
      hairStyle: { type: Type.STRING },
      hairColor: { type: Type.STRING },
      eyeColor: { type: Type.STRING },
      storyTone: { type: Type.STRING },
      relationship: { type: Type.STRING },
      characterFlaws: { type: Type.STRING },
      secretMotive: { type: Type.STRING },
      speechPattern: { type: Type.STRING },
      likesAndDislikes: { type: Type.STRING },
      coreBeliefs: { type: Type.STRING },
      quirks: { type: Type.STRING },
      worldAtmosphere: { type: Type.STRING },
      keyLocations: { type: Type.STRING },
      scenarioStakes: { type: Type.STRING },
      scenarioConflict: { type: Type.STRING },
      timePeriod: { type: Type.STRING },
      factions: { type: Type.STRING },
      magicOrTechnologyLevel: { type: Type.STRING },
      incitingIncident: { type: Type.STRING },
      gameSystem: { type: Type.STRING },
      questObjective: { type: Type.STRING },
      dungeonMasterStyle: { type: Type.STRING },
      rulesComplexity: { type: Type.STRING },
      difficultyLevel: { type: Type.STRING },
      partyComposition: { type: Type.STRING },
      startingEquipment: { type: Type.STRING },
      currentCampaignArc: { type: Type.STRING },
      currentMood: { type: Type.STRING },
      playerProfile: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          personality: { type: Type.STRING },
          backstory: { type: Type.STRING },
          appearance: { type: Type.STRING },
          clothing: { type: Type.STRING },
          accessories: { type: Type.STRING },
          hairStyle: { type: Type.STRING },
          hairColor: { type: Type.STRING },
          eyeColor: { type: Type.STRING },
        },
        required: ["name", "description"]
      }
    },
    required: ["name", "personality", "backstory", "appearance", "storyTone", "relationship", "playerProfile"]
  };

  try {
    const data = await generateStructuredData(contents, systemPrompt, schema);
    return {
      ...profile,
      ...data,
      traits: { ...profile.traits, ...(data.traits || {}) },
      voiceSettings: { ...profile.voiceSettings, ...(data.voiceSettings || {}) },
      playerProfile: { ...profile.playerProfile, ...(data.playerProfile || {}) }
    };
  } catch (e) {
    console.error("applyGlobalEdit: Error applying global edit", e);
    throw new Error("Failed to apply edits.");
  }
}

export async function summarizeHistory(history: any[], previousSummary: string = ""): Promise<string> {
  const settings = getSettings();
  const prompt = `Review the current story summary and the following new events. Provide an updated, concise summary that captures all major plot points and character developments.

CRITICAL: Maintain clear distinction between the player's actions/words and the AI characters' actions/words. Do not blend them.

Current Summary: ${previousSummary}
New Events:
${JSON.stringify(history)}

Updated Summary:`;

  if (settings.activeTextProvider === 'OpenRouter') {
    return callOpenRouter([], "You are a professional narrative editor. Provide a concise, clear summary of story developments while maintaining character agency distinctions. Return ONLY the summary text.", prompt, settings);
  }

  const ai = getGenAI();
  let response;
  try {
    response = await withRetry(() => ai.models.generateContent({
      model: settings.activeModel,
      contents: prompt
    }));
  } catch (err: any) {
    const isFallbackableError = isFallbackable(err);

    const fallbackModel = getQuickFallbackModel(settings.activeModel);
    if (isFallbackableError && settings.activeModel !== fallbackModel) {
      console.warn(`summarizeHistory: Fallback to ${fallbackModel} due to error with ${settings.activeModel}:`, err.message);
      response = await withRetry(() => ai.models.generateContent({
        model: fallbackModel,
        contents: prompt
      }));
    } else {
      throw err;
    }
  }
  return response.text?.trim() || previousSummary;
}

export async function* generateTextReplyStream(
  history: any[], 
  profile: CharacterProfile, 
  userInput: string, 
  codexEntries: CodexEntry[] = [], 
  currentSummary: string = "", 
  customInstructions?: string,
  pinnedMessages?: any[]
) {
  const settings = getSettings();
  const systemInstruction = buildSystemInstruction(
    profile, 
    codexEntries, 
    currentSummary, 
    customInstructions, 
    profile.scenarioInstructions, 
    undefined, 
    pinnedMessages
  );

  if (settings.activeTextProvider === 'OpenRouter') {
    // Guarantee the Codex context reaches OpenRouter even if the shared
    // system-instruction builder changes: append the block when missing.
    const openRouterSystemInstruction =
      codexEntries.length > 0 && !systemInstruction.includes('WORLD CODEX')
        ? systemInstruction + buildCodexContext(codexEntries)
        : systemInstruction;
    yield* generateOpenRouterStream(history, openRouterSystemInstruction, userInput, settings);
    return;
  }

  const ai = getGenAI();
  const contents = [...buildHistory(history), { role: "user", parts: [{ text: userInput }] }];
  const config = { 
    systemInstruction,
    temperature: 0.9
  };

  let chunksEmitted = 0;
  try {
    const responseStream = await ai.models.generateContentStream({
      model: settings.activeModel,
      contents,
      config
    });
    for await (const chunk of responseStream) {
      chunksEmitted++;
      yield chunk.text || "";
    }
    return;
  } catch (err: any) {
    if (chunksEmitted > 0) {
      throw err;
    }

    const isFallbackableError = isFallbackable(err);
    const fallbackModel = (settings.activeModel === 'gemini-3.1-flash-lite' || settings.activeModel === 'gemini-2.5-flash-lite')
      ? 'gemini-2.5-flash'
      : 'gemini-3.1-flash-lite';

    if (isFallbackableError && settings.activeModel !== fallbackModel) {
      console.warn(`generateTextReplyStream: Fallback to ${fallbackModel} due to error with ${settings.activeModel}:`, err.message);
      const fallbackStream = await ai.models.generateContentStream({
        model: fallbackModel,
        contents,
        config
      });
      for await (const chunk of fallbackStream) {
        yield chunk.text || "";
      }
    } else {
      throw err;
    }
  }
}

export interface ActionSuggestion {
  text: string;
  type: 'dialogue' | 'action' | 'bold' | 'investigate';
  label: string;
}

export async function suggestMultipleActions(
  history: any[], 
  profile: CharacterProfile, 
  codexEntries: CodexEntry[] = [], 
  currentSummary: string = "", 
  guide?: string, 
  customInstructions?: string,
  pinnedMessages?: any[]
): Promise<ActionSuggestion[]> {
  const modeInstruction = profile.mode === AppMode.GAME
    ? `You are assisting a player in a tabletop RPG. Generate 3 DISTINCT, compelling next options for THEIR character:
1. DIALOGUE / INQUIRY (A conversation line or negotiation attempt)
2. TACTICAL ACTION / INVESTIGATION (A careful physical action, perception check, or spell/item use)
3. BOLD / DECISIVE MOVE (A dramatic, high-stakes, or unexpected move)`
    : profile.mode === AppMode.SCENARIO
    ? `You are assisting a player in an interactive narrative. Generate 3 DISTINCT, compelling next options for THEIR character:
1. DIALOGUE / SOCIAL (A meaningful conversation line)
2. EXPLORE / INVESTIGATE (An action exploring surroundings or examining something)
3. BOLD / DRAMATIC (A bold move advancing or escalating the plot)`
    : `You are assisting a player in character roleplay. Generate 3 DISTINCT, compelling next options for THEIR character:
1. INTIMATE / EMOTIONAL DIALOGUE (An emotional reaction or vulnerable response)
2. WITTY / ASSERTIVE MOVE (A playful, witty, or assertive dialogue/action)
3. SCENE ADVANCEMENT (An action that shifts the physical or narrative dynamic)`;

  const guideInstruction = guide ? `\n[DIRECTOR HINT]: Guide suggestions according to: "${guide}".\n` : '';

  const baseSys = buildSystemInstruction(
    profile, 
    codexEntries, 
    currentSummary, 
    customInstructions, 
    profile.scenarioInstructions, 
    undefined, 
    pinnedMessages
  );
  const systemInstruction = `${baseSys}

[TASK DIRECTIVE — SUGGEST 3 PLAYER ACTIONS]
${modeInstruction}
${guideInstruction}
- Return a JSON array with exactly 3 objects.
- Each object must have:
  - "label": A short 2-4 word summary chip (e.g. "Ask about the relic", "Draw blade quietly", "Attempt diplomacy")
  - "text": The complete, ready-to-send first-person player message (1-2 sentences)
  - "type": One of "dialogue", "action", "bold", "investigate"
- No markdown wrappers around the JSON. Return only the JSON array.`;

  const settings = getSettings();
  const ai = getGenAI();

  try {
    const response = await withRetry(() => ai.models.generateContent({
      model: settings.activeModel,
      contents: [
        ...buildHistory(history),
        { role: 'user', parts: [{ text: "Suggest 3 diverse next actions for my character." }] }
      ],
      config: {
        systemInstruction,
        temperature: 0.85,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              text: { type: Type.STRING },
              type: { type: Type.STRING }
            },
            required: ["label", "text", "type"]
          }
        }
      }
    }));

    const parsed = parseJsonWithRecovery(response.text || "[]");
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, 3);
    }
  } catch (err: any) {
    console.warn("suggestMultipleActions structured generation failed, trying single suggestion fallback:", err);
  }

  // Fallback to single suggestion
  try {
    const single = await suggestNextAction(history, profile, codexEntries, currentSummary, guide, customInstructions, pinnedMessages);
    if (single) {
      return [{
        label: "AI Suggestion",
        text: single,
        type: "action"
      }];
    }
  } catch {}

  return [];
}

export async function suggestNextAction(
  history: any[], 
  profile: CharacterProfile, 
  codexEntries: CodexEntry[] = [], 
  currentSummary: string = "", 
  guide?: string, 
  customInstructions?: string,
  pinnedMessages?: any[]
): Promise<string> {
  const modeInstruction = profile.mode === AppMode.GAME
    ? `You are assisting a player in a tabletop RPG. Suggest one compelling next action for THEIR character. It must be written in the first person (or the player's preferred style) and be ready to send as a message. It should feel like a real game decision (attack, investigate, negotiate, use an item, cast a spell, etc.).`
    : profile.mode === AppMode.SCENARIO
    ? `You are assisting a player in an interactive narrative. Suggest one compelling next action for THEIR character that meaningfully advances or complicates the story. Write it as the actual text the player would send.`
    : `You are assisting a player in a character roleplay. Suggest one compelling next dialogue line or action for THEIR character that fits their character voice and advances the scene. Write it as the actual text the player would send.`;

  const guideInstruction = guide ? `\n[DIRECTOR INSTRUCTION]: Shape the suggestion according to this hint: "${guide}".\n` : '';

  const baseSys = buildSystemInstruction(
    profile, 
    codexEntries, 
    currentSummary, 
    customInstructions, 
    profile.scenarioInstructions, 
    undefined, 
    pinnedMessages
  );
  const systemInstruction = `${baseSys}

[TASK DIRECTIVE — SUGGEST PLAYER ACTION]
${modeInstruction}
${guideInstruction}
- Return ONLY the suggested text, ready to use as player input.
- Do NOT say "You should..." or "I suggest...".
- Do NOT use quotes.
- Do NOT provide explanations.
- Write the ACTUAL message the player would send.`;

  const settings = getSettings();

  if (settings.activeTextProvider === 'OpenRouter') {
    return callOpenRouter(history, systemInstruction, `Based on the current situation and my character profile, what is the best next action or dialogue for me to take? Provide the text I should send.`, settings);
  }

  const ai = getGenAI();

  let chat: any;
  let response: any;
  try {
    chat = ai.chats.create({
      model: settings.activeModel,
      config: { 
        systemInstruction,
        temperature: 0.85 
      },
      history: buildHistory(history)
    });
    response = await withRetry(() => chat.sendMessage({ message: `Based on the current situation and my character profile, what is the best next action or dialogue for me to take? Provide the text I should send.` }));
  } catch (err: any) {
    const isFallbackableError = isFallbackable(err);

    const fallbackModel = getQuickFallbackModel(settings.activeModel);
    if (isFallbackableError && settings.activeModel !== fallbackModel) {
      console.warn(`suggestNextAction: Fallback to ${fallbackModel} due to error with ${settings.activeModel}:`, err.message);
      chat = ai.chats.create({
        model: fallbackModel,
        config: { 
          systemInstruction,
          temperature: 0.85 
        },
        history: buildHistory(history)
      });
      response = await withRetry(() => chat.sendMessage({ message: `Based on the current situation and my character profile, what is the best next action or dialogue for me to take? Provide the text I should send.` }));
    } else {
      throw err;
    }
  }
  return response.text?.trim() || "";
}

export async function refineInput(input: string, profile: CharacterProfile, history: any[], customInstructions?: string): Promise<string> {
  const baseSys = buildSystemInstruction(profile, [], "", customInstructions);
  const systemInstruction = `${baseSys}

[TASK DIRECTIVE — REFINE PLAYER INPUT]
You are an AI writing assistant. Your goal is to rewrite the player's draft to be higher literary quality while maintaining their intent and perspective.

RULES:
- You are writing STRICTLY FOR THE PLAYER. Use THEIR perspective (First person: "I walk", "I say").
- Do NOT include responses or reactions from other characters.
- ONLY return the refined message text. No quotes, no explanations.`;

  const settings = getSettings();

  if (settings.activeTextProvider === 'OpenRouter') {
    return callOpenRouter(history, systemInstruction, `Refine this input: "${input}"`, settings);
  }

  const ai = getGenAI();

  let chat: any;
  let response: any;
  try {
    chat = ai.chats.create({
      model: settings.activeModel,
      config: { systemInstruction },
      history: buildHistory(history)
    });
    response = await withRetry(() => chat.sendMessage({ message: `Refine this input: "${input}"` }));
  } catch (err: any) {
    const isFallbackableError = isFallbackable(err);

    const fallbackModel = getQuickFallbackModel(settings.activeModel);
    if (isFallbackableError && settings.activeModel !== fallbackModel) {
      console.warn(`refineInput: Fallback to ${fallbackModel} due to error with ${settings.activeModel}:`, err.message);
      chat = ai.chats.create({
        model: fallbackModel,
        config: { systemInstruction },
        history: buildHistory(history)
      });
      response = await withRetry(() => chat.sendMessage({ message: `Refine this input: "${input}"` }));
    } else {
      throw err;
    }
  }
  return response.text?.trim() || input;
}

export async function generateSpeech(
  text: string,
  voiceName: string,
  voiceSettings: any,
  tone: string,
  useFastChain: boolean = true
): Promise<string> {
  if (!text || !text.trim()) return "";
  const directorPrompt = buildDirectorPrompt(
    voiceSettings?.characterName || 'Character',
    voiceSettings?.voiceArchetype || 'Character',
    '',
    voiceSettings?.voiceStyle || tone || '',
    voiceSettings?.voicePacing || '',
    voiceSettings?.voiceAccent || voiceSettings?.accent || ''
  );
  const audio = await synthesizeSpeech(text, voiceName || 'Kore', directorPrompt, useFastChain);
  return audio || "";
}

// Backwards-compatible wrapper for callers that expect stylePrefix usage (Director Prompt)
export async function generateSpeechWithDirectorPrompt(
  text: string,
  voiceName?: string,
  stylePrefix?: string | null,
  useFastChain: boolean = false
): Promise<string | null> {
  return synthesizeSpeech(text, voiceName, stylePrefix, useFastChain);
}

export async function extractCodexEntries(history: any[], profile: CharacterProfile, existingEntries: CodexEntry[]): Promise<Partial<CodexEntry>[]> {
  const ai = getGenAI();
  const existingTitles = existingEntries.map(e => e.title).join(', ');
  
  const modeHint = profile.mode === AppMode.GAME
    ? 'Focus especially on: game mechanics, rules established in play, named items/weapons, and notable locations visited. Prioritize "Mechanics" and "Item" categories.'
    : profile.mode === AppMode.SCENARIO
    ? 'Focus especially on: world lore, faction details, discovered locations, and historical events. Prioritize "Lore" and "Location" categories.'
    : 'Focus especially on: character lore, interpersonal history, revealed secrets, and meaningful objects. Prioritize "Lore" and "Item" categories.';

  const response = await withRetry(() => ai.models.generateContent({
    model: getSettings().activeModel,
    contents: `Analyze the following roleplay history and character profile. Identify significant new lore, locations, items, or mechanics that should be added to the world codex.
Do not suggest entries that already exist: [${existingTitles}]

${modeHint}

Character Profile: ${JSON.stringify(profile)}
History: ${JSON.stringify(history.slice(-20))}

Return a JSON array of new codex entries. Each must have:
- title: Short, clear name
- content: Concise description (1-3 sentences)
- category: One of "Lore", "Mechanics", "Location", "Item"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            content: { type: Type.STRING },
            category: { type: Type.STRING, enum: ["Lore", "Mechanics", "Location", "Item"] }
          },
          required: ["title", "content", "category"]
        }
      }
    }
  }));
  
  return parseJsonWithRecovery(response.text || "[]");
}

export async function refineCodexEntry(entry: Partial<CodexEntry>, profile: CharacterProfile): Promise<Partial<CodexEntry>> {
  const ai = getGenAI();
  const response = await withRetry(() => ai.models.generateContent({
    model: getSettings().activeModel,
    contents: `Refine this codex entry to be more descriptive, immersive, and consistent with the world of ${profile.name}.
Current Entry: ${JSON.stringify(entry)}
World Context: ${profile.worldAtmosphere || 'Not specified'}
 
Return the refined entry as JSON with the same fields (title, content, category).`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          content: { type: Type.STRING },
          category: { type: Type.STRING, enum: ["Lore", "Mechanics", "Location", "Item"] }
        },
        required: ["title", "content", "category"]
      }
    }
  }));
  
  try {
    return parseJsonWithRecovery(response.text || JSON.stringify(entry));
  } catch (e) {
    return entry;
  }
}

export async function updateCharacterProfilesFromHistory(history: any[], profile: CharacterProfile): Promise<Partial<CharacterProfile>> {
  const ai = getGenAI();
  const response = await withRetry(() => ai.models.generateContent({
    model: getSettings().activeModel,
    contents: `Analyze the following roleplay history and suggest updates to the character's profile based on recent events, character development, and changes in relationships.
Current Profile: ${JSON.stringify(profile)}
Recent History: ${JSON.stringify(history.slice(-15))}
 
Return a JSON object with any fields that should be updated. Only include fields that have meaningful changes.
Fields you can update: personality, backstory, appearance, relationship, worldAtmosphere, keyLocations, characterFlaws, secretMotive, questObjective, scenarioStakes, scenarioConflict, dungeonMasterStyle, rulesComplexity, speechPattern, likesAndDislikes, coreBeliefs, quirks, timePeriod, factions, magicOrTechnologyLevel, incitingIncident, difficultyLevel, partyComposition, startingEquipment, currentCampaignArc.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          personality: { type: Type.STRING },
          backstory: { type: Type.STRING },
          appearance: { type: Type.STRING },
          relationship: { type: Type.STRING },
          worldAtmosphere: { type: Type.STRING },
          keyLocations: { type: Type.STRING },
          characterFlaws: { type: Type.STRING },
          secretMotive: { type: Type.STRING },
          speechPattern: { type: Type.STRING },
          likesAndDislikes: { type: Type.STRING },
          coreBeliefs: { type: Type.STRING },
          quirks: { type: Type.STRING },
          questObjective: { type: Type.STRING },
          scenarioStakes: { type: Type.STRING },
          scenarioConflict: { type: Type.STRING },
          timePeriod: { type: Type.STRING },
          factions: { type: Type.STRING },
          magicOrTechnologyLevel: { type: Type.STRING },
          incitingIncident: { type: Type.STRING },
          dungeonMasterStyle: { type: Type.STRING },
          rulesComplexity: { type: Type.STRING },
          difficultyLevel: { type: Type.STRING },
          partyComposition: { type: Type.STRING },
          startingEquipment: { type: Type.STRING },
          currentCampaignArc: { type: Type.STRING }
        }
      }
    }
  }));
  
  return parseJsonWithRecovery(response.text || "{}");
}

export async function detectMood(history: any[]): Promise<string> {
  const ai = getGenAI();
  try {
    const response = await withRetry(() => ai.models.generateContent({
      model: getSettings().activeModel,
      contents: `Analyze the last 3 messages of this roleplay and determine the character's current mood.
      History: ${JSON.stringify(history.slice(-3))}
      
      Return ONLY one word from this list: Neutral, Happy, Sad, Angry, Fearful, Surprised, Disgusted, Excited, Exhausted, Flirty, Mysterious, Gritty.`,
    }));
    return response.text?.trim() || "Neutral";
  } catch (e) {
    return "Neutral";
  }
}

export async function generateContextualAvatar(profile: CharacterProfile, history: any[]): Promise<string> {
  const recentEvents = history.slice(-5).map(m => m.parts?.[0]?.text || m.text || '').filter(Boolean).join(' ');
  const prompt = `portrait of ${profile.name}, mood: ${profile.currentMood || 'Neutral'}, ${profile.appearance || ''}, context: ${recentEvents.slice(0, 150)}, dramatic cinematic lighting`;

  try {
    return getPollinationsUrl(prompt, 512, 512);
  } catch (error) {
    console.error("generateContextualAvatar Error:", error);
    const seed = encodeURIComponent(profile.name || 'personaforge');
    return `https://api.dicebear.com/9.x/adventurer/svg?seed=${seed}`;
  }
}

export async function generateVeoAnimation() {
  return "";
}

export async function generateVoiceReply() {
  return "";
}
