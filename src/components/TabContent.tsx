import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTabState } from '@/hooks/useTabState';
import { useScreenTracking } from '@/hooks/useAnalytics';
import { Tab } from '@/contexts/TabContext';
import { Loader2, Plus, ArrowLeft } from 'lucide-react';
import { api, type Project, type Session, type ClaudeMdFile } from '@/lib/api';
import { apiCall } from '@/lib/apiAdapter';
import { ProjectList } from '@/components/ProjectList';
import { SessionList } from '@/components/SessionList';
import { Button } from '@/components/ui/button';

// Lazy load heavy components
const ClaudeCodeSession = lazy(() => import('@/components/ClaudeCodeSession').then(m => ({ default: m.ClaudeCodeSession })));
const AgentRunOutputViewer = lazy(() => import('@/components/AgentRunOutputViewer'));
const AgentExecution = lazy(() => import('@/components/AgentExecution').then(m => ({ default: m.AgentExecution })));
const CreateAgent = lazy(() => import('@/components/CreateAgent').then(m => ({ default: m.CreateAgent })));
const Agents = lazy(() => import('@/components/Agents').then(m => ({ default: m.Agents })));
const UsageDashboard = lazy(() => import('@/components/UsageDashboard').then(m => ({ default: m.UsageDashboard })));
const MCPManager = lazy(() => import('@/components/MCPManager').then(m => ({ default: m.MCPManager })));
const Settings = lazy(() => import('@/components/Settings').then(m => ({ default: m.Settings })));
const MarkdownEditor = lazy(() => import('@/components/MarkdownEditor').then(m => ({ default: m.MarkdownEditor })));
// const ClaudeFileEditor = lazy(() => import('@/components/ClaudeFileEditor').then(m => ({ default: m.ClaudeFileEditor })));

// Import non-lazy components for projects view

interface TabPanelProps {
  tab: Tab;
  isActive: boolean;
}

