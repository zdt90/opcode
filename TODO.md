# opcode TODO

## Open Items

1. **Debug green dot** — Running session indicator (green dot) not showing in sidebar. Root cause suspected: `list_running_claude_sessions` returns data but session IDs may not match. Debug logging already present in `Sidebar.tsx`.

2. **Archive sessions** — Add archive support via `~/.claude/opcode-metadata.json` (add `archived_sessions: string[]`). Claude Code has no native archive; this would be a pure UI/metadata layer. Right-click menu placeholder "Delete/Archive" already noted.

3. **Resizable sidebar** — Allow user to drag the sidebar edge to resize width. Currently fixed at 260px (`SIDEBAR_WIDTH` in `Sidebar.tsx`).
