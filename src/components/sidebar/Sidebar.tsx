/**
 * Sidebar component — collapsible left panel showing projects & sessions.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Search, X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { apiCall } from '@/lib/apiAdapter';
import { SidebarProjectItem } from './SidebarProjectItem';
import type { Project, Session } from '@/lib/api';

interface SidebarProps {
  onSessionSelect: (session: Session, projectPath: string, displayName: string) => void;
  onSessionOpenInNewTab: (session: Session, projectPath: string, displayName: string) => void;
  onNewSession: (projectPath: string, name?: string) => void;
  onOpenProject?: () => void;
  activeSessionId?: string;
  activeProjectId?: string;
  isOpen: boolean;
  onToggle: () => void;
  className?: string;
}

const SIDEBAR_WIDTH_DEFAULT = 260;
const SIDEBAR_WIDTH_MIN = 180;
const SIDEBAR_WIDTH_MAX = 480;
const RUNNING_SESSIONS_POLL_INTERVAL = 5000;
const SESSIONS_AUTO_REFRESH_INTERVAL = 30000;

export const Sidebar: React.FC<SidebarProps> = ({
  onSessionSelect,
  onSessionOpenInNewTab,
  onNewSession,
  onOpenProject,
  activeSessionId,
  activeProjectId,
  isOpen,
  onToggle,
  className,
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(new Set());
  const [reloadSignal, setReloadSignal] = useState(0);
  const [silentReloadSignal, setSilentReloadSignal] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH_DEFAULT);
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [searchResultCounts, setSearchResultCounts] = useState<Record<string, number>>({});
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall<Project[]>('list_projects');
      setProjects(result);
      setReloadSignal((n) => n + 1);
    } catch (err) {
      console.error('[Sidebar] Failed to load projects:', err);
      setError('Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  const pollRunningSessions = async () => {
    try {
      const claudeRuns = await apiCall<Array<{ process_type: { ClaudeSession?: { session_id: string } } }>>('list_running_claude_sessions');
      const ids = new Set(
        claudeRuns
          .map((r) => r.process_type?.ClaudeSession?.session_id)
          .filter((id): id is string => Boolean(id))
      );
      setRunningSessionIds(ids);
    } catch {
      // Polling failures are non-fatal; ignore and retry on the next interval
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadProjects();
      pollRunningSessions();
      pollingIntervalRef.current = setInterval(pollRunningSessions, RUNNING_SESSIONS_POLL_INTERVAL);
    } else {
      if (pollingIntervalRef.current !== null) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
    return () => {
      if (pollingIntervalRef.current !== null) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [isOpen]);

  // Periodically refresh sessions in the background so each session's "last
  // active" time tracks new activity without a manual refresh. This is silent:
  // no spinner, and it skips the per-session name lookups.
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => {
      setSilentReloadSignal((n) => n + 1);
    }, SESSIONS_AUTO_REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [isOpen]);

  // Allow other parts of the app (e.g. a freshly named new session) to ask the
  // sidebar to reload sessions (including custom names).
  useEffect(() => {
    const handler = () => setReloadSignal((n) => n + 1);
    window.addEventListener('opcode-refresh-sessions', handler);
    return () => window.removeEventListener('opcode-refresh-sessions', handler);
  }, []);

  // Sidebar-wide context menu: always show our custom menu anywhere in the sidebar
  const handleSidebarContextMenu = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only handle events that weren't already handled by a session item
    // (session items call stopPropagation so this only fires for non-session areas)
    try {
      const { Menu, MenuItem } = await import('@tauri-apps/api/menu');
      const { LogicalPosition } = await import('@tauri-apps/api/dpi');

      const openProjectItem = await MenuItem.new({
        id: 'open-project',
        text: 'Open Project…',
        action: () => onOpenProject?.(),
      });

      const { PredefinedMenuItem } = await import('@tauri-apps/api/menu');
      const sep1 = await PredefinedMenuItem.new({ item: 'Separator' });

      const refreshItem = await MenuItem.new({
        id: 'refresh-sessions',
        text: 'Refresh Sessions',
        action: () => loadProjects(),
      });

      const menuItems: any[] = [openProjectItem, sep1, refreshItem];

      if (import.meta.env.DEV) {
        const sep = await PredefinedMenuItem.new({ item: 'Separator' });
        const inspectItem = await MenuItem.new({
          id: 'inspect-element',
          text: 'Inspect Element',
          action: () => apiCall('open_devtools', {}),
        });
        menuItems.push(sep, inspectItem);
      }

      const menu = await Menu.new({ items: menuItems });
      await menu.popup(new LogicalPosition(e.clientX, e.clientY));
    } catch (err) {
      console.error('[Sidebar] Failed to show context menu:', err);
    }
  }, []);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = ev.clientX - dragStartXRef.current;
      const next = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, dragStartWidthRef.current + delta));
      setSidebarWidth(next);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleSearchQueryChange = (query: string) => {
    setSessionSearchQuery(query);
    setSearchResultCounts({});
  };

  const handleSearchResultCount = useCallback((projectId: string, count: number) => {
    setSearchResultCounts((current) =>
      current[projectId] === count ? current : { ...current, [projectId]: count },
    );
  }, []);

  const isSearching = sessionSearchQuery.trim().length > 0;
  const searchIsComplete = isSearching
    && projects.length > 0
    && projects.every((project) => searchResultCounts[project.id] !== undefined);
  const hasNoSearchResults = searchIsComplete
    && Object.values(searchResultCounts).every((count) => count === 0);

  return (
    <div
      className={cn(
        'relative flex flex-col h-full min-h-0 border-r border-border/50 bg-background/95 backdrop-blur-sm overflow-hidden shrink-0',
        !isOpen && 'w-0 border-r-0',
        className
      )}
      style={{ width: isOpen ? sidebarWidth : 0, transition: isDraggingRef.current ? 'none' : 'width 0.2s' }}
      onContextMenu={handleSidebarContextMenu}
    >
      {isOpen && (
        <>
          {/* Sidebar header */}
          <div className="shrink-0 border-b border-border/40 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Sessions
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={loadProjects}
                  disabled={loading}
                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                  title="Refresh"
                >
                  <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={onToggle}
                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title="Collapse sidebar"
                >
                  <ChevronLeft size={14} />
                </button>
              </div>
            </div>
            <div className="relative mt-2">
              <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={sessionSearchQuery}
                onChange={(event) => handleSearchQueryChange(event.target.value)}
                placeholder="Search sessions"
                className="h-7 w-full rounded-md border border-border/60 bg-muted/30 py-1 pl-7 pr-7 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60 focus:bg-background"
                aria-label="Search sessions by name or ID"
              />
              {sessionSearchQuery && (
                <button
                  onClick={() => handleSearchQueryChange('')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Clear search"
                  aria-label="Clear session search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Scrollable project list */}
          <ScrollArea className="flex-1 min-h-0">
            <div
              className="px-2 py-2"
              style={{ paddingBottom: 'calc(var(--opcode-prompt-bar-height, 96px) + 8px)' }}
            >
              {error && (
                <p className="text-xs text-destructive px-2 py-1">{error}</p>
              )}
              {!error && projects.length === 0 && !loading && (
                <p className="text-xs text-muted-foreground px-2 py-1">No projects found</p>
              )}
              {hasNoSearchResults && (
                <p className="px-2 py-3 text-xs text-muted-foreground">No matching sessions</p>
              )}
              {projects.map((project) => (
                <SidebarProjectItem
                  key={project.id}
                  project={project}
                  activeSessionId={activeSessionId}
                  activeProjectId={activeProjectId}
                  runningSessionIds={runningSessionIds}
                  onSessionSelect={onSessionSelect}
                  onSessionSelectNewTab={onSessionOpenInNewTab}
                  onNewSession={onNewSession}
                  reloadSignal={reloadSignal}
                  silentReloadSignal={silentReloadSignal}
                  sessionSearchQuery={sessionSearchQuery}
                  onSearchResultCountChange={handleSearchResultCount}
                />
              ))}
            </div>
          </ScrollArea>
        </>
      )}
      {/* Drag handle — sits on the right edge */}
      {isOpen && (
        <div
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 transition-colors z-10"
          onMouseDown={handleResizeMouseDown}
        />
      )}
    </div>
  );
};

/**
 * Small toggle button shown outside the sidebar when it is collapsed.
 */
export const SidebarToggleButton: React.FC<{
  onClick: () => void;
  isOpen: boolean;
}> = ({ onClick, isOpen }) => {
  if (isOpen) return null;
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center w-6 h-full border-r border-border/40 bg-background/80 hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground shrink-0"
      title="Open session sidebar"
    >
      <ChevronRight size={14} />
    </button>
  );
};
