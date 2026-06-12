import React, { useState, useRef, useEffect } from 'react';
import { Pencil, Trash2, Check, X, AlertTriangle, EyeOff, ArchiveRestore } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatTimeAgoBrief } from '@/lib/date-utils';
import { apiCall } from '@/lib/apiAdapter';
import type { Session } from '@/lib/api';

interface SidebarSessionItemProps {
  session: Session;
  isActive: boolean;
  isRunning?: boolean;
  isArchived?: boolean;
  displayName: string;
  onClick: () => void;
  onOpenInNewTab: () => void;
  onRefreshSessions: () => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, newName: string) => void;
  onArchive: (sessionId: string) => void;
  onUnarchive: (sessionId: string) => void;
}

function getSessionTimestampMs(session: Session): number {
  if (session.last_updated_at) return session.last_updated_at * 1000;
  return session.created_at * 1000;
}

const RELATIVE_TIME_UPDATE_INTERVAL = 60_000;

export const SidebarSessionItem: React.FC<SidebarSessionItemProps> = ({
  session,
  isActive,
  isRunning = false,
  isArchived = false,
  displayName,
  onClick,
  onOpenInNewTab,
  onRefreshSessions,
  onDelete,
  onRename,
  onArchive,
  onUnarchive,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(displayName);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [relativeTime, setRelativeTime] = useState(() =>
    formatTimeAgoBrief(getSessionTimestampMs(session))
  );

  useEffect(() => {
    setRelativeTime(formatTimeAgoBrief(getSessionTimestampMs(session)));
    const interval = setInterval(() => {
      setRelativeTime(formatTimeAgoBrief(getSessionTimestampMs(session)));
    }, RELATIVE_TIME_UPDATE_INTERVAL);
    return () => clearInterval(interval);
  }, [session.id, session.last_updated_at, session.created_at]);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const { Menu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu');
      const { LogicalPosition } = await import('@tauri-apps/api/dpi');

      const openInNewTabItem = await MenuItem.new({
        id: 'open-in-new-tab',
        text: 'Open in New Tab',
        action: () => onOpenInNewTab(),
      });

      const copyIdItem = await MenuItem.new({
        id: 'copy-session-id',
        text: 'Copy Session ID',
        action: async () => {
          try {
            await navigator.clipboard.writeText(session.id);
          } catch (_) {
            const ta = document.createElement('textarea');
            ta.value = session.id;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
        },
      });

      const sep1 = await PredefinedMenuItem.new({ item: 'Separator' });

      const renameItem = await MenuItem.new({
        id: 'rename-session',
        text: 'Rename Session',
        action: () => { setRenameValue(displayName); setIsRenaming(true); },
      });

      const archiveItem = await MenuItem.new({
        id: isArchived ? 'unarchive-session' : 'archive-session',
        text: isArchived ? 'Unarchive Session' : 'Archive Session',
        action: async () => {
          if (isArchived) {
            await apiCall('unarchive_session', { sessionId: session.id });
            onUnarchive(session.id);
          } else {
            await apiCall('archive_session', { sessionId: session.id });
            onArchive(session.id);
          }
        },
      });

      const deleteItem = await MenuItem.new({
        id: 'delete-session',
        text: 'Delete Session',
        action: () => setConfirmDeleteOpen(true),
      });

      const sep2 = await PredefinedMenuItem.new({ item: 'Separator' });

      const reloadItem = await MenuItem.new({
        id: 'refresh-sessions',
        text: 'Refresh Sessions',
        action: () => onRefreshSessions(),
      });

      const menuItems: any[] = [openInNewTabItem, copyIdItem, sep1, renameItem, archiveItem, deleteItem, sep2, reloadItem];

      if (import.meta.env.DEV) {
        const inspectItem = await MenuItem.new({
          id: 'inspect-element',
          text: 'Inspect Element',
          action: () => apiCall('open_devtools', {}),
        });
        menuItems.push(inspectItem);
      }

      const menu = await Menu.new({ items: menuItems });
      await menu.popup(new LogicalPosition(e.clientX, e.clientY));
    } catch (err) {
      console.error('[SidebarSessionItem] Failed to show context menu:', err);
    }
  };

  const handleRenameStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(displayName);
    setIsRenaming(true);
  };

  const handleRenameCommit = async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== displayName) {
      try {
        await apiCall('rename_session', { sessionId: session.id, name: trimmed });
        onRename(session.id, trimmed);
      } catch (err) {
        console.error('[Sidebar] Failed to rename session:', err);
      }
    }
    setIsRenaming(false);
  };

  const handleRenameCancel = () => {
    setRenameValue(displayName);
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleRenameCommit(); }
    else if (e.key === 'Escape') { handleRenameCancel(); }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteOpen(true);
  };

  const handleArchiveConfirm = async () => {
    setConfirmDeleteOpen(false);
    try {
      await apiCall('archive_session', { sessionId: session.id });
      onArchive(session.id);
    } catch (err) {
      console.error('[Sidebar] Failed to archive session:', err);
    }
  };

  const handleDeleteConfirm = async () => {
    setConfirmDeleteOpen(false);
    try {
      await apiCall('delete_session', { sessionId: session.id });
      onDelete(session.id);
    } catch (err) {
      console.error('[Sidebar] Failed to delete session:', err);
    }
  };

  return (
    <>
    <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
      <DialogContent className="sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-destructive/15 flex items-center justify-center">
              <AlertTriangle size={18} className="text-destructive" />
            </div>
            <DialogTitle>Delete Session</DialogTitle>
          </div>
          <p className="text-sm text-muted-foreground pl-[52px]">
            What would you like to do with{' '}
            <span className="font-semibold text-foreground">{displayName}</span>?
            Archive keeps the session out of the active list while preserving its history.
          </p>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-2">
          <button
            onClick={handleArchiveConfirm}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent transition-colors"
          >
            <EyeOff size={14} className="text-muted-foreground" />
            Archive session
          </button>
          <button
            onClick={handleDeleteConfirm}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors"
          >
            <Trash2 size={14} />
            Delete permanently
          </button>
          <button
            onClick={() => setConfirmDeleteOpen(false)}
            className="w-full px-4 py-2.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>

    <div
      className={cn(
        'group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors',
        isActive
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
        isArchived && 'opacity-60'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={isRenaming ? undefined : onClick}
      onContextMenu={handleContextMenu}
    >
      {isRenaming ? (
        <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
          <Input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameCommit}
            className="h-5 px-1 py-0 text-xs flex-1 min-w-0"
          />
          <button
            onClick={(e) => { e.stopPropagation(); handleRenameCommit(); }}
            className="text-green-500 hover:text-green-400 shrink-0"
          >
            <Check size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleRenameCancel(); }}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <>
          {isRunning && (
            <span
              className="w-2 h-2 rounded-full bg-green-500 shrink-0 shadow-[0_0_4px_rgba(34,197,94,0.6)]"
              title="Session is running"
            />
          )}
          {isArchived && !isRunning && (
            <span title="Archived">
              <EyeOff size={10} className="shrink-0 text-muted-foreground/50" />
            </span>
          )}
          <div className="flex-1 min-w-0 flex items-baseline justify-between gap-1.5 overflow-hidden">
            <span className="truncate text-xs font-medium text-foreground/90 leading-tight">{displayName}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground/60 leading-tight ml-auto">{relativeTime}</span>
          </div>

          {isHovered && !isActive && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={handleRenameStart}
                className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Rename session"
              >
                <Pencil size={11} />
              </button>
              {isArchived ? (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await apiCall('unarchive_session', { sessionId: session.id });
                    onUnarchive(session.id);
                  }}
                  className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  title="Unarchive session"
                >
                  <ArchiveRestore size={11} />
                </button>
              ) : (
                <button
                  onClick={handleDeleteClick}
                  className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                  title="Delete session"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
    </>
  );
};
