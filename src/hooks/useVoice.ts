import { useState, useCallback, useEffect } from 'react';
import { defaultTtsEngine, splitIntoSpeechSegments } from '../lib/ttsEngine';
import { buildDirectorPromptFromProfile } from '../lib/voiceDirector';
import { interruptAiSpeech, isLiveVoiceSpeaking } from '../lib/liveVoice';
import { getSettings } from '../lib/types';
import type { CharacterProfile, VoiceSettings } from '../lib/types';

export function useVoice(voiceName: string, _voiceSettings?: VoiceSettings, _storyTone?: string) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [currentSegment, setCurrentSegment] = useState(0);
  const [totalSegments, setTotalSegments] = useState(0);

  useEffect(() => {
    defaultTtsEngine.onSpeakingChanged = (speaking) => {
      setIsPlaying(speaking);
      if (!speaking) {
        setSpeakingMessageId(null);
        setCurrentSegment(0);
        setTotalSegments(0);
      }
    };
    return () => {
      defaultTtsEngine.onSpeakingChanged = undefined;
    };
  }, []);

  const handleReadAloud = useCallback(async (text: string, profile?: CharacterProfile, messageId?: string) => {
    try {
      // If already speaking this message, toggle stop
      if (isPlaying && speakingMessageId === messageId) {
        defaultTtsEngine.stop();
        setIsPlaying(false);
        setSpeakingMessageId(null);
        return;
      }

      const settings = getSettings();
      // Stop anything currently playing
      defaultTtsEngine.stop();
      try { window.speechSynthesis.cancel(); } catch {}
      if (isLiveVoiceSpeaking()) {
        interruptAiSpeech();
      }

      const segments = splitIntoSpeechSegments(text);
      if (segments.length === 0) return;

      const voiceNameToUse = profile?.voiceName?.trim() || settings.liveVoiceName || voiceName || 'Kore';
      const useFast = settings.voiceQuality !== 'quality';

      setIsPlaying(true);
      if (messageId) setSpeakingMessageId(messageId);
      setTotalSegments(segments.length);
      setCurrentSegment(0);

      const directorPrompt = profile
        ? (buildDirectorPromptFromProfile(profile, '', '', segments[0] || text) ?? null)
        : null;

      await defaultTtsEngine.speakSegments(segments, {
        voiceName: voiceNameToUse,
        buildStylePrefix: profile
          ? (seg) => buildDirectorPromptFromProfile(profile, '', '', seg) ?? null
          : undefined,
        stylePrefix: directorPrompt,
        useFastChain: useFast,
        onSegmentStart: (idx, total) => {
          setCurrentSegment(idx);
          setTotalSegments(total);
        },
        onComplete: () => {
          setIsPlaying(false);
          setSpeakingMessageId(null);
          setCurrentSegment(0);
          setTotalSegments(0);
        }
      });
    } catch (err) {
      console.error('Speech Error:', err);
      setIsPlaying(false);
      setSpeakingMessageId(null);
    }
  }, [voiceName, isPlaying, speakingMessageId]);

  const stopAudio = useCallback(() => {
    defaultTtsEngine.stop();
    setIsPlaying(false);
    setSpeakingMessageId(null);
    setCurrentSegment(0);
    setTotalSegments(0);
  }, []);

  return {
    isPlaying,
    speakingMessageId,
    currentSegment,
    totalSegments,
    handleReadAloud,
    togglePause: stopAudio,
    stopAudio,
  };
}