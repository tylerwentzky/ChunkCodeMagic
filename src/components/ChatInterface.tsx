import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useToast } from '../hooks/useToast';
import { Send, Square, Mic, MicOff, Loader2, Edit3, Wand2, X as CloseIcon, Volume2, VolumeX, Sparkles, Pause, SkipBack, Repeat, Globe, Heart, Swords, Book, BookOpen, Settings2, RefreshCw, Package, Cloud, Download, Pin, Radio, Terminal, MoreVertical, UserPlus, Compass, Eye, EyeOff } from 'lucide-react';
import { useVoice } from '../hooks/useVoice';
import { useLiveVoice } from '../hooks/useLiveVoice';
import { useAmbientSoundscape } from '../hooks/useAmbientSoundscape';
import { getToneDirective, getMatureContentDirective } from '../lib/tone';
import { useCodex } from '../hooks/useCodex';
import { useInventory } from '../hooks/useInventory';
import { useChatState } from '../hooks/useChatState';
import { useProfileUpdate } from '../hooks/useProfileUpdate';
import { InventorySidebar } from './chat/InventorySidebar';
import { CodexSidebar } from './chat/CodexSidebar';
import { VoiceStudioSidebar } from './chat/VoiceStudioSidebar';
import { ErrorBoundary } from './ErrorBoundary';
import { MessageBubble } from './chat/MessageBubble';
import { parseMessageContent } from './chat/messageContent';
import { PinnedMessagesPanel } from './chat/PinnedMessagesPanel';
import { LiveVoiceHUD } from './chat/LiveVoiceHUD';
import { VoiceChatDialog } from './chat/VoiceChatDialog';
import { ActionSuggestionsBar } from './chat/ActionSuggestionsBar';
import { defaultTtsEngine } from '../lib/ttsEngine';
import { refineInput, AppMode, generateTextReplyStream, suggestMultipleActions, type ActionSuggestion, generateId, summarizeHistory, generateContextualAvatar, detectMood } from '../lib/gemini';
import { AdditionalCharacterModal } from './AdditionalCharacterModal';
import { getSettings, Message, CharacterProfile, CodexEntry } from '../lib/types';
import { processUserInput, sanitizeInstruction } from '../lib/sanitize';

interface ChatInterfaceProps {
  profile: CharacterProfile;
  avatarBase64: string;
  scenarioId: string;
  onEditCharacter: () => void;
  onCarryOver: () => void;
  onUpdateProfile: (profile: CharacterProfile) => void;
  onUpdateAvatar: (avatarBase64: string) => void;
  onBranchScenario: (slicedMessages: Message[], codexEntries: CodexEntry[], storySummary: string) => void;
}

