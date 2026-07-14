/**
 * Persists the last-used model per Claude session ID.
 * Stored as a flat JSON object in localStorage so it survives tab/app restarts.
 */

import { normalizeModelId, type ModelId } from "@/lib/claudeModels";

const STORAGE_KEY = "opcode_session_models";
const MAX_ENTRIES = 200; // trim oldest entries to avoid unbounded growth

type SessionModelMap = Record<string, ModelId>;

function load(): SessionModelMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SessionModelMap) : {};
  } catch {
    return {};
  }
}

function save(map: SessionModelMap): void {
  try {
    const keys = Object.keys(map);
    // Trim to MAX_ENTRIES by removing the first (oldest) entries
    const trimmed =
      keys.length > MAX_ENTRIES
        ? Object.fromEntries(keys.slice(keys.length - MAX_ENTRIES).map((k) => [k, map[k]]))
        : map;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage errors (e.g. private browsing quota)
  }
}

export const sessionModelStore = {
  get(sessionId: string): ModelId | null {
    const value = load()[sessionId];
    return value ? normalizeModelId(value) : null;
  },

  set(sessionId: string, model: ModelId): void {
    const map = load();
    map[sessionId] = model;
    save(map);
  },
};
