import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Maximize2,
  Minimize2,
  ChevronUp,
  Sparkles,
  Zap,
  Square,
  Brain,
  Lightbulb,
  Cpu,
  Rocket,
  AlertTriangle,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider, TooltipSimple, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip-modern";
import { FilePicker } from "./FilePicker";
import { SlashCommandPicker } from "./SlashCommandPicker";
import { useInputBehavior } from "@/contexts/InputBehaviorContext";
import { ImagePreview } from "./ImagePreview";
import { type FileEntry, type SlashCommand } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// Whether we're running inside the Tauri webview (vs plain browser/web mode).
// NOTE: do NOT use `require(...)` here — in Vite's ESM bundle `require` is
// undefined and throws, which previously caused the drag-drop listener to be
// silently skipped. We dynamically `import()` the Tauri API where needed.
const isTauri = (): boolean =>
  typeof window !== 'undefined' && Boolean((window as any).__TAURI__);

interface FloatingPromptInputProps {
  /**
   * Callback when prompt is sent
   */
  onSend: (prompt: string, model: ModelId, use1MContext: boolean) => void;
  /**
   * Whether the input is loading
   */
  isLoading?: boolean;
  /**
   * Whether the input is disabled
   */
  disabled?: boolean;
  /**
   * Default model to select
   */
  defaultModel?: ModelId;
  /**
   * Project path for file picker
   */
  projectPath?: string;
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Callback when cancel is clicked (only during loading)
   */
  onCancel?: () => void;
  /**
   * Extra menu items to display in the prompt bar
   */
  extraMenuItems?: React.ReactNode;
  /**
   * Whether this input belongs to the currently active tab.
   * Only the active input handles drag-drop events to avoid duplicate
   * insertions when multiple tabs are mounted simultaneously.
   */
  isActive?: boolean;
  /**
   * Pre-fill the input with this text on first mount (draft restoration).
   */
  initialPrompt?: string;
  /**
   * Called whenever the draft changes so the parent can persist it.
   * Receives an empty string when the draft is cleared (e.g. after send).
   */
  onDraftChange?: (draft: string) => void;
  /**
   * Called whenever the fixed input bar changes height (px), so the parent
   * can update the message list's bottom padding to avoid content being
   * hidden under the bar.
   */
  onHeightChange?: (height: number) => void;
}

export interface FloatingPromptInputRef {
  addImage: (imagePath: string) => void;
}

/**
 * Thinking mode type definition
 */
type ThinkingMode = "auto" | "think" | "think_hard" | "think_harder" | "ultrathink";

/**
 * Thinking mode configuration
 */
type ThinkingModeConfig = {
  id: ThinkingMode;
  name: string;
  description: string;
  level: number; // 0-4 for visual indicator
  phrase?: string; // The phrase to append
  icon: React.ReactNode;
  color: string;
  shortName: string;
};

const THINKING_MODES: ThinkingModeConfig[] = [
  {
    id: "auto",
    name: "Auto",
    description: "Let Claude decide",
    level: 0,
    icon: <Sparkles className="h-3.5 w-3.5" />,
    color: "text-muted-foreground",
    shortName: "A"
  },
  {
    id: "think",
    name: "Think",
    description: "Basic reasoning",
    level: 1,
    phrase: "think",
    icon: <Lightbulb className="h-3.5 w-3.5" />,
    color: "text-primary",
    shortName: "T"
  },
  {
    id: "think_hard",
    name: "Think Hard",
    description: "Deeper analysis",
    level: 2,
    phrase: "think hard",
    icon: <Brain className="h-3.5 w-3.5" />,
    color: "text-primary",
    shortName: "T+"
  },
  {
    id: "think_harder",
    name: "Think Harder",
    description: "Extensive reasoning",
    level: 3,
    phrase: "think harder",
    icon: <Cpu className="h-3.5 w-3.5" />,
    color: "text-primary",
    shortName: "T++"
  },
  {
    id: "ultrathink",
    name: "Ultrathink",
    description: "Maximum computation",
    level: 4,
    phrase: "ultrathink",
    icon: <Rocket className="h-3.5 w-3.5" />,
    color: "text-primary",
    shortName: "Ultra"
  }
];

/**
 * ThinkingModeIndicator component - Shows visual indicator bars for thinking level
 */
const ThinkingModeIndicator: React.FC<{ level: number; color?: string }> = ({ level, color: _color }) => {
  const getBarColor = (barIndex: number) => {
    if (barIndex > level) return "bg-muted";
    return "bg-primary";
  };
  
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={cn(
            "w-1 h-3 rounded-full transition-all duration-200",
            getBarColor(i),
            i <= level && "shadow-sm"
          )}
        />
      ))}
    </div>
  );
};

export type ModelId = "sonnet" | "opus" | "haiku" | "opus-4-7";

type Model = {
  id: ModelId;
  /** The string actually passed to `--model`. Falls back to `id` if omitted. */
  modelParam?: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  shortName: string;
  color: string;
  highCost?: boolean;
};

const MODELS: Model[] = [
  {
    id: "sonnet",
    name: "Claude Sonnet 4.6",
    description: "Faster, efficient for most tasks",
    icon: <Zap className="h-3.5 w-3.5" />,
    shortName: "S4.6",
    color: "text-primary"
  },
  {
    id: "opus",
    name: "Claude Opus 4.6",
    description: "More capable, better for complex tasks",
    icon: <Sparkles className="h-3.5 w-3.5" />,
    shortName: "O4.6",
    color: "text-primary"
  },
  {
    id: "haiku",
    name: "Claude Haiku 4.5",
    description: "Fastest and most compact model",
    icon: <Zap className="h-3.5 w-3.5" />,
    shortName: "H4.5",
    color: "text-muted-foreground"
  },
  {
    id: "opus-4-7",
    modelParam: "global.anthropic.claude-opus-4-7",
    name: "Claude Opus 4.7",
    description: "Most powerful — significantly higher cost",
    icon: <Rocket className="h-3.5 w-3.5" />,
    shortName: "O4.7",
    color: "text-amber-500",
    highCost: true,
  },
];