const TabPanel = React.memo(({ tab, isActive }: TabPanelProps) => {
  const { updateTab } = useTabState();
  // Guards binding a pending session name to its session id exactly once.
  const nameBoundRef = React.useRef(false);
  // Tracks streaming edge + whether this tab started as a brand-new session, so
  // we reveal it in the sidebar once its first turn completes.
  const prevStreamingRef = React.useRef(false);
  const sessionRevealedRef = React.useRef(false);
  const sessionPreRevealedRef = React.useRef(false);
  const preRevealTimerRef = React.useRef<number | null>(null);
  const isNewSessionRef = React.useRef(!tab.sessionId);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = React.useState<Project | null>(null);
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [loading, setLoading] = React.useState(false);
  
  // Track screen when tab becomes active
  useScreenTracking(isActive ? tab.type : undefined, isActive ? tab.id : undefined);
  const [error, setError] = React.useState<string | null>(null);
  
  // Load projects when tab becomes active and is of type 'projects'
  useEffect(() => {
    return () => {
      if (preRevealTimerRef.current !== null) {
        window.clearTimeout(preRevealTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isActive && tab.type === 'projects') {
      loadProjects();
    }
  }, [isActive, tab.type]);

  // Keep chat tab titles normalized to "{Project Name} - {Session Display Name}"
  // (or just the project name when there's no session name yet). This also fixes
  // titles restored from persistence on startup, which may be a bare project name.
  useEffect(() => {
    if (tab.type !== 'chat') return;
    // A freshly named session keeps its pending title until it's bound.
    if (tab.pendingName) return;
    const sessionId = tab.sessionId || tab.sessionData?.id;
    const projectPath = tab.initialProjectPath || tab.sessionData?.project_path || '';
    if (!sessionId || !projectPath) return;
    const projectName = projectPath.split('/').pop() || projectPath.split('\\').pop() || 'Session';
    // Already in the desired "{Project} - {Session}" shape; leave it alone.
    if (tab.title.startsWith(`${projectName} - `)) return;

    let cancelled = false;
    (async () => {
      let sessionName = '';
      try {
        const custom = await apiCall<string | null>('get_session_name', { sessionId });
        if (custom) sessionName = custom;
      } catch {
        // no custom name
      }
      if (!sessionName && tab.sessionData?.first_message) {
        sessionName = tab.sessionData.first_message.trim().slice(0, 40);
      }
      if (!sessionName) sessionName = sessionId.slice(0, 8);
      const desired = sessionName ? `${projectName} - ${sessionName}` : projectName;
      if (!cancelled && tab.title !== desired) {
        updateTab(tab.id, { title: desired });
      }
    })();
    return () => { cancelled = true; };
  }, [tab.id, tab.type, tab.sessionId, tab.sessionData, tab.pendingName, tab.initialProjectPath, tab.title]);
  
  const loadProjects = async () => {
    try {
      setLoading(true);
      setError(null);
      const projectList = await api.listProjects();
      setProjects(projectList);
    } catch (err) {
      console.error("Failed to load projects:", err);
      setError("Failed to load projects. Please ensure ~/.claude directory exists.");
    } finally {
      setLoading(false);
    }
  };
  
  const handleProjectClick = async (project: Project) => {
    try {
      setLoading(true);
      setError(null);
      const sessionList = await api.getProjectSessions(project.id);
      setSessions(sessionList);
      setSelectedProject(project);
      
      // Update tab title to show project name
      const projectName = project.path.split('/').pop() || 'Project';
      updateTab(tab.id, {
        title: projectName
      });
    } catch (err) {
      console.error("Failed to load sessions:", err);
      setError("Failed to load sessions for this project.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenProject = async () => {
    console.log('handleOpenProject called');
    try {
      // Use native dialog to pick folder
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Project Folder',
        defaultPath: await api.getHomeDirectory(),
      });
      
      console.log('Selected folder:', selected);
      
      if (selected && typeof selected === 'string') {
        // Create or open project for the selected directory
        const project = await api.createProject(selected);
        await loadProjects();
        await handleProjectClick(project);
      }
    } catch (err) {
      console.error('Failed to open folder picker:', err);
      setError('Failed to open folder picker');
    }
  };
  
  const handleNewSession = () => {
    // Update current tab to show new chat session instead of creating a new tab
    if (selectedProject) {
      const projectName = selectedProject.path.split('/').pop() || 'Session';
      updateTab(tab.id, {
        type: 'chat',
        title: projectName,
        sessionId: undefined,
        sessionData: undefined,
        initialProjectPath: selectedProject.path
      });
    } else {
      updateTab(tab.id, {
        type: 'chat',
        title: 'New Session',
        sessionId: undefined,
        sessionData: undefined,
        initialProjectPath: undefined
      });
    }
  };
  
  // Panel visibility - hide when not active
  const panelVisibilityClass = isActive ? "" : "hidden";
  
  const renderContent = () => {
    switch (tab.type) {
      case 'projects':
        return (
          <div className="h-full">
              {/* Content based on selection */}
              {selectedProject ? (
                <div className="h-full overflow-y-auto">
                  <div className="max-w-6xl mx-auto p-6">
                    <div className="mb-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <motion.div
                            whileTap={{ scale: 0.97 }}
                            transition={{ duration: 0.15 }}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedProject(null);
                                setSessions([]);
                                // Restore tab title to "Projects"
                                updateTab(tab.id, {
                                  title: 'Projects'
                                });
                              }}
                              className="h-8 w-8 -ml-2"
                              title="Back to Projects"
                            >
                              <ArrowLeft className="h-4 w-4" />
                            </Button>
                          </motion.div>
                          <div>
                            <h1 className="text-3xl font-bold tracking-tight">
                              {selectedProject.path.split('/').pop()}
                            </h1>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {`${sessions.length} session${sessions.length !== 1 ? 's' : ''}`}
                            </p>
                          </div>
                        </div>
                        <motion.div
                          whileTap={{ scale: 0.97 }}
                          transition={{ duration: 0.15 }}
                        >
                          <Button
                            onClick={handleNewSession}
                            size="default"
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            New session
                          </Button>
                        </motion.div>
                      </div>
                    </div>

                    {/* Error display */}
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15 }}
                        className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive"
                      >
                        {error}
                      </motion.div>
                    )}

                    {/* Loading state */}
                    {loading && (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    )}

                    {/* Session List */}
                    {!loading && (
                      <SessionList
                        sessions={sessions}
                        projectPath={selectedProject.path}
                        onSessionClick={(session) => {
                          // Update current tab to show the selected session
                          updateTab(tab.id, {
                            type: 'chat',
                            title: session.project_path.split('/').pop() || 'Session',
                            sessionId: session.id,
                            sessionData: session,
                            initialProjectPath: session.project_path
                          });
                        }}
                        onEditClaudeFile={(file: ClaudeMdFile) => {
                          // Open CLAUDE.md file in a new tab
                          window.dispatchEvent(new CustomEvent('open-claude-file', { 
                            detail: { file } 
                          }));
                        }}
                      />
                    )}
                  </div>
                </div>
              ) : (
                /* Projects List View */
                <ProjectList
                  projects={projects}
                  onProjectClick={handleProjectClick}
                  onOpenProject={handleOpenProject}
                  loading={loading}
                />
              )}
          </div>
        );
      
      case 'chat':
        return (
          <div className="h-full">
            <ClaudeCodeSession
              session={tab.sessionData} // Pass the full session object if available
              initialProjectPath={tab.initialProjectPath || tab.sessionId}
              isActive={isActive}
              onBack={() => {
                // Go back to projects view in the same tab
                updateTab(tab.id, {
                  type: 'projects',
                  title: 'Projects',
                });
              }}
              onProjectPathChange={(path: string) => {
                // The title is already meaningful for existing sessions ("Project -
                // Session") and for freshly named sessions; don't overwrite it with
                // the bare project directory name.
                if (tab.pendingName || tab.sessionId) return;
                const dirName = path.split('/').pop() || path.split('\\').pop() || 'Session';
                updateTab(tab.id, {
                  title: dirName
                });
              }}
              onStreamingChange={(isStreaming: boolean, sessionId: string | null) => {
                // Bind the pending user-chosen name as soon as the new session
                // gets its id.
                if (sessionId && tab.pendingName && !tab.sessionId && !nameBoundRef.current) {
                  nameBoundRef.current = true;
                  const name = tab.pendingName;
                  apiCall('rename_session', { sessionId, name }).catch((err) => {
                    console.error('[TabContent] Failed to bind session name:', err);
                  });
                  updateTab(tab.id, { sessionId, pendingName: undefined });
                }
                // When a brand-new session finishes its first turn, persist its id
                // and reveal it in the sidebar (its session file is on disk by now).
                const justFinished = prevStreamingRef.current && !isStreaming;
                prevStreamingRef.current = isStreaming;
                if (justFinished && sessionId && isNewSessionRef.current && !sessionRevealedRef.current) {
                  sessionRevealedRef.current = true;
                  if (!tab.sessionId) updateTab(tab.id, { sessionId });
                  window.dispatchEvent(new CustomEvent('opcode-refresh-sessions'));
                }

                // Pre-reveal: as soon as session ID is available (while still streaming),
                // show the session in the sidebar immediately using first_message as
                // display name — before the first turn completes.
                if (isStreaming && sessionId && isNewSessionRef.current && !sessionPreRevealedRef.current) {
                  sessionPreRevealedRef.current = true;
                  // Small delay so Claude CLI has flushed the JSONL to disk.
                  // Timer is stored on the ref so it can be cleared if the tab unmounts early.
                  preRevealTimerRef.current = window.setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('opcode-refresh-sessions'));
                  }, 800);
                }
              }}
            />
          </div>
        );
      
      case 'agent':
        if (!tab.agentRunId) {
          return (
            <div className="h-full">
              <div className="p-4">No agent run ID specified</div>
            </div>
          );
        }
        return (
          <div className="h-full">
            <AgentRunOutputViewer
              agentRunId={tab.agentRunId}
              tabId={tab.id}
            />
          </div>
        );
      
      case 'agents':
        return (
          <div className="h-full">
            <Agents />
          </div>
        );
      
      case 'usage':
        return (
          <div className="h-full">
            <UsageDashboard onBack={() => {}} />
          </div>
        );
      
      case 'mcp':
        return (
          <div className="h-full">
            <MCPManager onBack={() => {}} />
          </div>
        );
      
      case 'settings':
        return (
          <div className="h-full">
            <Settings onBack={() => {}} />
          </div>
        );
      
      case 'claude-md':
        return (
          <div className="h-full">
            <MarkdownEditor onBack={() => {}} />
          </div>
        );
      
      case 'claude-file':
        if (!tab.claudeFileId) {
          return <div className="p-4">No Claude file ID specified</div>;
        }
        // Note: We need to get the actual file object for ClaudeFileEditor
        // For now, returning a placeholder
        return <div className="p-4">Claude file editor not yet implemented in tabs</div>;
      
      case 'agent-execution':
        if (!tab.agentData) {
          return <div className="p-4">No agent data specified</div>;
        }
        return (
          <AgentExecution
            agent={tab.agentData}
            projectPath={tab.projectPath}
            tabId={tab.id}
            onBack={() => {}}
          />
        );
      
      case 'create-agent':
        return (
          <CreateAgent
            onAgentCreated={() => {
              // Close this tab after agent is created
              window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId: tab.id } }));
            }}
            onBack={() => {
              // Close this tab when back is clicked
              window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId: tab.id } }));
            }}
          />
        );
      
      case 'import-agent':
        // TODO: Implement import agent component
        return (
          <div className="h-full">
            <div className="p-4">Import agent functionality coming soon...</div>
          </div>
        );
      
      default:
        return (
          <div className="h-full">
            <div className="p-4">Unknown tab type: {tab.type}</div>
          </div>
        );
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.15 }}
        className={`h-full w-full ${panelVisibilityClass}`}
      >
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          }
        >
          {renderContent()}
        </Suspense>
      </motion.div>

    </>
  );
});

