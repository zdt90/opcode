use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, net::TcpListener, sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

#[derive(Clone)]
pub struct McpElicitationBridge {
    port: u16,
    token: String,
    pending: Arc<Mutex<HashMap<String, PendingElicitation>>>,
}

struct PendingElicitation {
    tab_id: String,
    sender: oneshot::Sender<ElicitationDecision>,
}

#[derive(Debug, Deserialize)]
struct ClaudeElicitationRequest {
    session_id: String,
    mcp_server_name: String,
    message: String,
    mode: Option<String>,
    url: Option<String>,
    elicitation_id: Option<String>,
    requested_schema: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
struct McpElicitationEvent {
    request_id: String,
    session_id: String,
    mcp_server_name: String,
    message: String,
    mode: Option<String>,
    url: Option<String>,
    elicitation_id: Option<String>,
    requested_schema: Option<Value>,
}

struct ElicitationDecision {
    action: String,
    content: Value,
}

#[derive(Clone)]
struct HookServerState {
    app: AppHandle,
    bridge: McpElicitationBridge,
}

impl McpElicitationBridge {
    pub fn bind() -> Result<(Self, TcpListener), String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|error| format!("Failed to bind MCP elicitation bridge: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("Failed to configure MCP elicitation bridge: {error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("Failed to read MCP elicitation bridge address: {error}"))?
            .port();

        Ok((
            Self {
                port,
                token: Uuid::new_v4().to_string(),
                pending: Arc::new(Mutex::new(HashMap::new())),
            },
            listener,
        ))
    }

    pub fn start(&self, app: AppHandle, listener: TcpListener) {
        let state = HookServerState {
            app,
            bridge: self.clone(),
        };

        tauri::async_runtime::spawn(async move {
            let listener = match tokio::net::TcpListener::from_std(listener) {
                Ok(listener) => listener,
                Err(error) => {
                    log::error!("Failed to start MCP elicitation bridge: {error}");
                    return;
                }
            };
            let router = Router::new()
                .route("/hooks/elicitation/{tab_id}", post(handle_elicitation))
                .with_state(state);

            if let Err(error) = axum::serve(listener, router).await {
                log::error!("MCP elicitation bridge stopped: {error}");
            }
        });
    }

    pub fn hook_settings(&self, tab_id: &str) -> String {
        json!({
            "hooks": {
                "Elicitation": [{
                    "matcher": "",
                    "hooks": [{
                        "type": "http",
                        "url": format!("http://127.0.0.1:{}/hooks/elicitation/{}", self.port, tab_id),
                        "timeout": 600,
                        "headers": {
                            "X-Opcode-Hook-Token": self.token
                        }
                    }]
                }]
            }
        })
        .to_string()
    }

    pub async fn cancel_tab(&self, tab_id: &str) {
        let mut pending = self.pending.lock().await;
        let request_ids: Vec<String> = pending
            .iter()
            .filter(|(_, request)| request.tab_id == tab_id)
            .map(|(request_id, _)| request_id.clone())
            .collect();

        for request_id in request_ids {
            if let Some(request) = pending.remove(&request_id) {
                let _ = request.sender.send(ElicitationDecision {
                    action: "cancel".to_string(),
                    content: json!({}),
                });
            }
        }
    }

    pub async fn cancel_all(&self) {
        let mut pending = self.pending.lock().await;
        for (_, request) in pending.drain() {
            let _ = request.sender.send(ElicitationDecision {
                action: "cancel".to_string(),
                content: json!({}),
            });
        }
    }
}

async fn handle_elicitation(
    State(state): State<HookServerState>,
    Path(tab_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<ClaudeElicitationRequest>,
) -> (StatusCode, Json<Value>) {
    let provided_token = headers
        .get("X-Opcode-Hook-Token")
        .and_then(|value| value.to_str().ok());
    if provided_token != Some(state.bridge.token.as_str()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid hook token" })),
        );
    }

    let request_id = Uuid::new_v4().to_string();
    let event = McpElicitationEvent {
        request_id: request_id.clone(),
        session_id: request.session_id,
        mcp_server_name: request.mcp_server_name,
        message: request.message,
        mode: request.mode,
        url: request.url,
        elicitation_id: request.elicitation_id,
        requested_schema: request.requested_schema,
    };
    let (sender, receiver) = oneshot::channel();

    state.bridge.pending.lock().await.insert(
        request_id.clone(),
        PendingElicitation {
            tab_id: tab_id.clone(),
            sender,
        },
    );

    if let Err(error) = state
        .app
        .emit(&format!("mcp-elicitation:{tab_id}"), event)
    {
        log::error!("Failed to emit MCP elicitation: {error}");
        state.bridge.pending.lock().await.remove(&request_id);
        return (StatusCode::OK, Json(elicitation_response("cancel", json!({}))));
    }

    let decision = match tokio::time::timeout(Duration::from_secs(590), receiver).await {
        Ok(Ok(decision)) => decision,
        _ => {
            state.bridge.pending.lock().await.remove(&request_id);
            ElicitationDecision {
                action: "cancel".to_string(),
                content: json!({}),
            }
        }
    };

    (
        StatusCode::OK,
        Json(elicitation_response(&decision.action, decision.content)),
    )
}

fn elicitation_response(action: &str, content: Value) -> Value {
    json!({
        "hookSpecificOutput": {
            "hookEventName": "Elicitation",
            "action": action,
            "content": content
        }
    })
}

#[tauri::command]
pub async fn respond_to_mcp_elicitation(
    state: tauri::State<'_, McpElicitationBridge>,
    request_id: String,
    action: String,
    content: Option<Value>,
) -> Result<(), String> {
    if !matches!(action.as_str(), "accept" | "decline" | "cancel") {
        return Err(format!("Unsupported elicitation action: {action}"));
    }

    let pending = state
        .pending
        .lock()
        .await
        .remove(&request_id)
        .ok_or_else(|| "This authorization request is no longer active".to_string())?;

    pending
        .sender
        .send(ElicitationDecision {
            action,
            content: content.unwrap_or_else(|| json!({})),
        })
        .map_err(|_| "Claude Code is no longer waiting for this authorization".to_string())
}
