import React, { useState, useEffect, useMemo } from "react";
import { 
  Terminal, 
  User, 
  Bot, 
  AlertCircle, 
  CheckCircle2,
  Copy,
  Check
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { getClaudeSyntaxTheme } from "@/lib/claudeSyntaxTheme";
import { useTheme } from "@/hooks";
import type { ClaudeStreamMessage } from "./AgentExecution";
import {
  TodoWidget,
  TodoReadWidget,
  LSWidget,
  ReadWidget,
  ReadResultWidget,
  GlobWidget,
  BashWidget,
  WriteWidget,
  GrepWidget,
  EditWidget,
  EditResultWidget,
  MCPWidget,
  CommandWidget,
  CommandOutputWidget,
  SummaryWidget,
  MultiEditWidget,
  MultiEditResultWidget,
  SystemReminderWidget,
  SystemInitializedWidget,
  TaskWidget,
  LSResultWidget,
  ThinkingWidget,
  WebSearchWidget,
  WebFetchWidget,
  CollapsibleToolCard,
  type ToolCardStatus
} from "./ToolWidgets";

/** Truncate a string for use in a one-line collapsed summary. */
const truncatePreview = (value: unknown, max = 80): string => {
  if (value === undefined || value === null) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  const firstLine = str.split("\n")[0];
  return firstLine.length > max ? `${firstLine.slice(0, max)}…` : firstLine;
};

/**
 * Per-category accent colors for the collapsible tool row, mirroring
 * claudecodeui: a colored left bar plus a matching value text color. Full
 * Tailwind class strings are written out so the JIT compiler picks them up.
 */
const ACCENT = {
  amber: { border: "border-l-amber-500 dark:border-l-amber-400", value: "text-primary" },
  green: { border: "border-l-green-500 dark:border-l-green-400", value: "text-green-600 dark:text-green-400" },
  slate: { border: "border-l-slate-400 dark:border-l-slate-500", value: "text-foreground" },
  slateLink: { border: "border-l-slate-400 dark:border-l-slate-500", value: "text-primary" },
  violet: { border: "border-l-violet-500 dark:border-l-violet-400", value: "text-violet-600 dark:text-violet-400" },
  purple: { border: "border-l-purple-500 dark:border-l-purple-400", value: "text-purple-600 dark:text-purple-400" },
  blue: { border: "border-l-blue-500 dark:border-l-blue-400", value: "text-blue-600 dark:text-blue-400" },
  gray: { border: "border-l-border", value: "text-muted-foreground" },
} as const;

type ToolSummary = { label: string; preview: string; borderClass: string; valueClass: string };

/**
 * Produce a compact one-line summary (label + preview + accent colors) for a
 * tool call, used as the collapsed header of {@link CollapsibleToolCard}.
 */
const getToolSummary = (name: string | undefined, input: any): ToolSummary => {
  const mk = (label: string, preview: string, accent: { border: string; value: string }): ToolSummary => ({
    label,
    preview,
    borderClass: accent.border,
    valueClass: accent.value,
  });

  if (name?.startsWith("mcp__")) {
    const parts = name.split("__");
    const ns = parts[1] || "";
    const method = parts[2] || "";
    const hint = input?.query ?? input?.url ?? input?.path ?? "";
    return mk("MCP", [ns, method].filter(Boolean).join(" · ") + (hint ? `  ${truncatePreview(hint, 50)}` : ""), ACCENT.violet);
  }

  const lower = name?.toLowerCase();
  switch (lower) {
    case "task":
      return mk("Task", truncatePreview(input?.description), ACCENT.purple);
    case "edit":
      return mk("Edit", truncatePreview(input?.file_path), ACCENT.amber);
    case "multiedit":
      return mk("MultiEdit", truncatePreview(input?.file_path), ACCENT.amber);
    case "write":
      return mk("Write", truncatePreview(input?.file_path), ACCENT.amber);
    case "read":
      return mk("Read", truncatePreview(input?.file_path), ACCENT.slateLink);
    case "ls":
      return mk("LS", truncatePreview(input?.path), ACCENT.slate);
    case "glob":
      return mk("Glob", truncatePreview(input?.pattern), ACCENT.slate);
    case "grep":
      return mk("Grep", truncatePreview(input?.pattern), ACCENT.slate);
    case "bash":
      return mk("Bash", truncatePreview(input?.command || input?.description), ACCENT.green);
    case "todowrite":
      return mk("TodoWrite", `${input?.todos?.length ?? 0} items`, ACCENT.violet);
    case "todoread":
      return mk("TodoRead", "", ACCENT.violet);
    case "websearch":
      return mk("WebSearch", truncatePreview(input?.query), ACCENT.blue);
    case "webfetch":
      return mk("WebFetch", truncatePreview(input?.url), ACCENT.blue);
    default:
      return mk(name || "Tool", truncatePreview(input), ACCENT.gray);
  }
};

/**
 * A fenced code block rendered with syntax highlighting and a copy-to-clipboard
 * button shown on hover. Only used for block-level code, not inline code.
 */
const CodeBlock: React.FC<{
  language: string;
  value: string;
  syntaxTheme: any;
}> = ({ language, value, syntaxTheme }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code block:", err);
    }
  };

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : "Copy code"}
        title={copied ? "Copied" : "Copy code"}
        className="absolute right-2 top-2 z-10 flex items-center justify-center rounded-md border border-border/50 bg-background/80 p-1.5 text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 focus:outline-none group-hover:opacity-100"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
      <SyntaxHighlighter style={syntaxTheme} language={language} PreTag="div">
        {value}
      </SyntaxHighlighter>
    </div>
  );
};