/**
 * FloatingPromptInput component - Fixed position prompt input with model picker
 * 
 * @example
 * const promptRef = useRef<FloatingPromptInputRef>(null);
 * <FloatingPromptInput
 *   ref={promptRef}
 *   onSend={(prompt, model) => console.log('Send:', prompt, model)}
 *   isLoading={false}
 * />
 */
const FloatingPromptInputInner = (
  {
    onSend,
    isLoading = false,
    disabled = false,
    defaultModel = "sonnet",
    projectPath,
    className,
    onCancel,
    extraMenuItems,
    isActive = true,
    initialPrompt = "",
    onDraftChange,
    onHeightChange,
  }: FloatingPromptInputProps,
  ref: React.Ref<FloatingPromptInputRef>,
) => {
  const [prompt, setPromptRaw] = useState(initialPrompt);
  const onDraftChangeRef = useRef(onDraftChange);
  useEffect(() => { onDraftChangeRef.current = onDraftChange; }, [onDraftChange]);

  // Wraps every setPrompt call so the parent always receives the latest draft.
  const setPrompt = useCallback((value: string | ((prev: string) => string)) => {
    setPromptRaw(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      onDraftChangeRef.current?.(next);
      return next;
    });
  }, []);

  const [selectedModel, setSelectedModel] = useState<ModelId>(defaultModel ?? "sonnet");
  const [selectedThinkingMode, setSelectedThinkingMode] = useState<ThinkingMode>("auto");
  const [use1MContext, setUse1MContext] = useState(false);
  const [pendingHighCostAction, setPendingHighCostAction] = useState<null | "opus-4-7" | "1m-context">(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [thinkingModePickerOpen, setThinkingModePickerOpen] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [filePickerQuery, setFilePickerQuery] = useState("");
  const [showSlashCommandPicker, setShowSlashCommandPicker] = useState(false);
  const [slashCommandQuery, setSlashCommandQuery] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [embeddedImages, setEmbeddedImages] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const { autoCorrect } = useInputBehavior();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);
  const unlistenDragDropRef = useRef<(() => void) | null>(null);
  const [textareaHeight, setTextareaHeight] = useState<number>(48);
  const barRootRef = useRef<HTMLDivElement>(null);
  const onHeightChangeRef = useRef(onHeightChange);
  useEffect(() => { onHeightChangeRef.current = onHeightChange; }, [onHeightChange]);
  const isIMEComposingRef = useRef(false);
  // Cursor position at the moment composition starts, used to locate the
  // segment that was inserted by the IME so we can strip embedded spaces.
  const compositionStartPosRef = useRef(0);

  // Expose a method to add images programmatically
  React.useImperativeHandle(
    ref,
    () => ({
      addImage: (imagePath: string) => {
        const target = isExpandedRef.current
          ? expandedTextareaRef.current
          : textareaRef.current;
        const insertPos = target?.selectionStart ?? null;

        setPrompt(currentPrompt => {
          const existingPaths = extractImagePaths(currentPrompt);
          if (existingPaths.includes(imagePath)) {
            return currentPrompt; // Image already added
          }

          const mention = imagePath.includes(' ') ? `@"${imagePath}"` : `@${imagePath}`;
          const pos = insertPos ?? currentPrompt.length;
          const before = currentPrompt.substring(0, pos);
          const after = currentPrompt.substring(pos);
          const needsLeadingSpace = before.length > 0 && !before.endsWith(' ');
          const insertText = (needsLeadingSpace ? ' ' : '') + mention + ' ';
          const newPrompt = before + insertText + after;
          const newCursorPos = pos + insertText.length;

          setTimeout(() => {
            const t = isExpandedRef.current
              ? expandedTextareaRef.current
              : textareaRef.current;
            t?.focus();
            t?.setSelectionRange(newCursorPos, newCursorPos);
          }, 0);

          return newPrompt;
        });
      }
    }),
    [] // isExpandedRef is a stable ref, no deps needed
  );

  // Helper function to check if a file is an image
  const isImageFile = (path: string): boolean => {
    // Check if it's a data URL
    if (path.startsWith('data:image/')) {
      return true;
    }
    // Otherwise check file extension
    const ext = path.split('.').pop()?.toLowerCase();
    return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext || '');
  };

  // Extract image paths from prompt text
  const extractImagePaths = (text: string): string[] => {
    console.log('[extractImagePaths] Input text length:', text.length);
    
    // Updated regex to handle both quoted and unquoted paths
    // Pattern 1: @"path with spaces or data URLs" - quoted paths
    // Pattern 2: @path - unquoted paths (continues until @ or end)
    const quotedRegex = /@"([^"]+)"/g;
    const unquotedRegex = /@([^@\n\s]+)/g;
    
    const pathsSet = new Set<string>(); // Use Set to ensure uniqueness
    
    // First, extract quoted paths (including data URLs)
    let matches = Array.from(text.matchAll(quotedRegex));
    console.log('[extractImagePaths] Quoted matches:', matches.length);
    
    for (const match of matches) {
      const path = match[1]; // No need to trim, quotes preserve exact path
      console.log('[extractImagePaths] Processing quoted path:', path.startsWith('data:') ? 'data URL' : path);
      
      // For data URLs, use as-is; for file paths, convert to absolute
      const fullPath = path.startsWith('data:') 
        ? path 
        : (path.startsWith('/') ? path : (projectPath ? `${projectPath}/${path}` : path));
      
      if (isImageFile(fullPath)) {
        pathsSet.add(fullPath);
      }
    }
    
    // Remove quoted mentions from text to avoid double-matching
    let textWithoutQuoted = text.replace(quotedRegex, '');
    
    // Then extract unquoted paths (typically file paths)
    matches = Array.from(textWithoutQuoted.matchAll(unquotedRegex));
    console.log('[extractImagePaths] Unquoted matches:', matches.length);
    
    for (const match of matches) {
      const path = match[1].trim();
      // Skip if it looks like a data URL fragment (shouldn't happen with proper quoting)
      if (path.includes('data:')) continue;
      
      console.log('[extractImagePaths] Processing unquoted path:', path);
      
      // Convert relative path to absolute if needed
      const fullPath = path.startsWith('/') ? path : (projectPath ? `${projectPath}/${path}` : path);
      
      if (isImageFile(fullPath)) {
        pathsSet.add(fullPath);
      }
    }

    const uniquePaths = Array.from(pathsSet);
    console.log('[extractImagePaths] Final extracted paths (unique):', uniquePaths.length);
    return uniquePaths;
  };

  // Update embedded images when prompt changes
  useEffect(() => {
    console.log('[useEffect] Prompt changed:', prompt);
    const imagePaths = extractImagePaths(prompt);
    console.log('[useEffect] Setting embeddedImages to:', imagePaths);
    setEmbeddedImages(imagePaths);
    
    // Auto-resize on prompt change (handles paste, programmatic changes, etc.)
    if (textareaRef.current && !isExpanded) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const newHeight = Math.min(Math.max(scrollHeight, 48), 160);
      setTextareaHeight(newHeight);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [prompt, projectPath, isExpanded]);

  // Keep isActive / isExpanded accessible inside the stable drag-drop callback
  // without re-registering the listener on every render.
  const isActiveRef = useRef(isActive);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  const isExpandedRef = useRef(isExpanded);
  useEffect(() => { isExpandedRef.current = isExpanded; }, [isExpanded]);

  // Notify parent whenever the bar's total height changes so it can
  // add matching bottom padding to the message list.
  useEffect(() => {
    const el = barRootRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const h = entries[0]?.borderBoxSize?.[0]?.blockSize ?? entries[0]?.contentRect?.height ?? 0;
      onHeightChangeRef.current?.(Math.ceil(h));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Set up Tauri drag-drop event listener
  useEffect(() => {
    // This effect runs only once on component mount to set up the listener.
    let lastDropTime = 0;

    const setupListener = async () => {
      try {
        // Native drag-drop is only available inside the Tauri webview.
        if (!isTauri()) {
          return;
        }

        // If a listener from a previous mount/render is still around, clean it up.
        if (unlistenDragDropRef.current) {
          unlistenDragDropRef.current();
        }

        // Dynamic import keeps this ESM-safe and avoids loading Tauri in web mode.
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const webview = getCurrentWebviewWindow();
        unlistenDragDropRef.current = await webview.onDragDropEvent((event: any) => {
          // Only the active tab's input handles drops to avoid duplicate insertions
          if (!isActiveRef.current) return;

          if (event.payload.type === 'enter' || event.payload.type === 'over') {
            setDragActive(true);
          } else if (event.payload.type === 'leave') {
            setDragActive(false);
          } else if (event.payload.type === 'drop' && event.payload.paths) {
            setDragActive(false);

            const currentTime = Date.now();
            if (currentTime - lastDropTime < 200) {
              // This debounce is crucial to handle the storm of drop events
              // that Tauri/OS can fire for a single user action.
              return;
            }
            lastDropTime = currentTime;

            const droppedPaths = event.payload.paths as string[];
            const imagePaths = droppedPaths.filter(isImageFile);
            const nonImagePaths = droppedPaths.filter(p => !isImageFile(p));

            setPrompt(currentPrompt => {
              const existingPaths = extractImagePaths(currentPrompt);
              const mentionParts: string[] = [];

              // Images go into preview via @mention (same as before)
              const newImagePaths = imagePaths.filter(p => !existingPaths.includes(p));
              for (const p of newImagePaths) {
                mentionParts.push(p.includes(' ') ? `@"${p}"` : `@${p}`);
              }

              // Non-image files and folders are inserted as @path mentions
              for (const p of nonImagePaths) {
                mentionParts.push(p.includes(' ') ? `@"${p}"` : `@${p}`);
              }

              if (mentionParts.length === 0) return currentPrompt;

              // Insert at the cursor position rather than appending to the end.
              // Read directly from the DOM so we get the live selectionStart even
              // inside this setState-functional-updater closure.
              const target = isExpandedRef.current
                ? expandedTextareaRef.current
                : textareaRef.current;
              const insertPos = target?.selectionStart ?? currentPrompt.length;

              const before = currentPrompt.substring(0, insertPos);
              const after = currentPrompt.substring(insertPos);
              const mentionsToAdd = mentionParts.join(' ');
              const needsLeadingSpace = before.length > 0 && !before.endsWith(' ');
              const insertText = (needsLeadingSpace ? ' ' : '') + mentionsToAdd + ' ';
              const newPrompt = before + insertText + after;
              const newCursorPos = insertPos + insertText.length;

              setTimeout(() => {
                target?.focus();
                target?.setSelectionRange(newCursorPos, newCursorPos);
              }, 0);

              return newPrompt;
            });
          }
        });
      } catch (error) {
        console.error('Failed to set up Tauri drag-drop listener:', error);
      }
    };

    setupListener();

    return () => {
      // On unmount, ensure we clean up the listener.
      if (unlistenDragDropRef.current) {
        unlistenDragDropRef.current();
        unlistenDragDropRef.current = null;
      }
    };
  }, []); // Empty dependency array ensures this runs only on mount/unmount.

  useEffect(() => {
    // Focus the appropriate textarea when expanded state changes
    if (isExpanded && expandedTextareaRef.current) {
      expandedTextareaRef.current.focus();
    } else if (!isExpanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isExpanded]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const newCursorPosition = e.target.selectionStart || 0;
    
    // Auto-resize textarea based on content
    if (textareaRef.current && !isExpanded) {
      // Reset height to auto to get the actual scrollHeight
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      // Set min height to 48px and max to 160px (about 6 lines)
      const newHeight = Math.min(Math.max(scrollHeight, 48), 160);
      setTextareaHeight(newHeight);
      textareaRef.current.style.height = `${newHeight}px`;
    }

    // Check if / was just typed at the beginning of input or after whitespace
    if (newValue.length > prompt.length && newValue[newCursorPosition - 1] === '/') {
      // Check if it's at the start or after whitespace
      const isStartOfCommand = newCursorPosition === 1 || 
        (newCursorPosition > 1 && /\s/.test(newValue[newCursorPosition - 2]));
      
      if (isStartOfCommand) {
        console.log('[FloatingPromptInput] / detected for slash command');
        setShowSlashCommandPicker(true);
        setSlashCommandQuery("");
        setCursorPosition(newCursorPosition);
      }
    }

    // Check if @ was just typed
    if (projectPath?.trim() && newValue.length > prompt.length && newValue[newCursorPosition - 1] === '@') {
      console.log('[FloatingPromptInput] @ detected, projectPath:', projectPath);
      setShowFilePicker(true);
      setFilePickerQuery("");
      setCursorPosition(newCursorPosition);
    }

    // Check if we're typing after / (for slash command search)
    if (showSlashCommandPicker && newCursorPosition >= cursorPosition) {
      // Find the / position before cursor
      let slashPosition = -1;
      for (let i = newCursorPosition - 1; i >= 0; i--) {
        if (newValue[i] === '/') {
          slashPosition = i;
          break;
        }
        // Stop if we hit whitespace (new word)
        if (newValue[i] === ' ' || newValue[i] === '\n') {
          break;
        }
      }

      if (slashPosition !== -1) {
        const query = newValue.substring(slashPosition + 1, newCursorPosition);
        setSlashCommandQuery(query);
      } else {
        // / was removed or cursor moved away
        setShowSlashCommandPicker(false);
        setSlashCommandQuery("");
      }
    }

    // Check if we're typing after @ (for search query)
    if (showFilePicker && newCursorPosition >= cursorPosition) {
      // Find the @ position before cursor
      let atPosition = -1;
      for (let i = newCursorPosition - 1; i >= 0; i--) {
        if (newValue[i] === '@') {
          atPosition = i;
          break;
        }
        // Stop if we hit whitespace (new word)
        if (newValue[i] === ' ' || newValue[i] === '\n') {
          break;
        }
      }

      if (atPosition !== -1) {
        const query = newValue.substring(atPosition + 1, newCursorPosition);
        setFilePickerQuery(query);
      } else {
        // @ was removed or cursor moved away
        setShowFilePicker(false);
        setFilePickerQuery("");
      }
    }

    setPrompt(newValue);
    setCursorPosition(newCursorPosition);
  };

  const handleFileSelect = (entry: FileEntry) => {
    if (textareaRef.current) {
      // Find the @ position before cursor
      let atPosition = -1;
      for (let i = cursorPosition - 1; i >= 0; i--) {
        if (prompt[i] === '@') {
          atPosition = i;
          break;
        }
        // Stop if we hit whitespace (new word)
        if (prompt[i] === ' ' || prompt[i] === '\n') {
          break;
        }
      }

      if (atPosition === -1) {
        // @ not found, this shouldn't happen but handle gracefully
        console.error('[FloatingPromptInput] @ position not found');
        return;
      }

      // Replace the @ and partial query with the selected path (file or directory)
      const textarea = textareaRef.current;
      const beforeAt = prompt.substring(0, atPosition);
      const afterCursor = prompt.substring(cursorPosition);
      const relativePath = entry.path.startsWith(projectPath || '')
        ? entry.path.slice((projectPath || '').length + 1)
        : entry.path;

      const newPrompt = `${beforeAt}@${relativePath} ${afterCursor}`;
      setPrompt(newPrompt);
      setShowFilePicker(false);
      setFilePickerQuery("");

      // Focus back on textarea and set cursor position after the inserted path
      setTimeout(() => {
        textarea.focus();
        const newCursorPos = beforeAt.length + relativePath.length + 2; // +2 for @ and space
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };

  const handleFilePickerClose = () => {
    setShowFilePicker(false);
    setFilePickerQuery("");
    // Return focus to textarea
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const handleSlashCommandSelect = (command: SlashCommand) => {
    const textarea = isExpanded ? expandedTextareaRef.current : textareaRef.current;
    if (!textarea) return;

    // Find the / position before cursor
    let slashPosition = -1;
    for (let i = cursorPosition - 1; i >= 0; i--) {
      if (prompt[i] === '/') {
        slashPosition = i;
        break;
      }
      // Stop if we hit whitespace (new word)
      if (prompt[i] === ' ' || prompt[i] === '\n') {
        break;
      }
    }

    if (slashPosition === -1) {
      console.error('[FloatingPromptInput] / position not found');
      return;
    }

    // Simply insert the command syntax
    const beforeSlash = prompt.substring(0, slashPosition);
    const afterCursor = prompt.substring(cursorPosition);
    
    if (command.accepts_arguments) {
      // Insert command with placeholder for arguments
      const newPrompt = `${beforeSlash}${command.full_command} `;
      setPrompt(newPrompt);
      setShowSlashCommandPicker(false);
      setSlashCommandQuery("");

      // Focus and position cursor after the command
      setTimeout(() => {
        textarea.focus();
        const newCursorPos = beforeSlash.length + command.full_command.length + 1;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    } else {
      // Insert command and close picker
      const newPrompt = `${beforeSlash}${command.full_command} ${afterCursor}`;
      setPrompt(newPrompt);
      setShowSlashCommandPicker(false);
      setSlashCommandQuery("");

      // Focus and position cursor after the command
      setTimeout(() => {
        textarea.focus();
        const newCursorPos = beforeSlash.length + command.full_command.length + 1;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };

  const handleSlashCommandPickerClose = () => {
    setShowSlashCommandPicker(false);
    setSlashCommandQuery("");
    // Return focus to textarea
    setTimeout(() => {
      const textarea = isExpanded ? expandedTextareaRef.current : textareaRef.current;
      textarea?.focus();
    }, 0);
  };

  const handleCompositionStart = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    isIMEComposingRef.current = true;
    compositionStartPosRef.current = e.currentTarget.selectionStart ?? 0;
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    // Capture synchronously — DOM node refs are stable across the async gap.
    const composedData = e.data ?? '';
    const textarea = e.currentTarget as HTMLTextAreaElement;
    const startPos = compositionStartPosRef.current;

    setTimeout(() => {
      isIMEComposingRef.current = false;

      // CJK IMEs (especially macOS pinyin) inject spaces inside the composition
      // buffer to separate syllables, e.g. "ce s" for "测试". These spaces are
      // committed verbatim when the user switches keyboards via CapsLock, or as
      // a trailing space when confirming with the Space key. Strip all of them.
      if (composedData.includes(' ') && textarea) {
        // The composition segment spans [startPos, endPos) in the current value.
        const endPos = textarea.selectionStart ?? startPos + composedData.length;
        setPrompt(prev => {
          const segment = prev.slice(startPos, endPos);
          const clean = segment.replace(/ /g, '');
          if (clean === segment) return prev;
          requestAnimationFrame(() => {
            textarea.setSelectionRange(startPos + clean.length, startPos + clean.length);
          });
          return prev.slice(0, startPos) + clean + prev.slice(endPos);
        });
      }
    }, 0);
  };

  const isIMEInteraction = (event?: React.KeyboardEvent) => {
    if (isIMEComposingRef.current) {
      return true;
    }

    if (!event) {
      return false;
    }

    const nativeEvent = event.nativeEvent;

    if (nativeEvent.isComposing) {
      return true;
    }

    const key = nativeEvent.key;
    if (key === 'Process' || key === 'Unidentified') {
      return true;
    }

    const keyboardEvent = nativeEvent as unknown as KeyboardEvent;
    const keyCode = keyboardEvent.keyCode ?? (keyboardEvent as unknown as { which?: number }).which;
    if (keyCode === 229) {
      return true;
    }

    return false;
  };

  const handleSend = () => {
    if (isIMEInteraction()) {
      return;
    }

    if (prompt.trim() && !disabled) {
      let finalPrompt = prompt.trim();

      // Append thinking phrase if not auto mode
      const thinkingMode = THINKING_MODES.find(m => m.id === selectedThinkingMode);
      if (thinkingMode && thinkingMode.phrase) {
        finalPrompt = `${finalPrompt}.\n\n${thinkingMode.phrase}.`;
      }

      const modelData = MODELS.find(m => m.id === selectedModel);
      const modelParam = (modelData?.modelParam ?? selectedModel) as ModelId;
      onSend(finalPrompt, modelParam, use1MContext);
      setPrompt("");
      setEmbeddedImages([]);
      setTextareaHeight(48); // Reset height after sending
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showFilePicker && e.key === 'Escape') {
      e.preventDefault();
      setShowFilePicker(false);
      setFilePickerQuery("");
      return;
    }

    if (showSlashCommandPicker && e.key === 'Escape') {
      e.preventDefault();
      setShowSlashCommandPicker(false);
      setSlashCommandQuery("");
      return;
    }

    // Add keyboard shortcut for expanding
    if (e.key === 'e' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      setIsExpanded(true);
      return;
    }

    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !isExpanded &&
      !showFilePicker &&
      !showSlashCommandPicker
    ) {
      if (isIMEInteraction(e)) {
        return;
      }
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        
        const blob = item.getAsFile();
        if (!blob) continue;

        // Capture the cursor position synchronously before the async FileReader
        // callback runs and focus may have shifted.
        const pasteTarget = isExpandedRef.current
          ? expandedTextareaRef.current
          : textareaRef.current;
        const insertPos = pasteTarget?.selectionStart ?? null;

        try {
          const reader = new FileReader();
          reader.onload = async () => {
            const dataUrl = reader.result as string;

            // Try to save to a temp file so the prompt stays concise.
            // Falls back to the raw data URL if the Tauri command is unavailable.
            let imagePath: string | null = null;
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              imagePath = await invoke<string>('save_temp_image', { dataUrl });
            } catch (_) {
              // Web mode or command not available — use data URL directly
            }

            setPrompt(currentPrompt => {
              const mention = imagePath
                ? (imagePath.includes(' ') ? `@"${imagePath}"` : `@${imagePath}`)
                : `@"${dataUrl}"`;

              // Insert at the captured cursor position (or end if unavailable).
              const pos = insertPos ?? currentPrompt.length;
              const before = currentPrompt.substring(0, pos);
              const after = currentPrompt.substring(pos);
              const needsLeadingSpace = before.length > 0 && !before.endsWith(' ');
              const insertText = (needsLeadingSpace ? ' ' : '') + mention + ' ';
              const newPrompt = before + insertText + after;
              const newCursorPos = pos + insertText.length;

              setTimeout(() => {
                const target = isExpandedRef.current
                  ? expandedTextareaRef.current
                  : textareaRef.current;
                target?.focus();
                target?.setSelectionRange(newCursorPos, newCursorPos);
              }, 0);

              return newPrompt;
            });
          };
          
          reader.readAsDataURL(blob);
        } catch (error) {
          console.error('Failed to paste image:', error);
        }
      }
    }
  };

  // Browser drag and drop handlers - just prevent default behavior
  // Actual file handling is done via Tauri's window-level drag-drop events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Visual feedback is handled by Tauri events
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // File processing is handled by Tauri's onDragDropEvent
  };

  const handleRemoveImage = (index: number) => {
    // Remove the corresponding @mention from the prompt
    const imagePath = embeddedImages[index];
    
    // For data URLs, we need to handle them specially since they're always quoted
    if (imagePath.startsWith('data:')) {
      // Simply remove the exact quoted data URL
      const quotedPath = `@"${imagePath}"`;
      const newPrompt = prompt.replace(quotedPath, '').trim();
      setPrompt(newPrompt);
      return;
    }
    
    // For file paths, use the original logic
    const escapedPath = imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedRelativePath = imagePath.replace(projectPath + '/', '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Create patterns for both quoted and unquoted mentions
    const patterns = [
      // Quoted full path
      new RegExp(`@"${escapedPath}"\\s?`, 'g'),
      // Unquoted full path
      new RegExp(`@${escapedPath}\\s?`, 'g'),
      // Quoted relative path
      new RegExp(`@"${escapedRelativePath}"\\s?`, 'g'),
      // Unquoted relative path
      new RegExp(`@${escapedRelativePath}\\s?`, 'g')
    ];

    let newPrompt = prompt;
    for (const pattern of patterns) {
      newPrompt = newPrompt.replace(pattern, '');
    }

    setPrompt(newPrompt.trim());
  };

  const selectedModelData = MODELS.find(m => m.id === selectedModel) || MODELS[0];

  const handleModelSelect = (modelId: ModelId) => {
    const model = MODELS.find(m => m.id === modelId);
    if (model?.highCost) {
      setPendingHighCostAction("opus-4-7");
    } else {
      setSelectedModel(modelId);
      setModelPickerOpen(false);
    }
  };

  const handle1MContextToggle = () => {
    if (use1MContext) {
      setUse1MContext(false);
    } else {
      setPendingHighCostAction("1m-context");
    }
  };

  const confirmHighCostAction = () => {
    if (pendingHighCostAction === "opus-4-7") {
      setSelectedModel("opus-4-7");
      setModelPickerOpen(false);
    } else if (pendingHighCostAction === "1m-context") {
      setUse1MContext(true);
    }
    setPendingHighCostAction(null);
  };

  return (
    <TooltipProvider>
    <>
      {/* High Cost Warning Dialog */}
      <Dialog open={pendingHighCostAction !== null} onOpenChange={(open) => { if (!open) setPendingHighCostAction(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              High Cost Warning
            </DialogTitle>
            <DialogDescription className="pt-1">
              {pendingHighCostAction === "opus-4-7"
                ? "Claude Opus 4.7 is significantly more expensive than Opus 4.6 without proportional benefit for most tasks. Are you sure you want to use it?"
                : "The 1M extended context window increases cost substantially and is unnecessary for most use cases. Are you sure you want to enable it?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPendingHighCostAction(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmHighCostAction}>
              Enable anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Expanded Modal */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
            onClick={() => setIsExpanded(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="bg-background border border-border rounded-lg shadow-lg w-full max-w-2xl p-4 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Compose your prompt</h3>
                <TooltipSimple content="Minimize" side="bottom">
                  <motion.div
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsExpanded(false)}
                      className="h-8 w-8"
                    >
                      <Minimize2 className="h-4 w-4" />
                    </Button>
                  </motion.div>
                </TooltipSimple>
              </div>

              {/* Image previews in expanded mode */}
              {embeddedImages.length > 0 && (
                <ImagePreview
                  images={embeddedImages}
                  onRemove={handleRemoveImage}
                  className="border-t border-border pt-2"
                />
              )}

              <Textarea
                ref={expandedTextareaRef}
                value={prompt}
                onChange={handleTextChange}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onPaste={handlePaste}
                placeholder="Type your message..."
                className="min-h-[200px] resize-none"
                disabled={disabled}
                autoCorrect={autoCorrect ? "on" : "off"}
                autoCapitalize={autoCorrect ? "on" : "off"}
                spellCheck={autoCorrect}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Model:</span>
                    <Popover
                      trigger={
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setModelPickerOpen(!modelPickerOpen)}
                          className="gap-2"
                        >
                          <span className={selectedModelData.color}>
                            {selectedModelData.icon}
                          </span>
                          {selectedModelData.name}
                        </Button>
                      }
                      content={
                        <div className="w-[300px] p-1">
                          {MODELS.map((model) => (
                            <button
                              key={model.id}
                              onClick={() => handleModelSelect(model.id)}
                              className={cn(
                                "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left",
                                "hover:bg-accent",
                                selectedModel === model.id && "bg-accent"
                              )}
                            >
                              <div className="mt-0.5">
                                <span className={model.color}>
                                  {model.icon}
                                </span>
                              </div>
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">{model.name}</span>
                                  {model.highCost && (
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">HIGH COST</span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {model.description}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      }
                      open={modelPickerOpen}
                      onOpenChange={setModelPickerOpen}
                      align="start"
                      side="top"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Thinking:</span>
                    <Popover
                      trigger={
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                                size="sm"
                                onClick={() => setThinkingModePickerOpen(!thinkingModePickerOpen)}
                                className="gap-2"
                              >
                                <span className={THINKING_MODES.find(m => m.id === selectedThinkingMode)?.color}>
                                  {THINKING_MODES.find(m => m.id === selectedThinkingMode)?.icon}
                                </span>
                                <ThinkingModeIndicator 
                                  level={THINKING_MODES.find(m => m.id === selectedThinkingMode)?.level || 0} 
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="font-medium">{THINKING_MODES.find(m => m.id === selectedThinkingMode)?.name || "Auto"}</p>
                              <p className="text-xs text-muted-foreground">{THINKING_MODES.find(m => m.id === selectedThinkingMode)?.description}</p>
                            </TooltipContent>
                          </Tooltip>
                      }
                      content={
                        <div className="w-[280px] p-1">
                          {THINKING_MODES.map((mode) => (
                            <button
                              key={mode.id}
                              onClick={() => {
                                setSelectedThinkingMode(mode.id);
                                setThinkingModePickerOpen(false);
                              }}
                              className={cn(
                                "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left",
                                "hover:bg-accent",
                                selectedThinkingMode === mode.id && "bg-accent"
                              )}
                            >
                              <span className={cn("mt-0.5", mode.color)}>
                                {mode.icon}
                              </span>
                              <div className="flex-1 space-y-1">
                                <div className="font-medium text-sm">
                                  {mode.name}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {mode.description}
                                </div>
                              </div>
                              <ThinkingModeIndicator level={mode.level} />
                            </button>
                          ))}
                        </div>
                      }
                      open={thinkingModePickerOpen}
                      onOpenChange={setThinkingModePickerOpen}
                      align="start"
                      side="top"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">1M Context:</span>
                    <TooltipSimple content={use1MContext ? "1M context enabled — high cost. Click to disable." : "Enable 1M extended context window (high cost)"} side="top">
                      <button
                        onClick={handle1MContextToggle}
                        className={cn(
                          "flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-all",
                          use1MContext
                            ? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            : "border-border bg-background text-muted-foreground hover:border-border/80 hover:text-foreground"
                        )}
                      >
                        <Database className="h-3.5 w-3.5" />
                        <span>1M</span>
                        {/* inline toggle switch */}
                        <div className={cn(
                          "w-7 h-4 rounded-full transition-colors flex items-center px-0.5",
                          use1MContext ? "bg-amber-500" : "bg-muted-foreground/30"
                        )}>
                          <div className={cn(
                            "w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200",
                            use1MContext ? "translate-x-3" : "translate-x-0"
                          )} />
                        </div>
                      </button>
                    </TooltipSimple>
                  </div>
                </div>

                <div className="flex gap-1">
                  <TooltipSimple content="Send message" side="top">
                    <motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}>
                      <Button
                        onClick={handleSend}
                        disabled={!prompt.trim() || disabled}
                        size="default"
                        className="min-w-[60px]"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </motion.div>
                  </TooltipSimple>
                  <TooltipSimple content="Stop generation" side="top">
                    <motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}>
                      <Button
                        onClick={onCancel}
                        disabled={!isLoading}
                        variant="destructive"
                        size="icon"
                        className={cn("h-9 w-9 transition-all", !isLoading && "opacity-30 cursor-not-allowed")}
                      >
                        <Square className="h-4 w-4" />
                      </Button>
                    </motion.div>
                  </TooltipSimple>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fixed Position Input Bar */}
      <div
        ref={barRootRef}
        className={cn(
          "fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-t border-border shadow-lg",
          dragActive && "ring-2 ring-primary ring-offset-2",
          className
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="container mx-auto">
          {/* Image previews */}
          {embeddedImages.length > 0 && (
            <ImagePreview
              images={embeddedImages}
              onRemove={handleRemoveImage}
              className="border-b border-border"
            />
          )}

          <div className="p-3">
            <div className="flex items-end gap-2">
              {/* Model & Thinking Mode Selectors - Left side, fixed at bottom */}
              <div className="flex items-center gap-1 shrink-0 mb-1">
                <Popover
                  trigger={
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <motion.div
                          whileTap={{ scale: 0.97 }}
                            transition={{ duration: 0.15 }}
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={disabled}
                              className="h-9 px-2 hover:bg-accent/50 gap-1"
                            >
                              <span className={selectedModelData.color}>
                                {selectedModelData.icon}
                              </span>
                              <span className="text-[10px] font-bold opacity-70">
                                {selectedModelData.shortName}
                              </span>
                              <ChevronUp className="h-3 w-3 ml-0.5 opacity-50" />
                            </Button>
                          </motion.div>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p className="text-xs font-medium">{selectedModelData.name}</p>
                          <p className="text-xs text-muted-foreground">{selectedModelData.description}</p>
                        </TooltipContent>
                      </Tooltip>
                  }
                content={
                  <div className="w-[300px] p-1">
                    {MODELS.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => handleModelSelect(model.id)}
                        className={cn(
                          "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left",
                          "hover:bg-accent",
                          selectedModel === model.id && "bg-accent"
                        )}
                      >
                        <div className="mt-0.5">
                          <span className={model.color}>
                            {model.icon}
                          </span>
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{model.name}</span>
                            {model.highCost && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">HIGH COST</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {model.description}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                }
                open={modelPickerOpen}
                onOpenChange={setModelPickerOpen}
                align="start"
                side="top"
              />

                <Popover
                  trigger={
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <motion.div
                          whileTap={{ scale: 0.97 }}
                            transition={{ duration: 0.15 }}
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={disabled}
                              className="h-9 px-2 hover:bg-accent/50 gap-1"
                            >
                              <span className={THINKING_MODES.find(m => m.id === selectedThinkingMode)?.color}>
                                {THINKING_MODES.find(m => m.id === selectedThinkingMode)?.icon}
                              </span>
                              <span className="text-[10px] font-semibold opacity-70">
                                {THINKING_MODES.find(m => m.id === selectedThinkingMode)?.shortName}
                              </span>
                              <ChevronUp className="h-3 w-3 ml-0.5 opacity-50" />
                            </Button>
                          </motion.div>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p className="text-xs font-medium">Thinking: {THINKING_MODES.find(m => m.id === selectedThinkingMode)?.name || "Auto"}</p>
                          <p className="text-xs text-muted-foreground">{THINKING_MODES.find(m => m.id === selectedThinkingMode)?.description}</p>
                        </TooltipContent>
                      </Tooltip>
                  }
                content={
                  <div className="w-[280px] p-1">
                    {THINKING_MODES.map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => {
                          setSelectedThinkingMode(mode.id);
                          setThinkingModePickerOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-start gap-3 p-3 rounded-md transition-colors text-left",
                          "hover:bg-accent",
                          selectedThinkingMode === mode.id && "bg-accent"
                        )}
                      >
                        <span className={cn("mt-0.5", mode.color)}>
                          {mode.icon}
                        </span>
                        <div className="flex-1 space-y-1">
                          <div className="font-medium text-sm">
                            {mode.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {mode.description}
                          </div>
                        </div>
                        <ThinkingModeIndicator level={mode.level} />
                      </button>
                    ))}
                  </div>
                }
                open={thinkingModePickerOpen}
                onOpenChange={setThinkingModePickerOpen}
                align="start"
                side="top"
              />

              <TooltipSimple
                content={use1MContext ? "1M context enabled (high cost) — click to disable" : "Enable 1M extended context window (high cost)"}
                side="top"
              >
                <motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}>
                  <button
                    disabled={disabled}
                    onClick={handle1MContextToggle}
                    className={cn(
                      "h-9 px-2 flex items-center gap-1.5 rounded-md transition-colors text-xs",
                      use1MContext
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100"
                    )}
                  >
                    <Database className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-bold text-[10px]">1M</span>
                    {/* mini toggle switch */}
                    <div className={cn(
                      "w-6 h-3.5 rounded-full transition-colors flex items-center px-0.5",
                      use1MContext ? "bg-amber-500" : "bg-muted-foreground/30"
                    )}>
                      <div className={cn(
                        "w-2.5 h-2.5 rounded-full bg-white shadow-sm transition-transform duration-200",
                        use1MContext ? "translate-x-2.5" : "translate-x-0"
                      )} />
                    </div>
                  </button>
                </motion.div>
              </TooltipSimple>

              </div>

              {/* Prompt Input - Center */}
              <div className="flex-1 relative">
                <Textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={handleTextChange}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onPaste={handlePaste}
                  placeholder={
                    dragActive
                      ? "Drop images here..."
                      : "Message Claude (@ for files, / for commands)..."
                  }
                  disabled={disabled}
                  autoCorrect={autoCorrect ? "on" : "off"}
                  autoCapitalize={autoCorrect ? "on" : "off"}
                  spellCheck={autoCorrect}
                  className={cn(
                    "resize-none pr-20 pl-3 py-2.5 transition-all duration-150",
                    dragActive && "border-primary",
                    textareaHeight >= 160 && "overflow-y-auto scrollbar-thin"
                  )}
                  style={{
                    height: `${textareaHeight}px`,
                    overflowY: textareaHeight >= 160 ? 'auto' : 'hidden'
                  }}
                />

                {/* Action buttons inside input - fixed at bottom right */}
                <div className="absolute right-1.5 bottom-1.5 flex items-center gap-0.5">
                  <TooltipSimple content="Expand (Ctrl+Shift+E)" side="top">
                    <motion.div
                      whileTap={{ scale: 0.97 }}
                      transition={{ duration: 0.15 }}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsExpanded(true)}
                        disabled={disabled}
                        className="h-8 w-8 hover:bg-accent/50 transition-colors"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </Button>
                    </motion.div>
                  </TooltipSimple>

                  <TooltipSimple content="Send message (Enter)" side="top">
                    <motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}>
                      <Button
                        onClick={handleSend}
                        disabled={!prompt.trim() || disabled}
                        variant={prompt.trim() ? "default" : "ghost"}
                        size="icon"
                        className={cn(
                          "h-8 w-8 transition-all",
                          prompt.trim() && "shadow-sm"
                        )}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </motion.div>
                  </TooltipSimple>

                  <TooltipSimple content="Stop generation" side="top">
                    <motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}>
                      <Button
                        onClick={onCancel}
                        disabled={!isLoading}
                        variant="destructive"
                        size="icon"
                        className={cn(
                          "h-8 w-8 transition-all",
                          !isLoading && "opacity-30 cursor-not-allowed"
                        )}
                      >
                        <Square className="h-4 w-4" />
                      </Button>
                    </motion.div>
                  </TooltipSimple>
                </div>

                {/* File Picker */}
                <AnimatePresence>
                  {showFilePicker && projectPath && projectPath.trim() && (
                    <FilePicker
                      basePath={projectPath.trim()}
                      onSelect={handleFileSelect}
                      onClose={handleFilePickerClose}
                      initialQuery={filePickerQuery}
                    />
                  )}
                </AnimatePresence>

                {/* Slash Command Picker */}
                <AnimatePresence>
                  {showSlashCommandPicker && (
                    <SlashCommandPicker
                      projectPath={projectPath}
                      onSelect={handleSlashCommandSelect}
                      onClose={handleSlashCommandPickerClose}
                      initialQuery={slashCommandQuery}
                    />
                  )}
                </AnimatePresence>
              </div>

              {/* Extra menu items - Right side, fixed at bottom */}
              {extraMenuItems && (
                <div className="flex items-center gap-0.5 shrink-0 mb-1">
                  {extraMenuItems}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
    </TooltipProvider>
  );
};

export const FloatingPromptInput = React.forwardRef<
  FloatingPromptInputRef,
  FloatingPromptInputProps
>(FloatingPromptInputInner);

FloatingPromptInput.displayName = 'FloatingPromptInput';
