import { useEffect, useState } from 'react';
import { apiCall } from '@/lib/apiAdapter';

const RUNNING_SESSIONS_POLL_INTERVAL = 5000;

interface RunningClaudeSession {
  process_type?: {
    ClaudeSession?: {
      session_id?: string;
    };
  };
}

export function useRunningSessionIds(enabled = true): Set<string> {
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) {
      setRunningSessionIds(new Set());
      return;
    }

    let cancelled = false;

    const pollRunningSessions = async () => {
      try {
        const claudeRuns = await apiCall<RunningClaudeSession[]>('list_running_claude_sessions');
        if (cancelled) return;

        const nextRunningSessionIds = new Set(
          claudeRuns
            .map((run) => run.process_type?.ClaudeSession?.session_id)
            .filter((sessionId): sessionId is string => Boolean(sessionId))
        );

        setRunningSessionIds((currentRunningSessionIds) => {
          const unchanged = currentRunningSessionIds.size === nextRunningSessionIds.size
            && [...currentRunningSessionIds].every((sessionId) => nextRunningSessionIds.has(sessionId));
          return unchanged ? currentRunningSessionIds : nextRunningSessionIds;
        });
      } catch {
        // Polling failures are non-fatal; keep the last known state and retry.
      }
    };

    pollRunningSessions();
    const intervalId = setInterval(pollRunningSessions, RUNNING_SESSIONS_POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [enabled]);

  return runningSessionIds;
}
