import { useSyncExternalStore } from "react";

const STORAGE_KEY = "opcode_session_highlights";
const MAX_ENTRIES = 500;

type Listener = () => void;

function load(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();

    const entries = JSON.parse(raw);
    return new Set(
      Array.isArray(entries)
        ? entries.filter((entry): entry is string => typeof entry === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

let highlightedSessionIds: ReadonlySet<string> = load();
const listeners = new Set<Listener>();

function save(next: ReadonlySet<string>): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(next).slice(-MAX_ENTRIES)),
    );
  } catch {
    // Keep the current in-memory state if storage is unavailable.
  }
}

function publish(next: ReadonlySet<string>): void {
  highlightedSessionIds = next;
  save(next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ReadonlySet<string> {
  return highlightedSessionIds;
}

export function useHighlightedSessionIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function toggleSessionHighlight(sessionId: string): void {
  const next = new Set(highlightedSessionIds);
  if (next.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  publish(next);
}

export function removeSessionHighlight(sessionId: string): void {
  if (!highlightedSessionIds.has(sessionId)) return;
  const next = new Set(highlightedSessionIds);
  next.delete(sessionId);
  publish(next);
}