export const TabContent: React.FC = () => {
  const { tabs, activeTabId, createChatTab, createProjectsTab, findTabBySessionId, createClaudeFileTab, createAgentExecutionTab, createCreateAgentTab, createImportAgentTab, closeTab, updateTab } = useTabState();

  // Refs that always hold the latest values without causing the event-listener
  // useEffect below to re-run (and re-register all listeners) on every tab change.
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);
  
  // Listen for events to open sessions in tabs
  useEffect(() => {
    const handleOpenSessionInTab = (event: CustomEvent) => {
      const { session } = event.detail;
      
      // Check if tab already exists for this session
      const existingTab = findTabBySessionId(session.id);
      if (existingTab) {
        // Update existing tab with session data and switch to it
        updateTab(existingTab.id, {
          sessionData: session,
          title: session.project_path.split('/').pop() || 'Session'
        });
        window.dispatchEvent(new CustomEvent('switch-to-tab', { detail: { tabId: existingTab.id } }));
      } else {
        // Create new tab for this session
        const projectName = session.project_path.split('/').pop() || 'Session';
        const newTabId = createChatTab(session.id, projectName, session.project_path);
        // Update the new tab with session data
        updateTab(newTabId, {
          sessionData: session,
          initialProjectPath: session.project_path
        });
      }
    };

    const handleOpenClaudeFile = (event: CustomEvent) => {
      const { file } = event.detail;
      createClaudeFileTab(file.id, file.name || 'CLAUDE.md');
    };

    const handleOpenAgentExecution = (event: CustomEvent) => {
      const { agent, tabId, projectPath } = event.detail;
      createAgentExecutionTab(agent, tabId, projectPath);
    };

    const handleOpenCreateAgentTab = () => {
      createCreateAgentTab();
    };

    const handleOpenImportAgentTab = () => {
      createImportAgentTab();
    };

    const handleCloseTab = (event: CustomEvent) => {
      const { tabId } = event.detail;
      closeTab(tabId);
    };

    const makeTabTitle = (session: { project_path: string; first_message?: string; id: string }, displayName?: string) => {
      const projectName = session.project_path.split('/').pop() || 'Session';
      const sessionName = displayName
        || (session.first_message ? session.first_message.trim().slice(0, 20) : session.id.slice(0, 8));
      return `${projectName} - ${sessionName}`;
    };

    const handleClaudeSessionSelected = (event: CustomEvent) => {
      const { session, openInNewTab, displayName } = event.detail;
      const title = makeTabTitle(session, displayName);

      if (openInNewTab) {
        const existingTab = findTabBySessionId(session.id);
        if (existingTab) {
          updateTab(existingTab.id, { sessionData: session, title });
          window.dispatchEvent(new CustomEvent('switch-to-tab', { detail: { tabId: existingTab.id } }));
        } else {
          const newTabId = createChatTab(session.id, title, session.project_path);
          updateTab(newTabId, { sessionData: session, initialProjectPath: session.project_path });
        }
      } else {
        // Use refs to get the latest tabs/activeTabId — the closure captured by
        // this handler is stale if tabs changed after this useEffect last ran.
        const currentTab = tabsRef.current.find(t => t.id === activeTabIdRef.current);
        if (currentTab) {
          updateTab(currentTab.id, {
            type: 'chat',
            title,
            sessionId: session.id,
            sessionData: session,
            initialProjectPath: session.project_path,
          });
        } else {
          const newTabId = createChatTab(session.id, title, session.project_path);
          updateTab(newTabId, { sessionData: session, initialProjectPath: session.project_path });
        }
      }
    };

    const handleNewSessionForProject = (event: CustomEvent) => {
      const { projectPath, name } = event.detail as { projectPath: string; name?: string };
      const trimmedName = (name || '').trim();
      const projectName = projectPath.split('/').pop() || 'New Session';
      const title = trimmedName ? `${projectName} - ${trimmedName}` : projectName;
      const newTabId = createChatTab(undefined, title, projectPath);
      updateTab(newTabId, {
        initialProjectPath: projectPath,
        pendingName: trimmedName || undefined,
      });
    };

    window.addEventListener('open-session-in-tab', handleOpenSessionInTab as EventListener);
    window.addEventListener('open-claude-file', handleOpenClaudeFile as EventListener);
    window.addEventListener('open-agent-execution', handleOpenAgentExecution as EventListener);
    window.addEventListener('open-create-agent-tab', handleOpenCreateAgentTab);
    window.addEventListener('open-import-agent-tab', handleOpenImportAgentTab);
    window.addEventListener('close-tab', handleCloseTab as EventListener);
    window.addEventListener('claude-session-selected', handleClaudeSessionSelected as EventListener);
    window.addEventListener('new-session-for-project', handleNewSessionForProject as EventListener);
    return () => {
      window.removeEventListener('open-session-in-tab', handleOpenSessionInTab as EventListener);
      window.removeEventListener('open-claude-file', handleOpenClaudeFile as EventListener);
      window.removeEventListener('open-agent-execution', handleOpenAgentExecution as EventListener);
      window.removeEventListener('open-create-agent-tab', handleOpenCreateAgentTab);
      window.removeEventListener('open-import-agent-tab', handleOpenImportAgentTab);
      window.removeEventListener('close-tab', handleCloseTab as EventListener);
      window.removeEventListener('claude-session-selected', handleClaudeSessionSelected as EventListener);
      window.removeEventListener('new-session-for-project', handleNewSessionForProject as EventListener);
    };
  }, [createChatTab, findTabBySessionId, createClaudeFileTab, createAgentExecutionTab, createCreateAgentTab, createImportAgentTab, closeTab, updateTab]);
  
  return (
    <div className="flex-1 h-full relative">
      <AnimatePresence>
        {tabs.map((tab) => (
          <TabPanel
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
          />
        ))}
      </AnimatePresence>
      
      {tabs.length === 0 && (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <div className="text-center">
            <p className="text-lg mb-2">No projects open</p>
            <p className="text-sm mb-4">Click to start a new project</p>
            <Button
              onClick={() => createProjectsTab()}
              size="default"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TabContent;
