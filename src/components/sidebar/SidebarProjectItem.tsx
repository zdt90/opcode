import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, FolderOpen, Loader2, Plus, Archive, Check, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { apiCall } from '@/lib/apiAdapter';
import { SidebarSessionItem } from './SidebarSessionItem';
import type { Session } from '@/lib/api';

interface ProjectItem {
  id: string;
  path: string;
}

interface SidebarProjectItemProps {
  project: ProjectItem;
  activeSessionId?: string;
  runningSessionIds?: Set<string>;
  onSessionSelect: (session: Session, projectPath: string, displayName: string) => void;
  onSessionSelectNewTab: (session: Session, projectPath: string, displayName: string) => void;
  onNewSession: (projectPath: string, name?: string) => void;
  /** Incrementing this triggers a force-reload of sessions without unmounting */
  reloadSignal?: number;
  /** Incrementing this triggers a silent (no-spinner) refresh of sessions */
  silentReloadSignal?: number;
}

function getProjectBaseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

export const SidebarProjectItem: React.FC<SidebarProjectItemProps> = ({
  project,
  activeSessionId,
  runningSessionIds,
  onSessionSelect,
  onSessionSelectNewTab,
  onNewSession,
  reloadSignal,
  silentReloadSignal,
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

  const projectName = getProjectBaseName(project.path);

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

      const menuItems: any[] = [newSessionItem];

      if (import.meta.env.DEV) {
        const { PredefinedMenuItem } = await import('@tauri-apps/api/menu');
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

  const visibleSessions = sessions.filter((s) =>
    showArchived ? archivedIds.has(s.id) : !archivedIds.has(s.id)
  );
  const archivedCount = sessions.filter((s) => archivedIds.has(s.id)).length;

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
      {isExpanded && (
        <div className="pl-5 mt-0.5 space-y-0.5">
          {/* New Session button / inline name input */}
          {!showArchived && (
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
          {visibleSessions.length === 0 && !loading && (
            <p className="text-[10px] text-muted-foreground px-2 py-1">
              {showArchived ? 'No archived sessions' : 'No sessions'}
            </p>
          )}
          {visibleSessions.map((session) => (
            <SidebarSessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              isRunning={runningSessionIds ? runningSessionIds.has(session.id) : false}
              isArchived={archivedIds.has(session.id)}
              displayName={getDisplayName(session)}
              onClick={() => onSessionSelect(session, project.path, getDisplayName(session))}
              onOpenInNewTab={() => onSessionSelectNewTab(session, project.path, getDisplayName(session))}
              onRefreshSessions={() => loadSessions(true)}
              onDelete={handleDeleteSession}
              onRename={handleRenameSession}
              onArchive={handleArchiveSession}
              onUnarchive={handleUnarchiveSession}
            />
          ))}
          {/* Show/Hide Archived toggle */}
          {archivedCount > 0 && (
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
