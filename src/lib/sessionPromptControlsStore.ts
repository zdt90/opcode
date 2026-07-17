/**
 * Persists prompt controls per Claude session ID.
 */

export type ClaudeEffort = "auto" | "low" | "medium" | "high" | "xhigh" | "max";
export type ClaudePermissionMode = "default" | "plan";

export interface SessionPromptControls {
  effort: ClaudeEffort;
  permissionMode: ClaudePermissionMode;
}

const STORAGE_KEY = "opcode_session_prompt_controls";
const MAX_ENTRIES = 200;
const DEFAULT_CONTROLS: SessionPromptControls = {
  effort: "auto",
  permissionMode: "default",
};

type SessionPromptControlsMap = Record<string, SessionPromptControls>;

const isEffort = (value: unknown): value is ClaudeEffort =>
  ["auto", "low", "medium", "high", "xhigh", "max"].includes(String(value));

const isPermissionMode = (value: unknown): value is ClaudePermissionMode =>
  value === "default" || value === "plan";

function load(): SessionPromptControlsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SessionPromptControlsMap) : {};
  } catch {
    return {};
  }
}

function save(map: SessionPromptControlsMap): void {
  try {
    const keys = Object.keys(map);
    const trimmed = keys.length > MAX_ENTRIES
      ? Object.fromEntries(keys.slice(keys.length - MAX_ENTRIES).map((key) => [key, map[key]]))
      : map;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage errors.
  }
}

export const sessionPromptControlsStore = {
  get(sessionId: string): SessionPromptControls {
    const stored = load()[sessionId];
    return {
      effort: isEffort(stored?.effort) ? stored.effort : DEFAULT_CONTROLS.effort,
      permissionMode: isPermissionMode(stored?.permissionMode)
        ? stored.permissionMode
        : DEFAULT_CONTROLS.permissionMode,
    };
  },

  set(sessionId: string, controls: SessionPromptControls): void {
    const map = load();
    map[sessionId] = controls;
    save(map);
  },
};