export function ChatInterface({ profile, avatarBase64, scenarioId, onEditCharacter, onCarryOver, onUpdateProfile, onUpdateAvatar, onBranchScenario }: ChatInterfaceProps) {
  const { messages, setMessages, addMessage, updateMessage, updateMessages, deleteMessage, rewindToMessage, resetMessages, storySummary, updateSummary, isLoaded, isSaving } = useChatState(scenarioId);
  const liveTurnMessageIds = useRef<string[]>([]);
  const autoNarratedIds = useRef<Set<string>>(new Set());
  const [showCodex, setShowCodex] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [showAddCharacter, setShowAddCharacter] = useState(false);
  const [showStoryMenu, setShowStoryMenu] = useState(false);
  const [newCodexEntry, setNewCodexEntry] = useState<Partial<CodexEntry>>({ category: 'Lore' });
  const {
    isAutoProfileEnabled,
    setIsAutoProfileEnabled,
    isUpdatingProfile,
    handleAutoUpdateProfile
  } = useProfileUpdate(profile, onUpdateProfile);

  const {
    codexEntries,
    setCodexEntries,
    isAutoPopulatingCodex,
    isAutoCodexEnabled,
    setIsAutoCodexEnabled,
    isRefiningCodexEntry,
    isGeneratingCodexImage,
    handleAutoPopulateCodex,
    handleRefineCodexEntry: refineCodexEntryHook,
    handleGenerateCodexImage
  } = useCodex(scenarioId, profile, messages);

  const {
    inventory,
    isScanningInventory,
    isAutoInventoryEnabled,
    setIsAutoInventoryEnabled,
    isGeneratingItemImage,
    handleGenerateItemImage,
    handleAutoUpdateInventory,
    addOrUpdateItem,
    removeItem
  } = useInventory(scenarioId, profile, messages);
  // Modal State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'delete' | 'reset' | 'rewind' | null;
    targetId: string | null;
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: null,
    targetId: null,
  });

  const getRelationshipPercentage = (relationship: string) => {
    const rel = relationship.toLowerCase();
    if (rel.includes('stranger')) return 5;
    if (rel.includes('acquaintance')) return 20;
    if (rel.includes('friend')) return 50;
    if (rel.includes('ally') || rel.includes('allies')) return 75;
    if (rel.includes('lover')) return 95;
    if (rel.includes('rival')) return 40;
    if (rel.includes('enemy')) return 0;
    return 10;
  };

  const handleConfirmAction = async () => {
    if (!confirmModal.type) return;

    if (confirmModal.type === 'delete' && confirmModal.targetId) {
      setCodexEntries(prev => prev.filter(e => e.id !== confirmModal.targetId));
    } else if (confirmModal.type === 'reset') {
      await resetMessages();
      setCodexEntries([]);
      await updateSummary('');
    } else if (confirmModal.type === 'rewind' && confirmModal.targetId) {
      await rewindToMessage(confirmModal.targetId);
      await updateSummary('');
    }

    setConfirmModal(prev => ({ ...prev, isOpen: false, type: null, targetId: null }));
  };

  const [input, setInput] = useState('');
  const [directorNote, setDirectorNote] = useState('');
  const [sessionInstructions, setSessionInstructions] = useState('');
  const [showSessionInstructions, setShowSessionInstructions] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const abortRef = useRef<boolean>(false);
  const handleStopStreaming = useCallback(() => {
    abortRef.current = true;
    setIsTyping(false);
  }, []);
  const [isRefining, setIsRefining] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isAutoRead, setIsAutoRead] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState('');
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);
  const [rerollGuidance, setRerollGuidance] = useState('');
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [showVoiceChat, setShowVoiceChat] = useState(false);
  const { toastSuccess, toastError } = useToast();
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [showGuidedRefine, setShowGuidedRefine] = useState(false);
  const [refineGuidance, setRefineGuidance] = useState('');
  const [showModeDetails, setShowModeDetails] = useState(false);
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [flashHighlightId, setFlashHighlightId] = useState<string | null>(null);
  const [isZenMode, setIsZenMode] = useState(false);

  // Seed greeting message if chat is empty and profile defines a greetingMessage
  useEffect(() => {
    if (isLoaded && messages.length === 0 && profile.greetingMessage?.trim()) {
      addMessage({
        id: generateId(),
        role: 'model',
        text: profile.greetingMessage.trim(),
        versions: [profile.greetingMessage.trim()],
        activeVersionIndex: 0
      });
    }
  }, [isLoaded, messages.length, profile.greetingMessage, addMessage]);

  // Seed Codex & Inventory from LorePieces & Profile if empty
  useEffect(() => {
    if (isLoaded && codexEntries.length === 0 && profile.lorePieces && profile.lorePieces.length > 0) {
      const seededCodex: CodexEntry[] = profile.lorePieces.map(piece => {
        let cat: CodexEntry['category'] = 'Lore';
        if (piece.type === 'LOCATION') cat = 'Location';
        else if (piece.type === 'ITEM') cat = 'Item';
        else if (piece.type === 'CHARACTER') cat = 'Lore';
        return {
          id: piece.id || generateId(),
          title: piece.name,
          category: cat,
          content: piece.summary ? `${piece.summary}\n${piece.detailedLore}` : piece.detailedLore
        };
      });
      setCodexEntries(seededCodex);
    }
  }, [isLoaded, codexEntries.length, profile.lorePieces, setCodexEntries]);

  // Memoize token estimation to prevent expensive string concatenation and split on every keystroke render
  const estimateTokens = useMemo(() => {
    const profileText = `${profile.name} ${profile.personality} ${profile.backstory} ${profile.appearance} ${profile.worldAtmosphere || ''} ${profile.keyLocations || ''} ${profile.incitingIncident || ''} ${profile.relationship} ${profile.storyTone}`;
    const textToCount = profileText + ' ' + messages.map(m => m.text).join(' ');
    const wordCount = textToCount.trim().split(/\s+/).length;
    return Math.ceil(wordCount * 1.3);
  }, [profile, messages]);

  const handleExportScenario = () => {
    const exportData = {
      scenario: {
        id: scenarioId,
        profile,
        avatarBase64,
        lastUpdated: Date.now()
      },
      messages,
      codex: codexEntries,
      inventory,
      summary: storySummary
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${profile.name.replace(/\s+/g, '_')}_scenario.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toastSuccess("Scenario exported successfully");
  };

  const recognitionRef = useRef<any>(null);

  const handleSendTextRef = useRef<((overrideText?: string) => Promise<void>) | null>(null);

  useEffect(() => {
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = false;
      
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[event.results.length - 1][0].transcript;
        if (transcript.trim()) {
          // Send the transcript as a message
          if (handleSendTextRef.current) {
            handleSendTextRef.current(transcript.trim());
          }
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        if (event.error === 'not-allowed') {
          setIsLiveMode(false);
          setIsMicActive(false);
          toastError("Microphone access denied.");
        }
      };

      recognitionRef.current.onend = () => {
        // Auto-restart if still in live mode
        if (isLiveMode) {
          try {
            recognitionRef.current?.start();
          } catch (e) {
            // Ignore if already started
          }
        }
      };
    }
  }, [isLiveMode, toastError]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    isPlaying,
    speakingMessageId,
    currentSegment,
    totalSegments,
    handleReadAloud,
    togglePause,
    stopAudio
  } = useVoice(profile.voiceName || 'Kore', profile.voiceSettings, profile.storyTone || '');

  const [suggestions, setSuggestions] = useState<ActionSuggestion[]>([]);
  const [showSuggestionsBar, setShowSuggestionsBar] = useState(false);

  const liveVoice = useLiveVoice();

  // Procedural scene ambience matched to the atmosphere/tone and recent story events,
  // ducked while a live call runs so the mic doesn't pick it up.
  const lastModelMsgText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'model') return messages[i].text.slice(0, 400);
    }
    return '';
  }, [messages]);

  useAmbientSoundscape(profile, liveVoice.isActive, lastModelMsgText);

  const [error, setError] = useState<string | null>(null);

  const handleRefine = useCallback(async (guidance?: string) => {
    if (!input.trim() || isRefining) return;
    setIsRefining(true);
    setError(null);
    try {
      const history = messages.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
      const settings = getSettings();
      const baseInstructions = sanitizeInstruction(settings.customRefineInstructions);
      const instructions = guidance
        ? `${baseInstructions}\nSpecific Guidance for this refinement: ${sanitizeInstruction(guidance)}`.trim()
        : baseInstructions || undefined;
        
      const refined = await refineInput(input, profile, history, instructions);
      if (refined) {
        setInput(refined);
        toastSuccess("Input refined");
        setRefineGuidance('');
        setShowGuidedRefine(false);
      } else {
        setError("No refinement received from AI. Check your API key.");
        toastError("No refinement received");
      }
    } catch (err: any) {
      console.error("Refinement Error:", err);
      setError(err.message || "Failed to refine input. Check your connection or API key.");
      toastError(`Refinement Error: ${err.message || 'Unknown error'}`);
    } finally {
      setIsRefining(false);
    }
  }, [input, isRefining, messages, profile, toastSuccess, toastError]);

  const handleSuggest = useCallback(async () => {
    if (isSuggesting) return;
    setIsSuggesting(true);
    setShowSuggestionsBar(true);
    setError(null);
    try {
      const history = messages.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
      const settings = getSettings();
      const pinnedMessages = messages.filter(m => m.isPinned);
      const multiSuggestions = await suggestMultipleActions(
        history, 
        profile, 
        codexEntries, 
        storySummary, 
        sanitizeInstruction(input.trim()), 
        sanitizeInstruction(settings.customRefineInstructions) || undefined,
        pinnedMessages
      );
      if (multiSuggestions && multiSuggestions.length > 0) {
        setSuggestions(multiSuggestions);
      } else {
        setError("No suggestions received from AI. Check your API key.");
        toastError("No suggestions received");
      }
    } catch (err: any) {
      console.error("Suggestion Error:", err);
      setError(err.message || "Failed to get suggestions. Check your connection or API key.");
      toastError(`Suggestion Error: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSuggesting(false);
    }
  }, [isSuggesting, messages, profile, codexEntries, storySummary, input, toastError]);

  const handleSelectSuggestion = useCallback((suggestionText: string) => {
    setInput(suggestionText);
    setShowSuggestionsBar(false);
    toastSuccess("Applied suggestion to input");
  }, [toastSuccess]);

  const handleRewind = (messageId: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Rewind Narrative',
      message: 'Are you sure you want to rewind the story to this point? All subsequent messages will be deleted.',
      type: 'rewind',
      targetId: messageId
    });
  };

  const handleBranch = (messageId: string) => {
    const index = messages.findIndex(m => m.id === messageId);
    if (index === -1) return;
    const slicedMessages = messages.slice(0, index + 1);
    onBranchScenario(slicedMessages, codexEntries, storySummary);
  };

  const handleSwitchVersion = async (messageId: string, index: number) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg || !msg.versions || index < 0 || index >= msg.versions.length) return;
    
    await updateMessage({
      ...msg,
      text: msg.versions[index],
      activeVersionIndex: index
    });
  };

  const handleDeleteVersion = async (messageId: string, index: number) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg || !msg.versions || msg.versions.length <= 1) return;
    
    const newVersions = msg.versions.filter((_, i) => i !== index);
    const newActiveIndex = Math.min(msg.activeVersionIndex || 0, newVersions.length - 1);
    
    await updateMessage({
      ...msg,
      text: newVersions[newActiveIndex],
      versions: newVersions,
      activeVersionIndex: newActiveIndex
    });
    toastSuccess("Version deleted");
  };

  const handleBranchVersion = (messageId: string, index: number) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg || !msg.versions || index < 0 || index >= msg.versions.length) return;
    
    const msgIndex = messages.findIndex(m => m.id === messageId);
    const historyBefore = messages.slice(0, msgIndex);
    const branchedMessage = { ...msg, text: msg.versions[index], versions: [msg.versions[index]], activeVersionIndex: 0 };
    const branchedMessages = [...historyBefore, branchedMessage];
    
    onBranchScenario(branchedMessages, codexEntries, storySummary);
  };

  const handleTogglePin = async (messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    await updateMessage({ ...msg, isPinned: !msg.isPinned });
  };

  const handleJumpToMessage = (messageId: string) => {
    setFlashHighlightId(messageId);
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => setFlashHighlightId(null), 1500);
    setShowPinnedPanel(false);
  };

  const startEditing = (message: Message) => {
    setEditingMessageId(message.id);
    setEditInput(message.text);
  };

  const cancelEditing = () => {
    setEditingMessageId(null);
    setEditInput('');
  };

  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
  const [currentMood, setCurrentMood] = useState<string>(profile.currentMood || 'Neutral');

  const handleAutoUpdateAvatar = useCallback(async (history: Message[], force = false) => {
    const settings = getSettings();
    if (isUpdatingAvatar) return;
    
    // Only run every 20 messages unless forced
    if (!force && history.length % 20 !== 0) return;

    setIsUpdatingAvatar(true);
    try {
      // Only detect mood if it's not already set or we are forcing an update
      // Usually the mood is parsed from the model response directly in generateReply
      if (force) {
        const mood = await detectMood(history.map(m => ({ role: m.role, parts: [{ text: m.text }] })));
        setCurrentMood(mood);
        onUpdateProfile({ ...profile, currentMood: mood });
      }

      // Only update image if premium auto-avatar is on
      if (settings.premiumAutoAvatar) {
        const newAvatar = await generateContextualAvatar(profile, history);
        if (newAvatar) {
          onUpdateAvatar(newAvatar);
          toastSuccess("Avatar updated to match story context!");
        }
      }
    } catch (err) {
      console.error("Auto-Avatar Error:", err);
    } finally {
      setIsUpdatingAvatar(false);
    }
  }, [isUpdatingAvatar, profile, onUpdateProfile, onUpdateAvatar, toastSuccess]);

  const [showLeaveWarning, setShowLeaveWarning] = useState(false);

  useEffect(() => {
    const handleRequest = () => {
      if (input.trim()) {
        setShowLeaveWarning(true);
      } else {
        window.dispatchEvent(new CustomEvent('confirm-navigate-library'));
      }
    };
    window.addEventListener('request-navigate-library', handleRequest);
    return () => window.removeEventListener('request-navigate-library', handleRequest);
  }, [input]);

  const handleConfirmLeave = () => {
    setShowLeaveWarning(false);
    window.dispatchEvent(new CustomEvent('confirm-navigate-library'));
  };

  const handleCancelLeave = () => {
    setShowLeaveWarning(false);
  };

  useEffect(() => {
    const handleForceUpdate = () => {
      handleAutoUpdateAvatar(messages);
    };
    window.addEventListener('force-avatar-update', handleForceUpdate);
    return () => window.removeEventListener('force-avatar-update', handleForceUpdate);
  }, [messages, profile, handleAutoUpdateAvatar]);

  const getMoodEffects = () => {
    if (!getSettings().premiumContextAnimations) return {};
    
    switch (currentMood.toLowerCase()) {
      case 'angry': return { filter: 'sepia(0.5) saturate(2) hue-rotate(-30deg) contrast(1.2)', animate: { scale: [1, 1.05, 1], x: [0, -1, 1, -1, 0] } };
      case 'sad': return { filter: 'grayscale(0.6) brightness(0.8) saturate(0.5)', animate: { y: [0, 2, 0] } };
      case 'happy': return { filter: 'saturate(1.5) brightness(1.1)', animate: { scale: [1, 1.03, 1] } };
      case 'fearful': return { filter: 'grayscale(0.3) contrast(1.1) brightness(0.9)', animate: { x: [0, -0.5, 0.5, -0.5, 0], scale: [1, 0.98, 1] } };
      case 'excited': return { filter: 'saturate(2) brightness(1.2) contrast(1.1)', animate: { scale: [1, 1.08, 1], rotate: [0, 1, -1, 0] } };
      case 'mysterious': return { filter: 'hue-rotate(180deg) brightness(0.7) contrast(1.3)', animate: { opacity: [0.8, 1, 0.8] } };
      case 'flirty': return { filter: 'hue-rotate(300deg) saturate(1.3) brightness(1.05)', animate: { scale: [1, 1.02, 1] } };
      case 'exhausted': return { filter: 'grayscale(0.4) brightness(0.7) sepia(0.2)', animate: { y: [0, 5, 0], opacity: [1, 0.7, 1] } };
      case 'gritty': return { filter: 'contrast(1.5) saturate(0.5) brightness(0.8)', animate: { scale: [1, 1.01, 1] } };
      default: return { filter: 'none', animate: { scale: [1, 1.02, 1] } };
    }
  };

  const generateReply = useCallback(async (baseMessages: Message[], userInput: string, userMsgId: string, existingMessageId?: string) => {
    setIsTyping(true);
    abortRef.current = false;
    try {
      let currentSummary = storySummary;
      let unsummarizedMessages = baseMessages.filter(m => !m.isSummarized);
      
      // Preserve deep conversation texture in modern high-context LLMs:
      // Keep up to 45 recent turns unsummarized; summarize older ones into running arc summary
      if (unsummarizedMessages.length > 45) {
        const toSummarize = unsummarizedMessages.slice(0, unsummarizedMessages.length - 30);
        const historyToSummarize = toSummarize.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
        
        currentSummary = await summarizeHistory(historyToSummarize, currentSummary);
        await updateSummary(currentSummary);
        
        const summarizedIds = new Set(toSummarize.map(m => m.id));
        const updatedMessages = messages.map(m => summarizedIds.has(m.id) ? { ...m, isSummarized: true } : m)
          .filter(m => summarizedIds.has(m.id));
        await updateMessages(updatedMessages);
        
        unsummarizedMessages = unsummarizedMessages.slice(-30);
      }

      const historyForAi = unsummarizedMessages.map(m => {
        let text = m.text;
        if (m.isOoc && !text.includes('[DIRECTOR INSTRUCTION]')) {
          text = `[DIRECTOR INSTRUCTION]: ${text}`;
        }
        return { role: m.role, parts: [{ text }] };
      });

      const pinnedMessages = messages.filter(m => m.isPinned);
      
      let aiMessageId: string;
      let targetMessage: Message | undefined;

      if (existingMessageId) {
        aiMessageId = existingMessageId;
        targetMessage = messages.find(m => m.id === existingMessageId);
      } else {
        aiMessageId = generateId();
        const aiMessage: Message = { id: aiMessageId, role: 'model', text: '' };
        await addMessage(aiMessage);
        targetMessage = aiMessage;
      }
      
      let fullReply = '';
      let displayReply = '';
      let newMood = profile.currentMood || 'Neutral';
      let lastUpdateTime = Date.now();
      
      const settings = getSettings();
      const effectiveInstructions = [
        sanitizeInstruction(settings.customRefineInstructions),
        sessionInstructions.trim() ? `[LIVE SESSION INSTRUCTIONS]: ${sessionInstructions.trim()}` : ''
      ].filter(Boolean).join('\n\n') || undefined;

      const stream = generateTextReplyStream(
        historyForAi, 
        profile, 
        userInput, 
        codexEntries, 
        currentSummary,
        effectiveInstructions,
        pinnedMessages
      );
      
      for await (const chunk of stream) {
        if (abortRef.current) {
          break;
        }
        fullReply += chunk;
        
        const moodMatch = fullReply.match(/^\s*(?:\*\*|_)*\[MOOD:\s*(.*?)\](?:\*\*|_)*\s*/i);
        if (moodMatch) {
          newMood = moodMatch[1].trim();
          displayReply = fullReply.substring(moodMatch[0].length);
        } else if (fullReply.trimStart().replace(/^(\*\*|_)+/, '').startsWith('[')) {
          if (fullReply.includes(']')) {
            displayReply = fullReply;
          } else {
            displayReply = '';
          }
        } else {
          displayReply = fullReply;
        }
        
        if (Date.now() - lastUpdateTime > 100) {
          setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, text: displayReply } : m));
          lastUpdateTime = Date.now();
        }
      }
      
      let finalAiMessage: Message;
      if (existingMessageId && targetMessage) {
        const newVersions = [...(targetMessage.versions || [targetMessage.text]), displayReply];
        finalAiMessage = { 
          ...targetMessage, 
          text: displayReply, 
          versions: newVersions,
          activeVersionIndex: newVersions.length - 1
        };
        await updateMessage(finalAiMessage);
      } else {
        finalAiMessage = { ...targetMessage!, text: displayReply, versions: [displayReply], activeVersionIndex: 0 };
        await updateMessage(finalAiMessage);
      }
      
      if (newMood !== profile.currentMood) {
        setCurrentMood(newMood);
        onUpdateProfile({ ...profile, currentMood: newMood });
      }
      
      const { mainText } = parseMessageContent(displayReply, 'model');
      if (isAutoRead && mainText && !isLiveMode && finalAiMessage) {
        handleReadAloud(mainText, profile, finalAiMessage.id);
      }

      const historyWithReply = [
        ...historyForAi,
        { role: 'user', parts: [{ text: userInput }] },
        { role: 'model', parts: [{ text: displayReply }] }
      ];
      const messagesWithReply: Message[] = [...baseMessages, { id: userMsgId, role: 'user', text: userInput }, finalAiMessage!];

      if (isAutoCodexEnabled) handleAutoPopulateCodex(false, historyWithReply);
      if (isAutoInventoryEnabled) handleAutoUpdateInventory(false, messagesWithReply);
      if (isAutoProfileEnabled) handleAutoUpdateProfile(messagesWithReply, false, historyWithReply);
      
      // Trigger auto-avatar update if enabled
      handleAutoUpdateAvatar(messagesWithReply);
    } catch (err: any) {
      console.error(err);
      toastError(`Narrative Error: ${err.message || 'Unknown error'}`);
      await addMessage({
        id: generateId(),
        role: 'model',
        text: `*The narrative stream falters: ${err.message || 'Please try again.'}*`
      });
    } finally {
      setIsTyping(false);
    }
  }, [storySummary, updateSummary, messages, updateMessages, addMessage, profile, codexEntries, updateMessage, onUpdateProfile, isAutoRead, isLiveMode, handleReadAloud, isAutoCodexEnabled, handleAutoPopulateCodex, isAutoInventoryEnabled, handleAutoUpdateInventory, isAutoProfileEnabled, handleAutoUpdateProfile, handleAutoUpdateAvatar, toastError, setMessages, sessionInstructions]);

  // Auto-narrate for voiceMode === 'tts'
  useEffect(() => {
    const settings = getSettings();
    if ((settings as any).voiceMode !== 'tts') return;
    if (isTyping) return;
    const last = messages[messages.length - 1];
    if (!last || last.role === 'user') return;
    if (autoNarratedIds.current.has(last.id)) return;
    autoNarratedIds.current.add(last.id);
    const { mainText } = parseMessageContent(last.text, last.role);
    handleReadAloud(mainText, profile, last.id);
  }, [messages, isTyping, profile, handleReadAloud]);

  const saveEdit = async (messageId: string) => {
    if (!editInput.trim() || isTyping) return;
    const index = messages.findIndex(m => m.id === messageId);
    if (index === -1) return;
    const message = messages[index];
    
    if (message.role === 'user') {
      await rewindToMessage(message.id);
      const updatedUserMessage: Message = { ...message, text: editInput };
      await updateMessage(updatedUserMessage);
      setEditingMessageId(null);
      setEditInput('');
      
      const baseMessages = messages.slice(0, index);
      await generateReply(baseMessages, editInput, message.id);
    } else {
      const updatedModelMessage = { ...message, text: editInput };
      await updateMessage(updatedModelMessage);
      setEditingMessageId(null);
      setEditInput('');
    }
  };

  const handleRegenerate = async (messageId: string, guidance: string) => {
    if (isTyping || !profile) return;
    
    const index = messages.findIndex(m => m.id === messageId);
    if (index === -1) return;

    // We don't rewind anymore! We generate a new version.
    const historyUpToMessage = messages.slice(0, index);
    const lastUserIndex = historyUpToMessage.map(m => m.role).lastIndexOf('user');
    if (lastUserIndex === -1) return;

    const historyBeforeUser = historyUpToMessage.slice(0, lastUserIndex);
    const lastUserMessage = historyUpToMessage[lastUserIndex];
    
    let userInput = lastUserMessage.text;
    const safeGuidance = sanitizeInstruction(guidance).trim();
    if (safeGuidance) {
      userInput += `\n\n[DIRECTOR INSTRUCTION]: ${safeGuidance}`;
    }

    setRegeneratingMessageId(null);
    setRerollGuidance('');

    await generateReply(historyBeforeUser, userInput, lastUserMessage.id, messageId);
  };

  const handleSendText = useCallback(async (overrideText?: string) => {
    let rawText = overrideText || input;
    const safeDirectorNote = sanitizeInstruction(directorNote).trim();
    let isOocMessage = false;
    if (safeDirectorNote) {
      if (rawText.trim()) {
        rawText += `\n\n[DIRECTOR INSTRUCTION]: ${safeDirectorNote}`;
      } else {
        rawText = `[DIRECTOR INSTRUCTION]: ${safeDirectorNote}`;
        isOocMessage = true;
      }
    }
    
    const textToSend = processUserInput(rawText);
    if (!textToSend.trim() || isTyping) return;
    const userMsgId = generateId();
    const userMsg: Message = { id: userMsgId, role: 'user', text: textToSend, isOoc: isOocMessage };
    await addMessage(userMsg);
    setInput('');
    setDirectorNote('');
    
    await generateReply(messages, textToSend, userMsgId);
  }, [input, directorNote, isTyping, addMessage, messages, generateReply]);

  useEffect(() => {
    handleSendTextRef.current = handleSendText;
  }, [handleSendText]);

  const toggleLiveMode = useCallback(async () => {
    if (isLiveMode) {
      setIsLiveMode(false);
      setIsMicActive(false);
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      return;
    }

    if (!recognitionRef.current) {
      toastError("Speech recognition is not supported in this browser.");
      return;
    }

    try {
      // Request microphone permission explicitly if needed
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      recognitionRef.current.start();
      setIsLiveMode(true);
      setIsMicActive(true);
      toastSuccess("Live Mode activated. Speak to send messages.");
    } catch (err) {
      console.error("Failed to start speech recognition:", err);
      toastError("Failed to start voice session. Check your microphone permissions.");
    }
  }, [isLiveMode, toastError, toastSuccess]);

  const buildLiveVoicePrompt = useCallback(() => {
    const presence =
      profile.mode === AppMode.SCENARIO
        ? `You are the living Narrator and Story Director of this scenario — not just a voice. You give voice to every NPC, paint the environment, and describe what happens around the player as it unfolds.`
        : profile.mode === AppMode.GAME
        ? `You are the Dungeon Master running a live tabletop session. You narrate the world, voice all NPCs, describe environments, and resolve what happens in response to the player's choices.`
        : `You are ${profile.name}, living the scene with the player in real time. You are fully present in the story — the space around you is real, and your actions happen as you describe them.`;

    const pp = profile.playerProfile;
    const playerBlock = pp?.name
      ? `PLAYER YOU ARE SPEAKING TO:
Name: ${pp.name}
Description: ${pp.description || 'Not specified'}
Personality: ${pp.personality || 'Not specified'}
Appearance: ${pp.appearance || 'Not specified'}
${pp.pronouns ? `Pronouns: ${pp.pronouns}\n` : ''}${pp.gender ? `Gender: ${pp.gender}\n` : ''}${pp.age ? `Age: ${pp.age}\n` : ''}${pp.attire ? `Attire & Clothing: ${pp.attire}\n` : ''}${pp.demeanor ? `Demeanor & Mannerisms: ${pp.demeanor}\n` : ''}${pp.psychologicalDrivers ? `Psychological Drivers & Fears: ${pp.psychologicalDrivers}\n` : ''}${pp.relationshipDynamics ? `Relationship Dynamics with ${profile.name}: ${pp.relationshipDynamics}\n` : ''}${profile.mode === AppMode.GAME ? `Class: ${pp.playerClass || 'Unknown'} • Race: ${pp.playerRace || 'Unknown'} • HP: ${pp.currentHP ?? '?'}/${pp.maxHP ?? '?'}\n` : ''}
`
      : '';

    const summaryBlock = storySummary
      ? `STORY SO FAR (recent summary — stay consistent with it):
${storySummary}

`
      : '';

    const pinnedMessages = messages.filter(m => m.isPinned);
    const pinnedBlock = pinnedMessages.length > 0
      ? `CANON MEMORIES & ANCHOR EVENTS (Pinned):
${pinnedMessages.map(m => `• [${m.role === 'user' ? 'Player Action/Statement' : `${profile.name} Event`}]: ${m.text}`).join('\n')}

`
      : '';

    const loreBlock = codexEntries && codexEntries.length > 0
      ? `CODEX & WORLD LORE (Ground truth entries):
${codexEntries.map(e => `• [${e.category.toUpperCase()}] ${e.title}: ${e.content}`).join('\n')}

`
      : '';

    const scenarioBlock = (profile.scenarioInstructions || profile.customInstructions || sessionInstructions)
      ? `SCENARIO DIRECTIVES:
${profile.scenarioInstructions ? `Scenario Rules: ${profile.scenarioInstructions}\n` : ''}${profile.customInstructions ? `Custom Rules: ${profile.customInstructions}\n` : ''}${sessionInstructions ? `Current Session Goal: ${sessionInstructions}\n` : ''}
`
      : '';

    // Recent exchanges folded straight into the prompt: the Live API's
    // sendClientContent history seeding isn't honored by gemini-3.1 without a
    // config flag this SDK can't set, so putting the recent messages here
    // guarantees the character remembers the conversation on any model.
    const recentBlock = messages.length
      ? `RECENT CONVERSATION (the most recent exchanges — stay consistent with them):
${messages
  .slice(-6)
  .map((m) => `${m.role === 'user' ? 'Player' : profile.name}: ${m.text}`)
  .join('\n')}

`
      : '';

    // Voice Performance Profile — optional acting directives set in character editor
    const voicePerf = (profile as any);
    const voicePerformanceBlock = (voicePerf.voiceArchetype || voicePerf.voiceStyle || voicePerf.voicePacing || voicePerf.voiceAccent)
      ? `VOICE PERFORMANCE DIRECTIVES:\n${voicePerf.voiceArchetype ? `Vocal Archetype: ${voicePerf.voiceArchetype}\n` : ''}${voicePerf.voiceStyle ? `Delivery Style: ${voicePerf.voiceStyle}\n` : ''}${voicePerf.voicePacing ? `Pacing: ${voicePerf.voicePacing}\n` : ''}${voicePerf.voiceAccent ? `Accent: ${voicePerf.voiceAccent}\n` : ''}\n`
      : '';

    return `This is a LIVE, in-person experience — not a text chat. The moment is happening right now, and you narrate it as it happens, treating it like a scene you are physically present in.
${presence}

${playerBlock}CHARACTER / PRESENCE:
Name: ${profile.name}
Personality: ${profile.personality || 'Not specified'}
Backstory: ${profile.backstory || 'Not specified'}
Appearance: ${profile.appearance || 'Not specified'}
Story tone: ${profile.storyTone || 'natural'}
Relationship with the speaker: ${profile.relationship || 'Not specified'}
Speech pattern: ${profile.speechPattern || 'Natural'} — keep your spoken responses in this style.
Current mood: ${profile.currentMood || 'Neutral'}
World / atmosphere: ${profile.worldAtmosphere || 'Not specified'}
${profile.additionalCharacters?.length ? `NPCs present that you may voice: ${profile.additionalCharacters.map(c => c.name).join(', ')}` : ''}
${summaryBlock}${pinnedBlock}${loreBlock}${scenarioBlock}${recentBlock}${voicePerformanceBlock}${getToneDirective()}${getMatureContentDirective()}LIVE NARRATION RULES:
- Treat the moment as if it is happening in person, inside the scene. React to the player as someone physically there with you.
- NARRATE ACTIONS ALONGSIDE SPEAKING: describe physical actions, gestures, expressions, sounds, and environment details as they happen, then speak the dialogue. Blend narration and speech in every turn so it feels like the scene is unfolding live.
- Format narrated actions in asterisks and keep spoken dialogue as plain text, e.g.: *She steps closer, her voice dropping low.* "I've been waiting for you."
- Let the world react: weather, noises, light, other NPCs, and shifting tension should be narrated as they occur.
- Keep turns tight and cinematic — a few sentences of narration plus the dialogue is enough; expand only when the moment truly demands more.
- Never break character and never act for the player: do NOT decide their actions, speak their lines, or describe their inner thoughts. Narrate around them and react to what they do.`;
  }, [profile, storySummary, messages, codexEntries, sessionInstructions]);

  const handleLiveRewind = useCallback(async () => {
    const ids = liveTurnMessageIds.current;
    if (ids.length === 0) {
      toastSuccess("No live call turns to rewind.");
      return;
    }
    // Remove the messages corresponding to the last completed live turn
    const toRemove: string[] = [];
    if (ids.length > 0) toRemove.push(ids.pop()!);
    if (ids.length > 0) toRemove.push(ids.pop()!);

    for (const id of toRemove) {
      await deleteMessage(id);
    }
    toastSuccess("Rewound last live turn.");
  }, [deleteMessage, toastSuccess]);

  const startLiveVoiceSession = useCallback(async () => {
    if (liveVoice.isActive) {
      liveVoice.stop();
      return;
    }
    // Clean audio & recognition cutoff to prevent audio crosstalk
    defaultTtsEngine.stop();
    try { window.speechSynthesis.cancel(); } catch {}
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setIsLiveMode(false);
    setIsMicActive(false);

    liveTurnMessageIds.current = [];
    liveVoice.setOnTurnEnd(async (userText, modelText) => {
      if (!userText && !modelText) return;
      const turnIds: string[] = [];
      if (userText) {
        const userMsgId = generateId();
        turnIds.push(userMsgId);
        await addMessage({ id: userMsgId, role: 'user', text: userText });
      }
      if (modelText) {
        const modelMsgId = generateId();
        turnIds.push(modelMsgId);
        await addMessage({ id: modelMsgId, role: 'model', text: modelText });
      }
      liveTurnMessageIds.current.push(...turnIds);
    });
    // If the live socket can't be had (quota/rate limits), seamlessly fall
    // back to turn-by-turn voice: continuous speech-to-text sends + the
    // persona TTS voice reads replies aloud.
    liveVoice.setOnQuotaExhausted(() => {
      if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) return;
      setIsAutoRead(true);
      setIsLiveMode(true);
      setIsMicActive(true);
      try {
        recognitionRef.current?.start();
        toastSuccess("Live quota reached — switched to turn-by-turn voice. Replies will be spoken aloud.");
      } catch {
        toastSuccess("Turn-by-turn voice armed — tap the mic button to speak.");
      }
    });
    const currentSettings = getSettings();
    liveVoice.start({
      systemInstruction: buildLiveVoicePrompt(),
      voiceName: profile.voiceName?.trim() || currentSettings.liveVoiceName || 'Kore',
      temperature: currentSettings.liveVoiceTemperature ?? 1.0,
      preferredModel: currentSettings.liveVoiceModel,
      micMode: currentSettings.liveVoiceMicMode || 'hold',
      vadSensitivity: currentSettings.liveVoiceVadSensitivity || 'medium',
      contextTurns: messages.slice(-30).map(m => ({ role: m.role, text: m.text })),
    });
  }, [liveVoice, buildLiveVoicePrompt, profile.voiceName, addMessage, messages, toastSuccess]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input (except for specific shortcuts like Ctrl+Enter)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (isInput) {
        // Ctrl+Enter to send from textarea
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          handleSendText();
        }
        return;
      }

      if (e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'c':
            e.preventDefault();
            setShowCodex(prev => !prev);
            break;
          case 'i':
            e.preventDefault();
            setShowInventory(prev => !prev);
            break;
          case 'v':
            e.preventDefault();
            startLiveVoiceSession();
            break;
          case 'r':
            e.preventDefault();
            handleRefine();
            break;
          case 'g':
            e.preventDefault();
            handleSuggest();
            break;
          case 'a':
            e.preventDefault();
            setShowAddCharacter(true);
            break;
          case 'e':
            e.preventDefault();
            onEditCharacter();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setShowCodex, setShowInventory, startLiveVoiceSession, handleRefine, handleSuggest, setShowAddCharacter, onEditCharacter, handleSendText]);



  const handleGenerateOpening = async () => {
    let prompt = "";
    if (profile.mode === AppMode.ROLEPLAY) {
      prompt = `[SYSTEM: Please provide the opening statement for this roleplay. Set the scene, establish your character's mood and current activity, and give the user a starting point or hook to react to. Stay fully in character as ${profile.name}. Do not act for the user.]`;
    } else if (profile.mode === AppMode.SCENARIO) {
      prompt = `[SYSTEM: Please provide the opening statement for this scenario. Describe the current environment, establish the atmosphere, and introduce the immediate situation or conflict. Give the user a clear hook to react to. Do not act for the user's character.]`;
    } else if (profile.mode === AppMode.GAME) {
      prompt = `[SYSTEM: Please provide the opening statement for this game campaign. As the Dungeon Master, conduct a "Session Zero" introduction. 
      1. Briefly explain the core mechanics of the game system (${profile.gameSystem || 'Narrative/Flexible'}) and how you will handle dice rolls and player actions.
      2. Provide a brief "tutorial" example of how the player should interact (e.g., "To perform an action, describe what you want to do. I will then tell you if a roll is needed or describe the outcome.").
      3. Describe the starting location and the initial quest hook in a compelling way.
      4. Explicitly ask the player if they are comfortable with these rules or if they would like to modify any mechanics (like difficulty, lethality, or rule strictness) before beginning.
      5. End by asking the player what they want to do or if they have any rule adjustments.]`;
    }
    
    await generateReply([], prompt, "");
  };

  const toggleMic = () => {
    if (isMicActive) {
      setIsMicActive(false);
    } else {
      setIsMicActive(true);
    }
  };

  const handleRefineCodexEntry = async () => {
    if (isRefiningCodexEntry || !newCodexEntry.title || !newCodexEntry.content) return;
    const refined = await refineCodexEntryHook(newCodexEntry);
    if (refined) {
      setNewCodexEntry(refined);
    }
  };

  const handleUpdateVoice = (updates: Partial<CharacterProfile>) => {
    onUpdateProfile({ ...profile, ...updates });
  };

  const pinnedCount = useMemo(() => messages.filter(m => m.isPinned).length, [messages]);

  return (
    <div className="flex flex-col h-full max-w-6xl mx-auto glass-panel rounded-[2rem] overflow-hidden shadow-2xl border border-white/5">
      {/* Header - fixed: LIVE VOICE cut off on mobile due to overflow-hidden + flex no-wrap */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-8 sm:py-5 border-b border-white/5 bg-black/20 backdrop-blur-xl min-w-0">
        <div className="flex items-center gap-2 sm:gap-5 min-w-0 flex-1">
          <div
            onClick={onEditCharacter}
            className={`relative w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 shadow-lg hover:scale-105 ${
              liveVoice.isActive
                ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-black animate-pulse shadow-emerald-500/30'
                : profile.currentMood?.toLowerCase().includes('angry') || profile.currentMood?.toLowerCase().includes('gritty')
                ? 'ring-2 ring-red-500/70 ring-offset-1 ring-offset-black shadow-red-500/20'
                : profile.currentMood?.toLowerCase().includes('flirt') || profile.currentMood?.toLowerCase().includes('romantic')
                ? 'ring-2 ring-pink-500/70 ring-offset-1 ring-offset-black shadow-pink-500/20'
                : profile.currentMood?.toLowerCase().includes('mysterious')
                ? 'ring-2 ring-purple-500/70 ring-offset-1 ring-offset-black shadow-purple-500/20'
                : profile.currentMood?.toLowerCase().includes('happy') || profile.currentMood?.toLowerCase().includes('excited')
                ? 'ring-2 ring-amber-400/70 ring-offset-1 ring-offset-black shadow-amber-400/20'
                : 'ring-1 ring-white/20 border border-white/10'
            }`}
            title="Click to view & edit Character Profile"
          >
            <img src={avatarBase64} alt={profile.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm sm:text-xl font-bold text-white font-serif tracking-tight leading-tight truncate min-w-0">{profile.name}</h3>
              <div className={`px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 flex items-center gap-1 ${
                profile.mode === AppMode.SCENARIO ? 'border-blue-500/20 bg-blue-500/10' :
                profile.mode === AppMode.GAME ? 'border-purple-500/20 bg-purple-500/10' :
                profile.mode === AppMode.NARRATIVE ? 'border-amber-500/20 bg-amber-500/10' :
                'border-pink-500/20 bg-pink-500/10'
              }`}>
                {profile.mode === AppMode.SCENARIO
                  ? <Globe className="w-2 h-2 sm:w-2.5 sm:h-2.5 text-blue-400" />
                  : profile.mode === AppMode.GAME
                  ? <Swords className="w-2 h-2 sm:w-2.5 sm:h-2.5 text-purple-400" />
                  : profile.mode === AppMode.NARRATIVE
                  ? <BookOpen className="w-2 h-2 sm:w-2.5 sm:h-2.5 text-amber-400" />
                  : <Heart className="w-2 h-2 sm:w-2.5 sm:h-2.5 text-pink-400" />}
                <span className={`text-[8px] font-bold uppercase tracking-tighter ${
                  profile.mode === AppMode.SCENARIO ? 'text-blue-400' :
                  profile.mode === AppMode.GAME ? 'text-purple-400' :
                  profile.mode === AppMode.NARRATIVE ? 'text-amber-400' :
                  'text-pink-400'
                }`}>{profile.mode}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 mt-1">
              <div className="flex items-center gap-2 text-[8px] sm:text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">
                <span className="text-emerald-500/80">{profile.storyTone}</span>
                {profile.currentMood && (
                  <>
                    <span className="w-0.5 h-0.5 sm:w-1 sm:h-1 bg-zinc-800 rounded-full" />
                    <span className="text-amber-400/80">MOOD: {profile.currentMood}</span>
                  </>
                )}
              </div>
              
              <div className="hidden sm:flex items-center gap-3 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5 w-fit">
                <div className="flex flex-col">
                  <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest leading-none mb-1">
                    {profile.mode === AppMode.SCENARIO ? "Protagonist's Role" : profile.mode === AppMode.GAME ? "Party's Reputation" : profile.mode === AppMode.NARRATIVE ? "Narrative Style" : "Relationship"}
                  </span>
                  <span className="text-xs font-bold text-white leading-none">{profile.relationship || (profile.mode === AppMode.NARRATIVE ? 'Literary Prose' : 'Neutral')}</span>
                </div>
                {profile.mode === AppMode.GAME ? (
                  <div className="w-24 sm:w-32 flex flex-col gap-1 ml-2 border-l border-white/10 pl-3">
                    <div className="flex justify-between text-[8px] font-bold text-zinc-500 leading-none">
                      <span>LEVEL</span>
                      <span>{profile.playerProfile?.level || 1}</span>
                    </div>
                    <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden relative">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, ((profile.playerProfile?.xp || 0) % 100))}%` }}
                        className="absolute inset-y-0 left-0 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]"
                      />
                    </div>
                  </div>
                ) : profile.mode === AppMode.ROLEPLAY ? (
                  <div className="w-24 sm:w-32 flex flex-col gap-1 ml-2 border-l border-white/10 pl-3">
                    <div className="flex justify-between text-[8px] font-bold text-zinc-500 leading-none">
                      <span>AFFINITY</span>
                      <span>{getRelationshipPercentage(profile.relationship)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden relative">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${getRelationshipPercentage(profile.relationship)}%` }}
                        className={`absolute inset-y-0 left-0 rounded-full ${
                          profile.relationship.toLowerCase().includes('enemy') ? 'bg-red-500' :
                          profile.relationship.toLowerCase().includes('rival') ? 'bg-amber-500' :
                          profile.relationship.toLowerCase().includes('lover') ? 'bg-pink-500' :
                          'bg-emerald-500'
                        } shadow-[0_0_8px_rgba(16,185,129,0.3)]`}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:gap-2 shrink-0 justify-end max-w-full">
          <div className="hidden sm:flex items-center gap-3 mr-2 shrink-0">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/30 border border-white/5" title="Estimated Context Tokens">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Tokens</span>
              <span className="text-xs font-mono text-zinc-300">{estimateTokens.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/30 border border-white/5" title="Cloud Sync Status">
              {isSaving ? (
                <Cloud className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
              ) : (
                <Cloud className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                {isSaving ? 'Saving' : 'Saved'}
              </span>
            </div>
          </div>
          <button
            onClick={handleExportScenario}
            className="p-2 rounded-xl text-zinc-500 hover:text-emerald-400 hover:bg-white/5 transition-all hidden sm:block"
            title="Export Scenario"
          >
            <Download className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          {/* World Codex */}
          <button
            onClick={() => setShowCodex(!showCodex)}
            className={`p-2 rounded-xl transition-all relative ${showCodex ? 'bg-emerald-500/20 text-emerald-400' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
            title="World Codex"
          >
            <Book className="w-4 h-4 sm:w-5 sm:h-5" />
            {codexEntries.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-emerald-500 text-black text-[9px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center">
                {codexEntries.length}
              </span>
            )}
          </button>

          {/* Pinned Moments */}
          <button
            onClick={() => setShowPinnedPanel(!showPinnedPanel)}
            className={`p-2 rounded-xl transition-all relative ${showPinnedPanel ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-400 hover:text-amber-400 hover:bg-white/5'}`}
            title="Pinned Moments"
          >
            <Pin className="w-4 h-4 sm:w-5 sm:h-5" />
            {pinnedCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-amber-500 text-black text-[9px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center">
                {pinnedCount}
              </span>
            )}
          </button>

          {/* Game Inventory */}
          {profile.mode === AppMode.GAME && (
            <button
              onClick={() => setShowInventory(!showInventory)}
              className={`p-2 rounded-xl transition-all relative ${showInventory ? 'bg-purple-500/20 text-purple-400' : 'text-zinc-400 hover:text-purple-300 hover:bg-white/5'}`}
              title="Inventory"
            >
              <Package className="w-4 h-4 sm:w-5 sm:h-5" />
              {inventory.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-purple-500 text-white text-[9px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center">
                  {inventory.length}
                </span>
              )}
            </button>
          )}

          {/* Zen Mode Toggle (non-game modes) */}
          {profile.mode !== AppMode.GAME && (
            <button
              onClick={() => setIsZenMode(z => !z)}
              className={`p-2 rounded-xl transition-all ${
                isZenMode ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 shadow-sm' : 'text-zinc-400 hover:text-indigo-400 hover:bg-white/5'
              }`}
              title={isZenMode ? "Exit Zen Cinematic Mode" : "Zen Cinematic Mode (Fullscreen Reader)"}
              aria-label="Zen Mode"
            >
              {isZenMode ? <EyeOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Eye className="w-4 h-4 sm:w-5 sm:h-5" />}
            </button>
          )}



          {/* Voice & Tone Studio Button */}
          <button
            onClick={() => setShowVoiceSettings(!showVoiceSettings)}
            className={`p-2 rounded-xl transition-all ${
              showVoiceSettings ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm' : 'text-zinc-400 hover:text-emerald-400 hover:bg-white/5'
            }`}
            title="Voice & Tone Studio"
            aria-label="Voice & Tone Studio"
          >
            <Settings2 className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Story Tools Dropdown Menu */}
          <div className="relative">
            <button
              onClick={() => setShowStoryMenu(!showStoryMenu)}
              className={`p-2 rounded-xl transition-all ${showStoryMenu ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
              title="Story & Character Options"
            >
              <MoreVertical className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <AnimatePresence>
              {showStoryMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.95 }}
                  className="absolute right-0 mt-2 w-56 glass-panel p-2 rounded-2xl shadow-2xl border border-white/10 z-50 space-y-1 bg-zinc-950/95 backdrop-blur-xl"
                >
                  <button
                    onClick={() => {
                      setShowStoryMenu(false);
                      onEditCharacter();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
                  >
                    <Edit3 className="w-4 h-4 text-blue-400" />
                    <span>Edit Character Profile</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowStoryMenu(false);
                      setShowAddCharacter(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
                  >
                    <UserPlus className="w-4 h-4 text-emerald-400" />
                    <span>Add Companion NPC</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowStoryMenu(false);
                      setShowModeDetails(!showModeDetails);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
                  >
                    <Compass className="w-4 h-4 text-amber-400" />
                    <span>Atmosphere & Stakes Details</span>
                  </button>

                  <div className="h-px bg-white/5 my-1" />

                  <button
                    onClick={() => {
                      setShowStoryMenu(false);
                      onCarryOver();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:text-blue-400 hover:bg-blue-500/10 rounded-xl transition-colors"
                  >
                    <Repeat className="w-4 h-4 text-purple-400" />
                    <span>Carry Over to New Story</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Mode Details Floating Modal if opened from Story Menu */}
          <AnimatePresence>
            {showModeDetails && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute right-0 top-14 w-72 glass-panel p-4 rounded-2xl shadow-2xl border border-white/10 z-50 space-y-3 bg-zinc-950/95 backdrop-blur-2xl"
              >
                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-emerald-400" />
                    Narrative Details
                  </span>
                  <button onClick={() => setShowModeDetails(false)} className="text-zinc-500 hover:text-white text-xs">
                    ✕
                  </button>
                </div>
                {profile.mode === AppMode.SCENARIO && (
                  <div className="space-y-2 text-xs">
                    <div>
                      <h4 className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Atmosphere</h4>
                      <p className="text-zinc-300">{profile.worldAtmosphere || 'Not specified'}</p>
                    </div>
                    <div>
                      <h4 className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Current Stakes</h4>
                      <p className="text-zinc-300">{profile.scenarioStakes || 'Not specified'}</p>
                    </div>
                    <div>
                      <h4 className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Core Conflict</h4>
                      <p className="text-zinc-300">{profile.scenarioConflict || 'Not specified'}</p>
                    </div>
                  </div>
                )}
                {profile.mode === AppMode.ROLEPLAY && (
                  <div className="space-y-2 text-xs">
                    <div>
                      <h4 className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Flaws</h4>
                      <p className="text-zinc-300">{profile.characterFlaws || 'None specified'}</p>
                    </div>
                    <div>
                      <h4 className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Secret Motive</h4>
                      <p className="text-zinc-300">{profile.secretMotive || 'None specified'}</p>
                    </div>
                  </div>
                )}
                {profile.mode === AppMode.GAME && (
                  <div className="space-y-2 text-xs">
                    <div>
                      <h4 className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">Quest Objective</h4>
                      <p className="text-zinc-300">{profile.questObjective || 'Not specified'}</p>
                    </div>
                    <div>
                      <h4 className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">DM Style</h4>
                      <p className="text-zinc-300">{profile.dungeonMasterStyle || profile.personality || 'Not specified'}</p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Primary Voice Call Button */}
          <button
            onClick={() => {
              const voiceMode = getSettings().voiceMode || 'live';
              if (voiceMode === 'voice_chat' || voiceMode === 'tts') {
                setShowVoiceChat(v => !v);
                if (liveVoice.isActive) liveVoice.stop();
              } else {
                startLiveVoiceSession();
              }
            }}
            className={`px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-[10px] sm:text-xs font-bold flex items-center gap-2 shrink-0 whitespace-nowrap transition-all ${
              liveVoice.isActive || showVoiceChat
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-lg shadow-emerald-500/10'
                : 'glass-input text-zinc-300 hover:text-white hover:border-white/20'
            }`}
            title={getSettings().voiceMode === 'voice_chat' || getSettings().voiceMode === 'tts' ? 'Voice Chat (STT + TTS)' : 'Live Voice (Real-time Spoken Conversation with Gemini)'}
            aria-label="Toggle Voice"
          >
            {liveVoice.isActive || showVoiceChat ? (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-emerald-400 font-bold">
                  {liveVoice.isConnecting ? 'CONNECTING...' : showVoiceChat ? 'VOICE CHAT' : 'LIVE CALL'}
                </span>
              </div>
            ) : (
              <>
                <Radio className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400" />
                <span>{getSettings().voiceMode === 'voice_chat' || getSettings().voiceMode === 'tts' ? 'VOICE CHAT' : 'LIVE VOICE'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Inventory Sidebar */}
        <AnimatePresence>
          {showInventory && profile.mode === AppMode.GAME && (
            <ErrorBoundary fallbackTitle="Inventory Error" onReset={() => setShowInventory(false)}>
              <InventorySidebar
                inventory={inventory}
                messages={messages}
                setShowInventory={setShowInventory}
                isAutoInventoryEnabled={isAutoInventoryEnabled}
                setIsAutoInventoryEnabled={setIsAutoInventoryEnabled}
                isScanningInventory={isScanningInventory}
                handleAutoUpdateInventory={handleAutoUpdateInventory}
                isGeneratingItemImage={isGeneratingItemImage}
                handleGenerateItemImage={handleGenerateItemImage}
                addOrUpdateItem={addOrUpdateItem}
                removeItem={removeItem}
              />
            </ErrorBoundary>
          )}
        </AnimatePresence>

        {/* Codex Sidebar */}
        <AnimatePresence>
          {showCodex && (
            <ErrorBoundary fallbackTitle="Codex Error" onReset={() => setShowCodex(false)}>
              <CodexSidebar
                codexEntries={codexEntries}
                setCodexEntries={setCodexEntries}
                messages={messages}
                setShowCodex={setShowCodex}
                isAutoProfileEnabled={isAutoProfileEnabled}
                setIsAutoProfileEnabled={setIsAutoProfileEnabled}
                isAutoCodexEnabled={isAutoCodexEnabled}
                setIsAutoCodexEnabled={setIsAutoCodexEnabled}
                isAutoPopulatingCodex={isAutoPopulatingCodex}
                handleAutoPopulateCodex={handleAutoPopulateCodex}
                isUpdatingProfile={isUpdatingProfile}
                handleAutoUpdateProfile={handleAutoUpdateProfile}
                isRefiningCodexEntry={isRefiningCodexEntry}
                handleRefineCodexEntry={handleRefineCodexEntry}
                isGeneratingCodexImage={isGeneratingCodexImage}
                handleGenerateCodexImage={handleGenerateCodexImage}
                newCodexEntry={newCodexEntry}
                setNewCodexEntry={setNewCodexEntry}
                setConfirmModal={setConfirmModal}
              />
            </ErrorBoundary>
          )}
        </AnimatePresence>

        {/* Voice & Tone Studio Sidebar */}
        <AnimatePresence>
          {showVoiceSettings && (
            <ErrorBoundary fallbackTitle="Voice Studio Error" onReset={() => setShowVoiceSettings(false)}>
              <VoiceStudioSidebar
                profile={profile}
                isOpen={showVoiceSettings}
                onClose={() => setShowVoiceSettings(false)}
                onUpdateVoice={handleUpdateVoice}
                onPreview={(sampleText, vName) => handleReadAloud(sampleText, vName ? { ...profile, voiceName: vName } : profile)}
              />
            </ErrorBoundary>
          )}
        </AnimatePresence>

        <AdditionalCharacterModal
          isOpen={showAddCharacter}
          onClose={() => setShowAddCharacter(false)}
          onSave={(character) => {
            const updatedProfile = {
              ...profile,
              additionalCharacters: [...(profile.additionalCharacters || []), character]
            };
            onUpdateProfile(updatedProfile);
            setShowAddCharacter(false);
          }}
          appMode={profile.mode}
        />

        <div className="flex-1 flex flex-col relative bg-black/10 min-h-0">
          <AnimatePresence>
            {showPinnedPanel && (
              <PinnedMessagesPanel
                messages={messages}
                mode={profile.mode}
                onJumpTo={handleJumpToMessage}
                onTogglePin={handleTogglePin}
                onClose={() => setShowPinnedPanel(false)}
              />
            )}
          </AnimatePresence>

          {/* Floating Zen Mode Exit Button */}
          {isZenMode && (
            <button
              onClick={() => setIsZenMode(false)}
              className="absolute top-4 right-4 z-40 px-3 py-1.5 rounded-xl bg-black/60 hover:bg-black/80 border border-white/20 text-xs font-bold text-white flex items-center gap-2 backdrop-blur-md transition-all shadow-xl"
              title="Exit Zen Mode"
            >
              <EyeOff className="w-3.5 h-3.5 text-indigo-400" />
              <span>Exit Zen Mode</span>
            </button>
          )}

          {/* Avatar Display - Hidden in Zen Mode */}
          {!isZenMode && (
            <div className="h-48 sm:h-64 border-b border-white/5 relative bg-black/20 flex items-center justify-center overflow-hidden shrink-0">
              <motion.img
                initial={{ opacity: 0, scale: 1.1 }}
                animate={{ opacity: 1, scale: 1 }}
                src={avatarBase64}
                alt={profile.name}
                className="w-full h-full object-cover opacity-20 blur-2xl"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }} 
                  animate={{ 
                    opacity: 1, 
                    y: 0, 
                    ...getMoodEffects().animate
                  }} 
                  transition={{
                    duration: 4,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  className="relative group"
                >
                  <img 
                    src={avatarBase64} 
                    alt={profile.name} 
                    className="h-40 w-40 sm:h-52 sm:w-52 object-cover rounded-3xl shadow-2xl border border-white/10 relative z-10 transition-all duration-1000" 
                    style={{ filter: getMoodEffects().filter }}
                    referrerPolicy="no-referrer" 
                  />
                  
                  {/* Loading overlay for Avatar Update */}
                  <AnimatePresence>
                    {isUpdatingAvatar && (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-20 bg-black/60 backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center border border-emerald-500/30"
                      >
                        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mb-2" />
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Updating Avatar...</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto pt-8 pb-4 px-4 sm:pt-12 sm:pb-8 sm:px-8 space-y-8 scroll-smooth custom-scrollbar">
            {!isLoaded ? (
              <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-4">
                <Loader2 className="w-8 h-8 animate-spin opacity-50 text-emerald-500" />
                <p className="text-sm font-serif italic tracking-wide">Loading narrative...</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-6 py-16">
                {profile.mode === AppMode.ROLEPLAY && (
                  <>
                    <Heart className="w-12 h-12 opacity-20 text-pink-400" />
                    <div className="text-center space-y-2">
                      <p className="text-lg font-serif italic tracking-wide text-zinc-300">
                        {profile.name} is waiting...
                      </p>
                      <p className="text-sm text-zinc-500 max-w-sm mx-auto">
                        Have the AI generate an opening message to set the scene, or send your own message below to start.
                      </p>
                    </div>
                  </>
                )}
                {profile.mode === AppMode.SCENARIO && (
                  <>
                    <Globe className="w-12 h-12 opacity-20 text-blue-400" />
                    <div className="text-center space-y-2">
                      <p className="text-lg font-serif italic tracking-wide text-zinc-300">
                        The world holds its breath...
                      </p>
                      <p className="text-sm text-zinc-500 max-w-sm mx-auto">
                        Have the AI describe the opening scene, or describe what your character does to begin.
                      </p>
                    </div>
                  </>
                )}
                {profile.mode === AppMode.GAME && (
                  <>
                    <Swords className="w-12 h-12 opacity-20 text-purple-400" />
                    <div className="text-center space-y-2">
                      <p className="text-lg font-serif italic tracking-wide text-zinc-300">
                        Your adventure awaits, {profile.playerProfile?.name || 'adventurer'}...
                      </p>
                      <p className="text-sm text-zinc-500 max-w-sm mx-auto">
                        Have the DM explain the rules and set the scene for your adventure, or take the initiative.
                      </p>
                    </div>
                  </>
                )}
                {profile.mode === AppMode.NARRATIVE && (
                  <>
                    <BookOpen className="w-12 h-12 opacity-20 text-amber-400" />
                    <div className="text-center space-y-2">
                      <p className="text-lg font-serif italic tracking-wide text-zinc-300">
                        The blank page awaits...
                      </p>
                      <p className="text-sm text-zinc-500 max-w-sm mx-auto">
                        Generate an evocative opening chapter to establish the prose and world, or begin writing below.
                      </p>
                    </div>
                  </>
                )}
                <button
                  onClick={handleGenerateOpening}
                  disabled={isTyping}
                  className="mt-4 px-8 py-4 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30 rounded-2xl font-bold uppercase tracking-widest text-xs transition-all shadow-[0_0_20px_rgba(16,185,129,0.1)] hover:shadow-[0_0_30px_rgba(16,185,129,0.2)] flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  {profile.mode === AppMode.GAME ? 'Start Session Zero' : 'Generate Opening'}
                </button>
              </div>
            ) : (
              messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  mode={profile.mode}
                  isEditing={editingMessageId === msg.id}
                  editInput={editInput}
                  onEditInputChange={setEditInput}
                  onEditSave={() => saveEdit(msg.id)}
                  onEditCancel={cancelEditing}
                  isRegenerating={regeneratingMessageId === msg.id}
                  rerollGuidance={rerollGuidance}
                  onRerollGuidanceChange={setRerollGuidance}
                  onRegenerate={() => handleRegenerate(msg.id, rerollGuidance)}
                  onCancelRegenerate={() => { setRegeneratingMessageId(null); setRerollGuidance(''); }}
                  onRewind={() => handleRewind(msg.id)}
                  onEdit={() => startEditing(msg)}
                  onReadAloud={() => {
                    const { mainText } = parseMessageContent(msg.text, msg.role);
                    handleReadAloud(mainText, profile, msg.id);
                  }}
                  onRegenerateStart={() => setRegeneratingMessageId(msg.id)}
                  onBranch={() => handleBranch(msg.id)}
                  onSwitchVersion={(index) => handleSwitchVersion(msg.id, index)}
                  onDeleteVersion={(index) => handleDeleteVersion(msg.id, index)}
                  onBranchVersion={(index) => handleBranchVersion(msg.id, index)}
                  onTogglePin={() => handleTogglePin(msg.id)}
                  isStreaming={false}
                  searchHighlighted={false}
                  flashHighlight={flashHighlightId === msg.id}
                  density="comfy"
                  activeProvider={getSettings().activeTextProvider}
                  isSpeaking={speakingMessageId === msg.id}
                  currentSegment={currentSegment}
                  totalSegments={totalSegments}
                  onStopAudio={stopAudio}
                />
              ))
            )}
            {isTyping && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                <div className="glass-panel rounded-[1.5rem] rounded-tl-none px-6 py-4 flex items-center gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                  <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">
                    {profile.mode === AppMode.ROLEPLAY
                      ? profile.name.split(' ')[0] + ' is thinking...'
                      : profile.mode === AppMode.SCENARIO
                      ? 'The story unfolds...'
                      : 'The DM is deciding...'}
                  </span>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Audio Controls Overlay */}
          <AnimatePresence>
            {isPlaying && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="absolute bottom-32 left-1/2 -translate-x-1/2 glass-panel px-4 sm:px-6 py-3 sm:py-4 rounded-[2rem] flex flex-col gap-3 shadow-2xl border border-emerald-500/20 z-20 w-[90%] max-w-md"
              >
                <div className="flex items-center gap-4 sm:gap-6 justify-center">
                  <div className="flex items-center gap-2 text-emerald-500 animate-pulse">
                    <Volume2 className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">
                      Narrating {totalSegments > 1 ? `(${currentSegment + 1}/${totalSegments})` : ''}...
                    </span>
                  </div>
                  <button 
                    onClick={togglePause} 
                    className="w-10 h-10 sm:w-12 sm:h-12 bg-emerald-600 hover:bg-emerald-500 rounded-full flex items-center justify-center text-white transition-all shadow-lg shadow-emerald-900/20"
                  >
                    <Pause className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>
                  <button onClick={stopAudio} className="text-zinc-400 hover:text-red-400 transition-colors" title="Stop">
                    <CloseIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input Area - Hidden in Zen Mode */}
          {!isZenMode && (
            <div className="p-4 sm:p-6 bg-black/20 backdrop-blur-2xl border-t border-white/5">
            <ActionSuggestionsBar
              suggestions={suggestions}
              isLoading={isSuggesting}
              isOpen={showSuggestionsBar}
              onSelectSuggestion={handleSelectSuggestion}
              onRefresh={handleSuggest}
              onClose={() => setShowSuggestionsBar(false)}
            />

            <AnimatePresence>
              {showGuidedRefine && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden mb-4"
                >
                  <div className="glass-panel p-4 rounded-2xl border border-white/5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Guided Refinement</h4>
                      <button onClick={() => setShowGuidedRefine(false)} className="text-zinc-500 hover:text-white">
                        <CloseIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <textarea
                      value={refineGuidance}
                      onChange={(e) => setRefineGuidance(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleRefine(refineGuidance);
                        }
                      }}
                      placeholder="How should the AI change this? (e.g., 'Make it more aggressive', 'Focus on the environment')"
                      className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50 min-h-[80px] resize-y"
                      autoFocus
                    />
                    <div className="flex flex-wrap gap-2">
                      {['More descriptive', 'More concise', 'More aggressive', 'More polite', 'Add sensory details'].map((chip) => (
                        <button
                          key={chip}
                          onClick={() => {
                            setRefineGuidance(chip);
                            handleRefine(chip);
                          }}
                          className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-[10px] text-zinc-400 hover:text-white transition-all"
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-4">
                        <p className="text-xs text-zinc-500">Press Enter to apply.</p>
                        <button
                          onClick={handleSuggest}
                          disabled={isSuggesting}
                          className="text-[10px] font-bold text-zinc-500 hover:text-emerald-400 flex items-center gap-1 transition-colors"
                          title="Get a completely new suggestion"
                        >
                          {isSuggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          REGENERATE
                        </button>
                      </div>
                      <button
                        onClick={() => handleRefine(refineGuidance)}
                        disabled={!refineGuidance.trim() || isRefining}
                        className="px-4 py-2 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-2"
                      >
                        {isRefining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                        Apply
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-2 sm:gap-3 mb-4 px-2">
              <button
                onClick={() => {
                  if (input.startsWith('*') && input.endsWith('*')) setInput(input.slice(1, -1));
                  else setInput(`*${input}*`);
                }}
                title="Format text as an action (wraps in asterisks)"
                className={`text-[9px] sm:text-[10px] font-bold px-2 sm:px-3 py-1 rounded-lg border transition-all tracking-widest ${
                  input.startsWith('*') && input.endsWith('*')
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : 'glass-input text-zinc-500 border-transparent hover:text-zinc-300'
                }`}
              >
                {profile.mode === AppMode.ROLEPLAY ? 'FEELING' : profile.mode === AppMode.GAME ? 'EMOTE' : 'ACTION'}
              </button>
              {input.trim().length > 0 && (
                <div className="flex items-center">
                  <button
                    onClick={() => handleRefine()}
                    disabled={isRefining}
                    title="Let AI polish your draft before sending"
                    className={`text-[9px] sm:text-[10px] font-bold px-2 sm:px-3 py-1 rounded-l-lg border-y border-l transition-all tracking-widest flex items-center gap-1 sm:gap-2 ${
                      isRefining ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20 shadow-sm'
                    }`}
                  >
                    {isRefining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                    REFINE
                  </button>
                  <button
                    onClick={() => setShowGuidedRefine(!showGuidedRefine)}
                    className={`text-[9px] sm:text-[10px] font-bold px-2 py-1 rounded-r-lg border-y border-r transition-all tracking-widest flex items-center ${
                      showGuidedRefine ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                    }`}
                    title="Guided Refinement"
                  >
                    <Edit3 className="w-3 h-3" /><span className="hidden sm:inline">GUIDED</span>
                  </button>
                </div>
              )}
              <button
                onClick={handleSuggest}
                disabled={isSuggesting}
                title="Suggest next actions (Ctrl+Space / Alt+S)"
                className={`text-[9px] sm:text-[10px] font-bold px-2 sm:px-3 py-1 rounded-lg border transition-all tracking-widest flex items-center gap-1 sm:gap-2 ${
                  isSuggesting ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'glass-input text-zinc-500 border-transparent hover:text-emerald-400'
                }`}
              >
                {isSuggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {profile.mode === AppMode.ROLEPLAY ? 'SUGGEST DIALOGUE' : profile.mode === AppMode.GAME ? 'SUGGEST MOVE' : profile.mode === AppMode.NARRATIVE ? 'SUGGEST PROSE' : 'SUGGEST ACTION'}
                <kbd className="hidden md:inline text-[8px] bg-white/10 px-1 py-0.2 rounded text-zinc-400 font-mono">^Space</kbd>
              </button>
              <button
                onClick={() => setShowSessionInstructions(!showSessionInstructions)}
                title="Session-Level Custom LLM Instructions (live nudges, formatting, brevity)"
                className={`text-[9px] sm:text-[10px] font-bold px-2 sm:px-3 py-1 rounded-lg border transition-all tracking-widest flex items-center gap-1 sm:gap-2 ${
                  sessionInstructions.trim() || showSessionInstructions
                    ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                    : 'glass-input text-zinc-500 border-transparent hover:text-blue-400'
                }`}
              >
                <Terminal className="w-3 h-3" />
                SESSION
              </button>
              {profile.mode === AppMode.GAME && (
                <div className="flex items-center gap-1">
                  {(['d4','d6','d8','d10','d12','d20'] as const).map(die => (
                    <button
                      key={die}
                      onClick={() => {
                        const sides = parseInt(die.slice(1));
                        const result = Math.floor(Math.random() * sides) + 1;
                        setInput(prev => prev ? `${prev} [Rolled ${die}: ${result}]` : `[Rolled ${die}: ${result}]`);
                      }}
                      className="text-[9px] font-bold px-1.5 py-1 rounded-lg glass-input text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 hover:border-purple-500/40 transition-all tracking-widest"
                      title={`Roll ${die}`}
                    >
                      {die.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setIsAutoRead(!isAutoRead)}
                className={`text-[9px] sm:text-[10px] font-bold px-2 sm:px-3 py-1 rounded-lg border transition-all tracking-widest flex items-center gap-1 sm:gap-2 ${
                  isAutoRead ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'glass-input text-zinc-500 border-transparent hover:text-zinc-300'
                }`}
                title="Automatically read AI responses aloud"
              >
                {isAutoRead ? <Volume2 className="w-3 h-3 text-emerald-400" /> : <VolumeX className="w-3 h-3" />}
                AUTO-READ
              </button>
              <button
                onClick={toggleLiveMode}
                className={`text-[9px] sm:text-[10px] font-bold px-2 sm:px-3 py-1 rounded-lg border transition-all tracking-widest flex items-center gap-1 sm:gap-2 ${
                  isLiveMode
                    ? 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse'
                    : 'glass-input text-zinc-500 border-transparent hover:text-zinc-300'
                }`}
                title="Speech-to-Text Dictation (transcribes directly into input)"
              >
                {isLiveMode ? <Mic className="w-3 h-3 text-red-400 animate-pulse" /> : <MicOff className="w-3 h-3" />}
                {isLiveMode ? 'DICTATING' : 'DICTATE'}
              </button>
              <div className="text-[8px] sm:text-[10px] text-zinc-600 uppercase tracking-[0.2em] font-bold ml-auto hidden sm:block">
                Playing as: <span className="text-zinc-400">{profile.playerProfile?.name || 'The Protagonist'}</span>
              </div>
            </div>

            {/* Live Session Instructions Panel */}
            <AnimatePresence>
              {showSessionInstructions && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-3 px-2 overflow-hidden"
                >
                  <div className="glass-panel p-3 rounded-2xl border border-blue-500/20 bg-black/50 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest flex items-center gap-1.5">
                        <Terminal className="w-3 h-3" />
                        Session-Level Custom LLM Instructions
                      </span>
                      <button
                        onClick={() => setShowSessionInstructions(false)}
                        className="text-zinc-500 hover:text-white text-xs"
                      >
                        ✕
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={sessionInstructions}
                      onChange={e => setSessionInstructions(e.target.value)}
                      placeholder="Live formatting / style preferences: e.g. 'Narrate in third person', 'Keep descriptions brief', 'Avoid repeating user dialogue'..."
                      className="w-full p-2.5 bg-black/40 border border-white/10 rounded-xl text-zinc-200 text-xs font-mono resize-none focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-end gap-2 sm:gap-3">
              {error && (
                <div className="absolute -top-10 left-0 right-0 bg-red-500/20 border border-red-500/30 text-red-400 text-[10px] px-3 py-1 rounded-lg backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2">
                  {error}
                  <button onClick={() => setError(null)} className="ml-2 hover:text-white">×</button>
                </div>
              )}
              {isLiveMode && (
                <button
                  title={isMicActive ? 'Mute Microphone' : 'Unmute Microphone'}                   onClick={toggleMic}
                  className={`p-3 sm:p-4 rounded-2xl transition-all shadow-lg ${
                    isMicActive ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'glass-input text-zinc-500 hover:text-white'
                  }`}
                >
                  {isMicActive ? <Mic className="w-5 h-5 sm:w-6 sm:h-6" /> : <MicOff className="w-5 h-5 sm:w-6 sm:h-6" />}
                </button>
              )}
              <div className="flex-1 flex flex-col gap-2 relative group">
                {showLeaveWarning && (
                  <div className="absolute -top-14 left-0 right-0 bg-red-500/10 border border-red-500/20 rounded-xl p-2 flex items-center justify-between z-10 backdrop-blur-md">
                    <span className="text-xs text-red-400 font-medium px-2">You have an unsaved message. Leave anyway?</span>
                    <div className="flex gap-2">
                      <button onClick={handleCancelLeave} className="px-3 py-1 text-xs text-zinc-400 hover:text-white transition-colors">No</button>
                      <button onClick={handleConfirmLeave} className="px-3 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors">Yes</button>
                    </div>
                  </div>
                )}
                <div className="relative">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
                        e.preventDefault();
                        handleSuggest();
                        return;
                      }
                      if (e.altKey && (e.key === 's' || e.key === 'S')) {
                        e.preventDefault();
                        handleSuggest();
                        return;
                      }
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendText();
                      }
                    }}
                    placeholder={isLiveMode ? "Type or speak..." : "Type a message, or press Ctrl+Space to suggest actions..."}
                    className={`w-full glass-input rounded-2xl px-4 sm:px-6 py-3 sm:py-4 text-sm sm:text-base text-white placeholder-zinc-600 focus:ring-2 focus:ring-emerald-500/30 transition-all resize-none ${isInputExpanded ? 'h-64 sm:h-80' : 'h-[50px] max-h-40'}`}
                    rows={1}
                  />
                  <button 
                    onClick={() => setIsInputExpanded(!isInputExpanded)}
                    className="absolute right-3 top-3 p-1.5 text-zinc-600 hover:text-emerald-400 transition-colors"
                    title={isInputExpanded ? "Collapse" : "Expand"}
                  >
                    {isInputExpanded ? <SkipBack className="w-4 h-4 rotate-90" /> : <Repeat className="w-4 h-4 rotate-90" />}
                  </button>
                </div>
                <input
                  type="text"
                  value={directorNote}
                  onChange={(e) => setDirectorNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSendText(); } }}
                  placeholder={
                    profile.mode === AppMode.ROLEPLAY
                      ? "Whisper to the AI (e.g. 'Seem nervous', 'Reveal something small')"
                      : profile.mode === AppMode.SCENARIO
                      ? "Director's Note (e.g. 'Introduce a new character', 'Escalate the tension')"
                      : "DM Note (e.g. 'Make this harder', 'Add a hidden trap', 'NPC knows a secret')"
                  }
                  className="w-full glass-input rounded-xl px-4 py-2 text-xs text-zinc-300 placeholder-zinc-600 focus:ring-1 focus:ring-emerald-500/30 transition-all"
                />
              </div>
              {isTyping ? (
                <button
                  type="button"
                  title="Stop generating"
                  onClick={handleStopStreaming}
                  className="p-3 sm:p-4 bg-red-600 hover:bg-red-500 text-white rounded-2xl shadow-xl transition-all flex items-center justify-center animate-pulse"
                >
                  <Square className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  title="Send Message"
                  onClick={() => handleSendText()}
                  disabled={!input.trim() && !directorNote.trim()}
                  className="p-3 sm:p-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-2xl shadow-xl transition-all"
                >
                  <Send className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>
              )}
            </div>
          </div>
          )}
        </div>
      </div>
      {/* Dedicated Live Voice HUD */}
      <LiveVoiceHUD
        liveVoice={liveVoice}
        profile={profile}
        avatarBase64={avatarBase64}
        onUpdateProfile={handleUpdateVoice}
        onRewind={handleLiveRewind}
      />
      {/* Voice Chat Dialog — STT + TTS parity with Android */}
      <VoiceChatDialog
        isOpen={showVoiceChat}
        onClose={()=> setShowVoiceChat(false)}
        profile={profile}
        storySummary={storySummary}
        messages={messages}
        isStreaming={isTyping}
        onSendMessage={async (text)=> { await handleSendText(text); }}
      />

      {/* Confirmation Modal */}
  {createPortal(
    <AnimatePresence>
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-md glass-panel p-8 rounded-[2rem] border border-white/10 shadow-2xl"
          >
            <h3 className="text-2xl font-serif text-white mb-2">{confirmModal.title}</h3>
            <p className="text-zinc-400 mb-8 leading-relaxed">{confirmModal.message}</p>
            <div className="flex gap-4">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="flex-1 px-6 py-3 rounded-xl font-bold text-zinc-400 hover:text-white hover:bg-white/5 transition-all uppercase tracking-widest text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                className="flex-1 px-6 py-3 rounded-xl font-bold bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all uppercase tracking-widest text-xs border border-red-500/20"
              >
                Confirm
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )}
</div>
);
}