function markdownComponents(syntaxTheme: any) {
  return {
    code({ node, inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '');
      // Block-level code (fenced, with a language) gets syntax highlighting and
      // a copy button. Inline code is left untouched.
      return !inline && match ? (
        <CodeBlock
          language={match[1]}
          value={String(children).replace(/\n$/, '')}
          syntaxTheme={syntaxTheme}
        />
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  };
}

interface StreamMessageProps {
  message: ClaudeStreamMessage;
  className?: string;
  streamMessages: ClaudeStreamMessage[];
  onLinkDetected?: (url: string) => void;
  /**
   * Whether the session is currently streaming. When true, the latest
   * not-yet-completed tool call is auto-expanded; all other tool cards stay
   * collapsed.
   */
  isStreaming?: boolean;
}

/**
 * Component to render a single Claude Code stream message
 */
const StreamMessageComponent: React.FC<StreamMessageProps> = ({ message, className, streamMessages, onLinkDetected, isStreaming = false }) => {
  // State to track tool results mapped by tool call ID
  const [toolResults, setToolResults] = useState<Map<string, any>>(new Map());
  
  // Get current theme
  const { theme } = useTheme();
  const syntaxTheme = getClaudeSyntaxTheme(theme);
  
  // Extract all tool results from stream messages
  useEffect(() => {
    const results = new Map<string, any>();
    
    // Iterate through all messages to find tool results
    streamMessages.forEach(msg => {
      if (msg.type === "user" && msg.message?.content && Array.isArray(msg.message.content)) {
        msg.message.content.forEach((content: any) => {
          if (content.type === "tool_result" && content.tool_use_id) {
            results.set(content.tool_use_id, content);
          }
        });
      }
    });
    
    setToolResults(results);
  }, [streamMessages]);
  
  // Helper to get tool result for a specific tool call ID
  const getToolResult = (toolId: string | undefined): any => {
    if (!toolId) return null;
    return toolResults.get(toolId) || null;
  };

  // Determine the latest "running" tool: the last tool_use across the whole
  // stream that has no corresponding tool_result yet. Only meaningful while
  // streaming; this is the single card that should auto-expand.
  const activeToolUseId = useMemo<string | null>(() => {
    if (!isStreaming) return null;

    const resultIds = new Set<string>();
    streamMessages.forEach((msg) => {
      if (msg.type === "user" && Array.isArray(msg.message?.content)) {
        msg.message.content.forEach((c: any) => {
          if (c.type === "tool_result" && c.tool_use_id) resultIds.add(c.tool_use_id);
        });
      }
    });

    let last: string | null = null;
    streamMessages.forEach((msg) => {
      if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
        msg.message.content.forEach((c: any) => {
          if (c.type === "tool_use" && c.id && !resultIds.has(c.id)) last = c.id;
        });
      }
    });
    return last;
  }, [streamMessages, isStreaming]);

  // Compute the status badge for a tool given its result/active state.
  const getToolStatus = (toolId: string | undefined, result: any): ToolCardStatus => {
    if (toolId && toolId === activeToolUseId) return "running";
    if (result) return result.is_error ? "error" : "success";
    return "idle";
  };
  
  try {
    // Skip rendering for meta messages that don't have meaningful content
    if (message.isMeta && !message.leafUuid && !message.summary) {
      return null;
    }

    // Handle summary messages
    if (message.leafUuid && message.summary && (message as any).type === "summary") {
      return <SummaryWidget summary={message.summary} leafUuid={message.leafUuid} />;
    }

    // System initialization message
    if (message.type === "system" && message.subtype === "init") {
      return (
        <CollapsibleToolCard
          memoryId={message.session_id ? `init:${message.session_id}` : "init"}
          label="System Initialized"
          preview={truncatePreview(message.model || message.session_id || "")}
          borderClass="border-l-slate-400 dark:border-l-slate-500"
          valueClass="text-muted-foreground"
          status="idle"
          defaultExpanded={false}
        >
          <SystemInitializedWidget
            sessionId={message.session_id}
            model={message.model}
            cwd={message.cwd}
            tools={message.tools}
          />
        </CollapsibleToolCard>
      );
    }

    // Assistant message
    if (message.type === "assistant" && message.message) {
      const msg = message.message;
      
      let renderedSomething = false;
      
      const contentArr = Array.isArray(msg.content) ? msg.content : [];
      // A message containing only tool calls (no prose/thinking) is rendered
      // without the assistant card chrome, matching claudecodeui's compact
      // timeline. Messages with text keep the card + avatar.
      const toolOnly = contentArr.length > 0 && !contentArr.some((c: any) => c.type === "text" || c.type === "thinking");

      const body = (
        <div className={cn("min-w-0", toolOnly ? "space-y-0.5" : "flex-1 space-y-2")}>
                {contentArr.map((content: any, idx: number) => {
                  // Text content - render as markdown
                  if (content.type === "text") {
                    // Ensure we have a string to render
                    const textContent = typeof content.text === 'string' 
                      ? content.text 
                      : (content.text?.text || JSON.stringify(content.text || content));
                    
                    renderedSomething = true;
                    return (
                      <div key={idx} className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents(syntaxTheme)}
                        >
                          {textContent}
                        </ReactMarkdown>
                      </div>
                    );
                  }
                  
                  // Thinking content - render with ThinkingWidget
                  if (content.type === "thinking") {
                    renderedSomething = true;
                    return (
                      <div key={idx}>
                        <ThinkingWidget 
                          thinking={content.thinking || ''} 
                          signature={content.signature}
                        />
                      </div>
                    );
                  }
                  
                  // Tool use - render custom widgets based on tool name
                  if (content.type === "tool_use") {
                    const toolName = content.name?.toLowerCase();
                    const input = content.input;
                    const toolId = content.id;
                    
                    // Get the tool result if available
                    const toolResult = getToolResult(toolId);
                    
                    // Function to render the appropriate tool widget
                    const renderToolWidget = () => {
                      // Task tool - for sub-agent tasks
                      if (toolName === "task" && input) {
                        renderedSomething = true;
                        return <TaskWidget description={input.description} prompt={input.prompt} result={toolResult} />;
                      }
                      
                      // Edit tool
                      if (toolName === "edit" && input?.file_path) {
                        renderedSomething = true;
                        return <EditWidget {...input} result={toolResult} />;
                      }
                      
                      // MultiEdit tool
                      if (toolName === "multiedit" && input?.file_path && input?.edits) {
                        renderedSomething = true;
                        return <MultiEditWidget {...input} result={toolResult} />;
                      }
                      
                      // MCP tools (starting with mcp__)
                      if (content.name?.startsWith("mcp__")) {
                        renderedSomething = true;
                        return <MCPWidget toolName={content.name} input={input} result={toolResult} />;
                      }
                      
                      // TodoWrite tool
                      if (toolName === "todowrite" && input?.todos) {
                        renderedSomething = true;
                        return <TodoWidget todos={input.todos} result={toolResult} />;
                      }
                      
                      // TodoRead tool
                      if (toolName === "todoread") {
                        renderedSomething = true;
                        return <TodoReadWidget todos={input?.todos} result={toolResult} />;
                      }
                      
                      // LS tool
                      if (toolName === "ls" && input?.path) {
                        renderedSomething = true;
                        return <LSWidget path={input.path} result={toolResult} />;
                      }
                      
                      // Read tool
                      if (toolName === "read" && input?.file_path) {
                        renderedSomething = true;
                        return <ReadWidget filePath={input.file_path} result={toolResult} />;
                      }
                      
                      // Glob tool
                      if (toolName === "glob" && input?.pattern) {
                        renderedSomething = true;
                        return <GlobWidget pattern={input.pattern} result={toolResult} />;
                      }
                      
                      // Bash tool
                      if (toolName === "bash" && input?.command) {
                        renderedSomething = true;
                        return <BashWidget command={input.command} description={input.description} result={toolResult} />;
                      }
                      
                      // Write tool
                      if (toolName === "write" && input?.file_path && input?.content) {
                        renderedSomething = true;
                        return <WriteWidget filePath={input.file_path} content={input.content} result={toolResult} />;
                      }
                      
                      // Grep tool
                      if (toolName === "grep" && input?.pattern) {
                        renderedSomething = true;
                        return <GrepWidget pattern={input.pattern} include={input.include} path={input.path} exclude={input.exclude} result={toolResult} />;
                      }
                      
                      // WebSearch tool
                      if (toolName === "websearch" && input?.query) {
                        renderedSomething = true;
                        return <WebSearchWidget query={input.query} result={toolResult} />;
                      }
                      
                      // WebFetch tool
                      if (toolName === "webfetch" && input?.url) {
                        renderedSomething = true;
                        return <WebFetchWidget url={input.url} prompt={input.prompt} result={toolResult} />;
                      }
                      
                      // Default - return null
                      return null;
                    };
                    
                    // Render the tool widget (or a basic fallback display)
                    const widget = renderToolWidget();
                    renderedSomething = true;

                    const innerContent = widget ?? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Terminal className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">
                            Using tool: <code className="font-mono">{content.name}</code>
                          </span>
                        </div>
                        {content.input && (
                          <div className="p-2 bg-background rounded-md border">
                            <pre className="text-xs font-mono overflow-x-auto">
                              {JSON.stringify(content.input, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    );

                    const summary = getToolSummary(content.name, input);
                    const isActive = toolId != null && toolId === activeToolUseId;

                    return (
                      <div key={idx}>
                        <CollapsibleToolCard
                          memoryId={toolId}
                          label={summary.label}
                          preview={summary.preview}
                          borderClass={summary.borderClass}
                          valueClass={summary.valueClass}
                          status={getToolStatus(toolId, toolResult)}
                          defaultExpanded={isActive}
                        >
                          {innerContent}
                        </CollapsibleToolCard>
                      </div>
                    );
                  }
                  
                  return null;
                })}
                
                {!toolOnly && msg.usage && (
                  <div className="text-xs text-muted-foreground mt-2">
                    Tokens: {msg.usage.input_tokens} in, {msg.usage.output_tokens} out
                  </div>
                )}
        </div>
      );

      if (!renderedSomething) return null;

      // Tool-only messages: no card, no avatar, no token row — just the rows.
      if (toolOnly) {
        return <div className={cn("py-0.5", className)}>{body}</div>;
      }

      return (
        <Card className={cn("border-primary/20 bg-primary/5", className)}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Bot className="h-5 w-5 text-primary mt-0.5" />
              {body}
            </div>
          </CardContent>
        </Card>
      );
    }

    // User message - handle both nested and direct content structures
    if (message.type === "user") {
      // Don't render meta messages, which are for system use
      if (message.isMeta) return null;

      // Handle different message structures
      const msg = message.message || message;

      // Claude stores compact/continuation summaries as synthetic "user" rows
      // flagged with isCompactSummary. They are really assistant-authored
      // context, so render them as a collapsible summary instead of a user
      // message. (See claudecodeui's claude-sessions provider for reference.)
      const isCompactSummary =
        (message as any).isCompactSummary === true || (msg as any)?.isCompactSummary === true;
      if (isCompactSummary) {
        const raw = msg.content;
        const summaryText =
          typeof raw === "string"
            ? raw
            : Array.isArray(raw)
            ? raw.map((c: any) => (typeof c === "string" ? c : c.text || "")).join("\n")
            : String(raw ?? "");
        if (!summaryText.trim()) return null;
        return (
          <CollapsibleToolCard
            memoryId={(message as any).uuid ? `summary:${(message as any).uuid}` : undefined}
            label="Context Summary"
            preview={truncatePreview(summaryText)}
            borderClass="border-l-indigo-400 dark:border-l-indigo-500"
            valueClass="text-muted-foreground"
            status="idle"
            defaultExpanded={false}
          >
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents(syntaxTheme)}>
                {summaryText}
              </ReactMarkdown>
            </div>
          </CollapsibleToolCard>
        );
      }

      const userContentArr = Array.isArray(msg.content) ? msg.content : [];
      // A user row that only carries tool_results (Claude nests them under the
      // user role) is not a real user message: render the results inline with
      // no user-card chrome, matching claudecodeui.
      const userToolOnly = userContentArr.length > 0 && userContentArr.every((c: any) => c.type === "tool_result");

      let renderedSomething = false;
      
      const body = (
        <div className={cn("min-w-0", userToolOnly ? "space-y-0.5" : "flex-1 space-y-2")}>
                {/* Handle content that is a simple string (e.g. from user commands) */}
                {(typeof msg.content === 'string' || (msg.content && !Array.isArray(msg.content))) && (
                  (() => {
                    const contentStr = typeof msg.content === 'string' ? msg.content : String(msg.content);
                    if (contentStr.trim() === '') return null;
                    renderedSomething = true;
                    
                    // Check if it's a command message
                    const commandMatch = contentStr.match(/<command-name>(.+?)<\/command-name>[\s\S]*?<command-message>(.+?)<\/command-message>[\s\S]*?<command-args>(.*?)<\/command-args>/);
                    if (commandMatch) {
                      const [, commandName, commandMessage, commandArgs] = commandMatch;
                      return (
                        <CommandWidget 
                          commandName={commandName.trim()} 
                          commandMessage={commandMessage.trim()}
                          commandArgs={commandArgs?.trim()}
                        />
                      );
                    }
                    
                    // Check if it's command output
                    const stdoutMatch = contentStr.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
                    if (stdoutMatch) {
                      const [, output] = stdoutMatch;
                      return <CommandOutputWidget output={output} onLinkDetected={onLinkDetected} />;
                    }
                    
                    // Otherwise render as plain text
                    return (
                      <div className="text-sm whitespace-pre-wrap">
                        {contentStr}
                      </div>
                    );
                  })()
                )}

                {/* Handle content that is an array of parts */}
                {Array.isArray(msg.content) && msg.content.map((content: any, idx: number) => {
                  // Tool result
                  if (content.type === "tool_result") {
                    // Skip duplicate tool_result if a dedicated widget is present
                    let hasCorrespondingWidget = false;
                    if (content.tool_use_id && streamMessages) {
                      for (let i = streamMessages.length - 1; i >= 0; i--) {
                        const prevMsg = streamMessages[i];
                        if (prevMsg.type === 'assistant' && prevMsg.message?.content && Array.isArray(prevMsg.message.content)) {
                          const toolUse = prevMsg.message.content.find((c: any) => c.type === 'tool_use' && c.id === content.tool_use_id);
                          if (toolUse) {
                            const toolName = toolUse.name?.toLowerCase();
                            const toolsWithWidgets = ['task','edit','multiedit','todowrite','todoread','ls','read','glob','bash','write','grep','websearch','webfetch'];
                            if (toolsWithWidgets.includes(toolName) || toolUse.name?.startsWith('mcp__')) {
                              hasCorrespondingWidget = true;
                            }
                            break;
                          }
                        }
                      }
                    }

                    if (hasCorrespondingWidget) {
                      return null;
                    }
                    // Extract the actual content string
                    let contentText = '';
                    if (typeof content.content === 'string') {
                      contentText = content.content;
                    } else if (content.content && typeof content.content === 'object') {
                      // Handle object with text property
                      if (content.content.text) {
                        contentText = content.content.text;
                      } else if (Array.isArray(content.content)) {
                        // Handle array of content blocks
                        contentText = content.content
                          .map((c: any) => (typeof c === 'string' ? c : c.text || JSON.stringify(c)))
                          .join('\n');
                      } else {
                        // Fallback to JSON stringify
                        contentText = JSON.stringify(content.content, null, 2);
                      }
                    }
                    
                    // Build inner content + title once, then wrap in a single
                    // collapsible card so tool results stay compact by default.
                    let resultTitle = "Tool Result";
                    let resultInner: React.ReactNode;

                    const reminderMatch = contentText.match(/<system-reminder>(.*?)<\/system-reminder>/s);
                    const isEditResult = contentText.includes("has been updated. Here's the result of running `cat -n`");
                    const isMultiEditResult = contentText.includes("has been updated with multiple edits") ||
                                             contentText.includes("MultiEdit completed successfully") ||
                                             contentText.includes("Applied multiple edits to");

                    // LS tool result (directory tree structure)
                    const isLSResult = (() => {
                      if (!content.tool_use_id || typeof contentText !== 'string') return false;
                      let isFromLSTool = false;
                      if (streamMessages) {
                        for (let i = streamMessages.length - 1; i >= 0; i--) {
                          const prevMsg = streamMessages[i];
                          if (prevMsg.type === 'assistant' && prevMsg.message?.content && Array.isArray(prevMsg.message.content)) {
                            const toolUse = prevMsg.message.content.find((c: any) =>
                              c.type === 'tool_use' &&
                              c.id === content.tool_use_id &&
                              c.name?.toLowerCase() === 'ls'
                            );
                            if (toolUse) {
                              isFromLSTool = true;
                              break;
                            }
                          }
                        }
                      }
                      if (!isFromLSTool) return false;
                      const lines = contentText.split('\n');
                      const hasTreeStructure = lines.some(line => /^\s*-\s+/.test(line));
                      const hasNoteAtEnd = lines.some(line => line.trim().startsWith('NOTE: do any of the files'));
                      return hasTreeStructure || hasNoteAtEnd;
                    })();

                    // Read tool result (contains line numbers with arrow separator)
                    const isReadResult = content.tool_use_id && typeof contentText === 'string' &&
                      /^\s*\d+→/.test(contentText);

                    if (reminderMatch) {
                      resultTitle = "System Reminder";
                      const reminderMessage = reminderMatch[1].trim();
                      const beforeReminder = contentText.substring(0, reminderMatch.index || 0).trim();
                      const afterReminder = contentText.substring((reminderMatch.index || 0) + reminderMatch[0].length).trim();
                      resultInner = (
                        <div className="space-y-2">
                          {beforeReminder && (
                            <div className="p-2 bg-background rounded-md border">
                              <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">{beforeReminder}</pre>
                            </div>
                          )}
                          <SystemReminderWidget message={reminderMessage} />
                          {afterReminder && (
                            <div className="p-2 bg-background rounded-md border">
                              <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">{afterReminder}</pre>
                            </div>
                          )}
                        </div>
                      );
                    } else if (isEditResult) {
                      resultTitle = "Edit Result";
                      resultInner = <EditResultWidget content={contentText} />;
                    } else if (isMultiEditResult) {
                      resultTitle = "MultiEdit Result";
                      resultInner = <MultiEditResultWidget content={contentText} />;
                    } else if (isLSResult) {
                      resultTitle = "Directory Contents";
                      resultInner = <LSResultWidget content={contentText} />;
                    } else if (isReadResult) {
                      resultTitle = "Read Result";
                      let filePath: string | undefined;
                      if (streamMessages) {
                        for (let i = streamMessages.length - 1; i >= 0; i--) {
                          const prevMsg = streamMessages[i];
                          if (prevMsg.type === 'assistant' && prevMsg.message?.content && Array.isArray(prevMsg.message.content)) {
                            const toolUse = prevMsg.message.content.find((c: any) =>
                              c.type === 'tool_use' &&
                              c.id === content.tool_use_id &&
                              c.name?.toLowerCase() === 'read'
                            );
                            if (toolUse?.input?.file_path) {
                              filePath = toolUse.input.file_path;
                              break;
                            }
                          }
                        }
                      }
                      resultInner = <ReadResultWidget content={contentText} filePath={filePath} />;
                    } else if (!contentText || contentText.trim() === '') {
                      resultInner = (
                        <div className="p-3 bg-muted/50 rounded-md border text-sm text-muted-foreground italic">
                          Tool did not return any output
                        </div>
                      );
                    } else {
                      resultInner = (
                        <div className="p-2 bg-background rounded-md border">
                          <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap">{contentText}</pre>
                        </div>
                      );
                    }

                    renderedSomething = true;
                    return (
                      <div key={idx}>
                        <CollapsibleToolCard
                          memoryId={content.tool_use_id ? `${content.tool_use_id}:result` : undefined}
                          label={resultTitle}
                          preview={truncatePreview(contentText)}
                          borderClass="border-l-border"
                          valueClass="text-muted-foreground"
                          status={content.is_error ? "error" : "success"}
                          defaultExpanded={false}
                        >
                          {resultInner}
                        </CollapsibleToolCard>
                      </div>
                    );
                  }
                  
                  // Text content
                  if (content.type === "text") {
                    // Handle both string and object formats
                    const textContent = typeof content.text === 'string'
                      ? content.text
                      : (content.text?.text || JSON.stringify(content.text));

                    renderedSomething = true;
                    return (
                      <div key={idx} className="text-sm whitespace-pre-wrap">
                        {textContent}
                      </div>
                    );
                  }
                  
                  return null;
                })}
        </div>
      );

      if (!renderedSomething) return null;

      // Tool-result-only user rows: no card/avatar, just the collapsible rows.
      if (userToolOnly) {
        return <div className={cn("py-0.5", className)}>{body}</div>;
      }

      return (
        <Card
          className={cn(className)}
          // Card hardcodes its background via inline style, which beats Tailwind
          // bg-* classes; override inline so the user message reads as a soft,
          // distinct tint across all themes. A low-alpha indigo fill with a
          // slightly brighter indigo border feels modern without glaring.
          style={{
            backgroundColor: "rgba(99, 102, 241, 0.12)",
            borderColor: "rgba(129, 140, 248, 0.5)",
            color: "var(--color-card-foreground)",
          }}
        >
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <User className="h-5 w-5 text-indigo-400 mt-0.5" />
              {body}
            </div>
          </CardContent>
        </Card>
      );
    }

    // Result message - render with markdown
    if (message.type === "result") {
      const isError = message.is_error || message.subtype?.includes("error");
      
      return (
        <Card className={cn(
          isError ? "border-destructive/20 bg-destructive/5" : "border-green-500/20 bg-green-500/5",
          className
        )}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {isError ? (
                <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
              )}
              <div className="flex-1 space-y-2">
                <h4 className="font-semibold text-sm">
                  {isError ? "Execution Failed" : "Execution Complete"}
                </h4>
                
                {message.result && (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents(syntaxTheme)}
                    >
                      {message.result}
                    </ReactMarkdown>
                  </div>
                )}
                
                {message.error && (
                  <div className="text-sm text-destructive">{message.error}</div>
                )}
                
                <div className="text-xs text-muted-foreground space-y-1 mt-2">
                  {(message.cost_usd !== undefined || message.total_cost_usd !== undefined) && (
                    <div>Cost: ${((message.cost_usd || message.total_cost_usd)!).toFixed(4)} USD</div>
                  )}
                  {message.duration_ms !== undefined && (
                    <div>Duration: {(message.duration_ms / 1000).toFixed(2)}s</div>
                  )}
                  {message.num_turns !== undefined && (
                    <div>Turns: {message.num_turns}</div>
                  )}
                  {message.usage && (
                    <div>
                      Total tokens: {message.usage.input_tokens + message.usage.output_tokens} 
                      ({message.usage.input_tokens} in, {message.usage.output_tokens} out)
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    // Skip rendering if no meaningful content
    return null;
  } catch (error) {
    // If any error occurs during rendering, show a safe error message
    console.error("Error rendering stream message:", error, message);
    return (
      <Card className={cn("border-destructive/20 bg-destructive/5", className)}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium">Error rendering message</p>
              <p className="text-xs text-muted-foreground mt-1">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
};

export const StreamMessage = React.memo(StreamMessageComponent);
