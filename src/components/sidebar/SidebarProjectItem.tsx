import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, FolderOpen, Loader2, Plus, Archive, Check, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { apiCall } from '@/lib/apiAdapter';
import { SidebarSessionItem } from './SidebarSessionItem';
import type { Session } from '@/lib/api';
import { useHighlightedSessionIds } from '@/lib/sessionHighlightStore';

interface ProjectItem {
  id: string;
  path: string;
}

interface SidebarProjectItemProps {
  project: ProjectItem;
  activeSessionId?: string;
  activeProjectId?: string;
  runningSessionIds?: Set<string>;
  onSessionSelect: (session: Session, projectPath: string, displayName: string) => void;
  onSessionSelectNewTab: (session: Session, projectPath: string, displayName: string) => void;
  onNewSession: (projectPath: string, name?: string) => void;
  /** Incrementing this triggers a force-reload of sessions without unmounting */
  reloadSignal?: number;
  /** Incrementing this triggers a silent (no-spinner) refresh of sessions */
  silentReloadSignal?: number;
  sessionSearchQuery?: string;
  onSearchResultCountChange?: (projectId: string, count: number) => void;
}

function getProjectBaseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

export const SidebarProjectItem: React.FC<SidebarProjectItemProps> = ({
  project,
  activeSessionId,
  activeProjectId,
  runningSessionIds,
  onSessionSelect,
  onSessionSelectNewTab,
  onNewSession,
  reloadSignal,
  silentReloadSignal,
  sessionSearchQuery = '',
  onSearchResultCountChange,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sessionNames, setSessionNames] = useState<Record<string, string>>({});
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const newSessionInputRef = useRef<HTMLInputElement>(null);
  const highlightedSessionIds = useHighlightedSessionIds();

  const projectName = getProjectBaseName(project.path);
  const normalizedSearchQuery = sessionSearchQuery.trim().toLocaleLowerCase();
  const isSearching = normalizedSearchQuery.length > 0;

  useEffect(() => {
    if (isCreatingSession && newSessionInputRef.current) {
      newSessionInputRef.current.focus();
    }
  }, [isCreatingSession]);

  const handleCreateSessionStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNewSessionName('');
    setIsCreatingSession(true);
  };

  const handleCreateSessionCommit = () => {
    const name = newSessionName.trim();
    setIsCreatingSession(false);
    setNewSessionName('');
    onNewSession(project.path, name || undefined);
  };

  const handleCreateSessionCancel = () => {
    setIsCreatingSession(false);
    setNewSessionName('');
  };

  const handleCreateSessionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleCreateSessionCommit(); }
    else if (e.key === 'Escape') { e.preventDefault(); handleCreateSessionCancel(); }
  };

  // Auto-expand and load sessions when this project becomes the active one.
  useEffect(() => {
    if (activeProjectId !== project.id) return;
    if (!isExpanded) setIsExpanded(true);
    if (!loaded) loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, project.id]);

  useEffect(() => {
    if (reloadSignal && reloadSignal > 0 && isExpanded) {
      loadSessions(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal]);

  useEffect(() => {
    if (silentReloadSignal && silentReloadSignal > 0 && isExpanded) {
      loadSessions(true, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [silentReloadSignal]);

  // Search should include sessions in collapsed projects, so load them on demand.
  useEffect(() => {
    if (isSearching && !loaded) loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSearching, loaded]);

  const loadSessions = async (force = false, silent = false) => {
    if (loaded && !force) return;
    if (!silent) setLoading(true);
    try {
      const [result, archived] = await Promise.all([
        apiCall<Session[]>('get_project_sessions', { projectId: project.id }),
        apiCall<string[]>('get_archived_sessions', {}),
      ]);
      setSessions(result);
      setArchivedIds(new Set(archived));
      setLoaded(true);

      // Custom names rarely change; skip the extra round-trips on silent
      // auto-refreshes and only refetch them on explicit (re)loads.
      if (!silent) {
        const namesMap: Record<string, string> = {};
        await Promise.all(
          result.map(async (s) => {
            try {
              const name = await apiCall<string | null>('get_session_name', { sessionId: s.id });
              if (name) namesMap[s.id] = name;
            } catch (_) {
              // no custom name
            }
          })
        );
        setSessionNames(namesMap);
      }
    } catch (err) {
      console.error('[Sidebar] Failed to load sessions for project:', project.id, err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleToggle = () => {
    const next = !isExpanded;
    setIsExpanded(next);
    if (next) loadSessions();
  };

  const getDisplayName = (session: Session): string => {
    if (sessionNames[session.id]) return sessionNames[session.id];
    if (session.first_message) {
      const text = session.first_message.trim();
      return text.length > 40 ? text.slice(0, 40) + '...' : text;
    }
    return session.id.slice(0, 16) + '...';
  };

  const handleDeleteSession = (sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setArchivedIds((prev) => { const n = new Set(prev); n.delete(sessionId); return n; });
  };

  const handleRenameSession = (sessionId: string, newName: string) => {
    setSessionNames((prev) => ({ ...prev, [sessionId]: newName }));
  };

  const handleArchiveSession = (sessionId: string) => {
    setArchivedIds((prev) => new Set([...prev, sessionId]));
  };

  const handleUnarchiveSession = (sessionId: string) => {
    setArchivedIds((prev) => { const n = new Set(prev); n.delete(sessionId); return n; });
  };

  const handleProjectContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const { Menu, MenuItem } = await import('@tauri-apps/api/menu');
      const { LogicalPosition } = await import('@tauri-apps/api/dpi');

      const newSessionItem = await MenuItem.new({
        id: 'new-session',
        text: 'New Session',
        action: () => onNewSession(project.path),
      });

      const { PredefinedMenuItem } = await import('@tauri-apps/api/menu');
      const sep1 = await PredefinedMenuItem.new({ item: 'Separator' });

      const copyPathItem = await MenuItem.new({
        id: 'copy-project-path',
        text: 'Copy Project Path',
        action: async () => {
          try {
            await navigator.clipboard.writeText(project.path);
          } catch (_) {
            const ta = document.createElement('textarea');
            ta.value = project.path;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
        },
      });

      const revealItem = await MenuItem.new({
        id: 'reveal-in-finder',
        text: 'Reveal in Finder',
        action: () => apiCall('reveal_path_in_finder', { path: project.path }),
      });

      const menuItems: any[] = [newSessionItem, sep1, copyPathItem, revealItem];

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
      console.error('[SidebarProjectItem] Failed to show context menu:', err);
    }
  };

  const visibleSessions = sessions.filter((session) => {
    const matchesArchiveFilter = showArchived
      ? archivedIds.has(session.id)
      : !archivedIds.has(session.id);
    if (!matchesArchiveFilter) return false;
    if (!isSearching) return true;

    const searchableName = sessionNames[session.id] || session.first_message || '';
    return `${searchableName} ${session.id}`.toLocaleLowerCase().includes(normalizedSearchQuery);
  });
  // Preserve the API's existing age order within each group.
  const highlightedSessions = visibleSessions.filter((session) => highlightedSessionIds.has(session.id));
  const regularSessions = visibleSessions.filter((session) => !highlightedSessionIds.has(session.id));
  const orderedVisibleSessions = [...highlightedSessions, ...regularSessions];
  const archivedCount = sessions.filter((s) => archivedIds.has(s.id)).length;

  useEffect(() => {
    if (isSearching && loaded) {
      onSearchResultCountChange?.(project.id, orderedVisibleSessions.length);
    }
  }, [isSearching, loaded, onSearchResultCountChange, orderedVisibleSessions.length, project.id]);

  if (isSearching && loaded && orderedVisibleSessions.length === 0) {
    return null;
  }

  const renderSession = (session: Session, isPinnedGroup = false) => (
    <SidebarSessionItem
      key={session.id}
      session={session}
      projectId={project.id}
      isActive={session.id === activeSessionId}
      isRunning={runningSessionIds ? runningSessionIds.has(session.id) : false}
      isArchived={archivedIds.has(session.id)}
      isPinnedGroup={isPinnedGroup}
      displayName={getDisplayName(session)}
      onClick={() => onSessionSelect(session, project.path, getDisplayName(session))}
      onOpenInNewTab={() => onSessionSelectNewTab(session, project.path, getDisplayName(session))}
      onRefreshSessions={() => loadSessions(true)}
      onDelete={handleDeleteSession}
      onRename={handleRenameSession}
      onArchive={handleArchiveSession}
      onUnarchive={handleUnarchiveSession}
    />
  );

  return (
    <div className="mb-1">
      {/* Project header row */}
      <button
        onClick={handleToggle}
        onContextMenu={handleProjectContextMenu}
        className={cn(
          'w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium',
          'text-foreground/80 hover:text-foreground hover:bg-accent/50 transition-colors text-left'
        )}
      >
        {isExpanded ? (
          <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-muted-foreground" />
        )}
        <FolderOpen size={13} className="shrink-0 text-primary/70" />
        <span className="truncate text-xs">{projectName}</span>
        {loading && <Loader2 size={11} className="shrink-0 animate-spin text-muted-foreground ml-auto" />}
      </button>

      {/* Sessions list */}
      {(isExpanded || isSearching) && (
        <div className="pl-5 mt-0.5 space-y-0.5">
          {/* New Session button / inline name input */}
          {!showArchived && !isSearching && (
            isCreatingSession ? (
              <div className="flex items-center gap-1 px-2 py-1" onClick={(e) => e.stopPropagation()}>
                <Plus size={11} className="shrink-0 text-muted-foreground" />
                <Input
                  ref={newSessionInputRef}
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  onKeyDown={handleCreateSessionKeyDown}
                  onBlur={handleCreateSessionCommit}
                  placeholder="Session name (optional)"
                  className="h-5 px-1 py-0 text-xs flex-1 min-w-0"
                />
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleCreateSessionCommit(); }}
                  className="text-green-500 hover:text-green-400 shrink-0"
                  title="Create session"
                >
                  <Check size={12} />
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleCreateSessionCancel(); }}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  title="Cancel"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={handleCreateSessionStart}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              >
                <Plus size={11} />
                New Session
              </button>
            )
          )}
          {visibleSessions.length === 0 && !loading && !isSearching && (
            <p className="text-[10px] text-muted-foreground px-2 py-1">
              {showArchived ? 'No archived sessions' : 'No sessions'}
            </p>
          )}
          {highlightedSessions.length > 0 && (
            <div className="overflow-hidden rounded-md bg-muted/65">
              {highlightedSessions.map((session) => renderSession(session, true))}
            </div>
          )}
          {regularSessions.map((session) => renderSession(session))}
          {/* Show/Hide Archived toggle */}
          {archivedCount > 0 && !isSearching && (
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent/30 transition-colors"
            >
              <Archive size={10} />
              {showArchived
                ? 'Hide Archived'
                : `Show Archived (${archivedCount})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
