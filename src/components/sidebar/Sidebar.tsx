/**
 * Sidebar component — collapsible left panel showing projects & sessions.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { apiCall } from '@/lib/apiAdapter';
import { SidebarProjectItem } from './SidebarProjectItem';
import type { Project, Session } from '@/lib/api';

interface SidebarProps {
  onSessionSelect: (session: Session, projectPath: string, displayName: string) => void;
  onSessionOpenInNewTab: (session: Session, projectPath: string, displayName: string) => void;
  onNewSession: (projectPath: string) => void;
  activeSessionId?: string;
  isOpen: boolean;
  onToggle: () => void;
  className?: string;
}

const SIDEBAR_WIDTH_DEFAULT = 260;
const SIDEBAR_WIDTH_MIN = 180;
const SIDEBAR_WIDTH_MAX = 480;
const RUNNING_SESSIONS_POLL_INTERVAL = 5000;

export const Sidebar: React.FC<SidebarProps> = ({
  onSessionSelect,
  onSessionOpenInNewTab,
  onNewSession,
  activeSessionId,
  isOpen,
  onToggle,
  className,
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(new Set());
  const [reloadSignal, setReloadSignal] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH_DEFAULT);
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

  // Sidebar-wide context menu: always show our custom menu anywhere in the sidebar
  const handleSidebarContextMenu = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only handle events that weren't already handled by a session item
    // (session items call stopPropagation so this only fires for non-session areas)
    try {
      const { Menu, MenuItem } = await import('@tauri-apps/api/menu');
      const { LogicalPosition } = await import('@tauri-apps/api/dpi');

      const refreshItem = await MenuItem.new({
        id: 'refresh-sessions',
        text: 'Refresh Sessions',
        action: () => loadProjects(),
      });

      const menuItems: any[] = [refreshItem];

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

  return (
    <div
      className={cn(
        'relative flex flex-col h-full border-r border-border/50 bg-background/95 backdrop-blur-sm overflow-hidden shrink-0',
        !isOpen && 'w-0 border-r-0',
        className
      )}
      style={{ width: isOpen ? sidebarWidth : 0, transition: isDraggingRef.current ? 'none' : 'width 0.2s' }}
      onContextMenu={handleSidebarContextMenu}
    >
      {isOpen && (
        <>
          {/* Sidebar header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
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

          {/* Scrollable project list */}
          <ScrollArea className="flex-1">
            <div className="px-2 py-2">
              {error && (
                <p className="text-xs text-destructive px-2 py-1">{error}</p>
              )}
              {!error && projects.length === 0 && !loading && (
                <p className="text-xs text-muted-foreground px-2 py-1">No projects found</p>
              )}
              {projects.map((project) => (
                <SidebarProjectItem
                  key={project.id}
                  project={project}
                  activeSessionId={activeSessionId}
                  runningSessionIds={runningSessionIds}
                  onSessionSelect={onSessionSelect}
                  onSessionSelectNewTab={onSessionOpenInNewTab}
                  onNewSession={onNewSession}
                  reloadSignal={reloadSignal}
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
