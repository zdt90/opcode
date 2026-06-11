import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, FolderOpen, Loader2, Plus } from 'lucide-react';
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
  onNewSession: (projectPath: string) => void;
  /** Incrementing this triggers a force-reload of sessions without unmounting */
  reloadSignal?: number;
}

function getProjectBaseName(path: string): string {
  // Handle both Unix and Windows-style paths
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
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sessionNames, setSessionNames] = useState<Record<string, string>>({});

  const projectName = getProjectBaseName(project.path);

  // When the parent bumps reloadSignal, reload sessions if already expanded
  useEffect(() => {
    if (reloadSignal && reloadSignal > 0 && isExpanded) {
      loadSessions(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal]);

  const loadSessions = async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    try {
      const result = await apiCall<Session[]>('get_project_sessions', { projectId: project.id });
      setSessions(result);
      setLoaded(true);

      // Load custom names for all sessions
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
    } catch (err) {
      console.error('[Sidebar] Failed to load sessions for project:', project.id, err);
    } finally {
      setLoading(false);
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
  };

  const handleRenameSession = (sessionId: string, newName: string) => {
    setSessionNames((prev) => ({ ...prev, [sessionId]: newName }));
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
          {/* New Session button */}
          <button
            onClick={(e) => { e.stopPropagation(); onNewSession(project.path); }}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <Plus size={11} />
            New Session
          </button>
          {sessions.length === 0 && !loading && (
            <p className="text-[10px] text-muted-foreground px-2 py-1">No sessions</p>
          )}
          {sessions.map((session) => (
            <SidebarSessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              isRunning={runningSessionIds ? runningSessionIds.has(session.id) : false}
              displayName={getDisplayName(session)}
              onClick={() => onSessionSelect(session, project.path, getDisplayName(session))}
              onOpenInNewTab={() => onSessionSelectNewTab(session, project.path, getDisplayName(session))}
              onRefreshSessions={() => loadSessions(true)}
              onDelete={handleDeleteSession}
              onRename={handleRenameSession}
            />
          ))}
        </div>
      )}
    </div>
  );
};
