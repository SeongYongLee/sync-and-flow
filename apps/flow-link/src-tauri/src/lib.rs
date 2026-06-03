mod native_bridge;
mod worker_publish;

use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

use native_bridge::{
    is_claude_session_path, is_codex_path, is_pi_path, parse_claude_turn, parse_pi_turn,
    CodexParseState, Turn,
};
use worker_publish::{publish_to_worker, resolve_worker_url, worker_watch_url};

const FLOW_LINK_BUILD_ID: &str = "pi-roots-2026-05-18T23:35KST";
const FLOW_LINK_APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const FLOW_LINK_SCAN_ROOTS: [&str; 3] = [
    "~/.claude/projects",
    "~/.codex/sessions",
    "~/.pi/agent/sessions",
];
const SOURCE_POLL_INTERVAL_MS: u64 = 180;

struct BridgeState {
    process: Mutex<BridgeProcess>,
}

enum BridgeProcess {
    Stopped,
    Native(NativeBridge),
}

struct NativeBridge {
    port: u16,
    token: String,
    worker_url: String,
    shutdown: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

#[derive(Clone)]
struct BridgeConfig {
    port: u16,
    token: String,
    worker_url: String,
}

impl Default for BridgeState {
    fn default() -> Self {
        Self {
            process: Mutex::new(BridgeProcess::Stopped),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(BridgeState::default());
            let bridge = start_bridge(app.handle());
            create_main_window(app.handle(), bridge.as_ref())?;
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running Flow Link");
}

fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Flow Link", true, None::<&str>)?;
    let diagnostics = MenuItem::with_id(app, "diagnostics", "Diagnostics", true, None::<&str>)?;
    let start = MenuItem::with_id(app, "start", "Start Sharing", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause Sharing", true, None::<&str>)?;
    let privacy = MenuItem::with_id(
        app,
        "privacy",
        "Privacy: What is shared?",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit Flow Link", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &diagnostics, &start, &pause, &privacy, &quit])?;

    TrayIconBuilder::with_id("flow-link")
        .icon(flow_link_tray_icon())
        .icon_as_template(true)
        .tooltip("Flow Link")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "diagnostics" => show_diagnostics(app),
            "start" => {
                if let Some(bridge) = start_bridge(app) {
                    reload_main_window(app, Some(&bridge));
                }
            }
            "pause" => {
                stop_owned_bridge(app);
                reload_main_window(app, None);
            }
            "privacy" => {
                let _ = tauri_plugin_opener::open_url(
                    "https://sync-and-flow.local/privacy",
                    None::<&str>,
                );
            }
            "quit" => {
                stop_owned_bridge(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn start_bridge<R: Runtime>(app: &AppHandle<R>) -> Option<BridgeConfig> {
    let state = app.state::<BridgeState>();
    let mut process = match state.process.lock() {
        Ok(process) => process,
        Err(_) => return None,
    };

    if let BridgeProcess::Native(bridge) = &*process {
        return Some(BridgeConfig {
            port: bridge.port,
            token: bridge.token.clone(),
            worker_url: bridge.worker_url.clone(),
        });
    }

    if let Some(bridge) = spawn_native_bridge() {
        let config = BridgeConfig {
            port: bridge.port,
            token: bridge.token.clone(),
            worker_url: bridge.worker_url.clone(),
        };
        *process = BridgeProcess::Native(bridge);
        Some(config)
    } else {
        *process = BridgeProcess::Stopped;
        None
    }
}

fn stop_owned_bridge<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<BridgeState>();
    let mut process = match state.process.lock() {
        Ok(process) => process,
        Err(_) => return,
    };

    if let BridgeProcess::Native(bridge) = &mut *process {
        bridge.shutdown.store(true, Ordering::Relaxed);
        let _ = TcpStream::connect(("127.0.0.1", bridge.port));
        if let Some(handle) = bridge.handle.take() {
            let _ = handle.join();
        }
    }

    *process = BridgeProcess::Stopped;
}

fn spawn_native_bridge() -> Option<NativeBridge> {
    let listener = TcpListener::bind("127.0.0.1:3001")
        .or_else(|_| TcpListener::bind("127.0.0.1:0"))
        .ok()?;
    let port = listener.local_addr().ok()?.port();
    let token = generate_bridge_token();
    let worker_url = resolve_worker_url();
    let shutdown = Arc::new(AtomicBool::new(false));
    let bridge_shutdown = Arc::clone(&shutdown);
    let bridge_token = token.clone();
    let bridge_worker_url = worker_url.clone();
    let handle = thread::Builder::new()
        .name("flow-link-bridge".into())
        .spawn(move || {
            run_native_bridge(listener, bridge_shutdown, bridge_token, bridge_worker_url)
        })
        .ok()?;

    Some(NativeBridge {
        port,
        token,
        worker_url,
        shutdown,
        handle: Some(handle),
    })
}

fn create_main_window<R: Runtime>(
    app: &AppHandle<R>,
    bridge: Option<&BridgeConfig>,
) -> tauri::Result<()> {
    let mut config = app.config().app.windows[0].clone();
    config.url = bridge_window_url(bridge);
    WebviewWindowBuilder::from_config(app, &config)?.build()?;
    Ok(())
}

fn bridge_window_url(bridge: Option<&BridgeConfig>) -> WebviewUrl {
    #[cfg(debug_assertions)]
    {
        WebviewUrl::External(bridge_page_href(bridge).parse().expect("valid dev url"))
    }

    #[cfg(not(debug_assertions))]
    {
        WebviewUrl::App(bridge_page_href(bridge).into())
    }
}

fn bridge_page_href(bridge: Option<&BridgeConfig>) -> String {
    let query = bridge
        .map(|bridge| {
            let mut query = format!("bridgePort={}&bridgeToken={}", bridge.port, bridge.token);
            if !bridge.worker_url.is_empty() {
                query.push_str("&worker=");
                query.push_str(&query_escape(&worker_watch_url(&bridge.worker_url)));
            }
            query
        })
        .unwrap_or_else(|| "bridgePaused=1".to_string());

    #[cfg(debug_assertions)]
    {
        format!("http://127.0.0.1:5175/?{query}")
    }

    #[cfg(not(debug_assertions))]
    {
        format!("index.html?{query}")
    }
}

fn query_escape(value: &str) -> String {
    value
        .replace('%', "%25")
        .replace(' ', "%20")
        .replace('#', "%23")
        .replace('&', "%26")
        .replace('?', "%3F")
        .replace('=', "%3D")
}

fn flow_link_tray_icon() -> Image<'static> {
    const SIZE: u32 = 32;
    let mut rgba = vec![0; (SIZE * SIZE * 4) as usize];
    let center = (SIZE as f32 - 1.0) / 2.0;

    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let tilt = -0.52_f32;
            let rotated_x = dx * tilt.cos() - dy * tilt.sin();
            let rotated_y = dx * tilt.sin() + dy * tilt.cos();
            let orbit = (rotated_x / 12.6).powi(2) + (rotated_y / 5.2).powi(2);
            let is_orbit = (0.78..=1.18).contains(&orbit);
            let is_core = dx.powi(2) + dy.powi(2) <= 24.0;
            let is_core_cut = (dx + 2.4).powi(2) + (dy + 1.8).powi(2) <= 9.0;
            let is_satellite = (dx - 10.0).powi(2) + (dy + 5.0).powi(2) <= 4.2;

            if is_orbit || (is_core && !is_core_cut) || is_satellite {
                let index = ((y * SIZE + x) * 4) as usize;
                rgba[index] = 0;
                rgba[index + 1] = 0;
                rgba[index + 2] = 0;
                rgba[index + 3] = 255;
            }
        }
    }

    Image::new_owned(rgba, SIZE, SIZE)
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn reload_main_window<R: Runtime>(app: &AppHandle<R>, bridge: Option<&BridgeConfig>) {
    if let Some(window) = app.get_webview_window("main") {
        let href = bridge_page_href(bridge);
        let js_href = serde_json::to_string(&href).unwrap_or_else(|_| "\"/\"".to_string());
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.eval(format!("location.replace({js_href});"));
    }
}

fn show_diagnostics<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.eval("location.hash = 'diagnostics'; window.dispatchEvent(new HashChangeEvent('hashchange'));");
    }
}

#[derive(Clone)]
struct Identity {
    user_id: String,
    nickname: String,
    color: String,
}

#[derive(Default, Clone)]
struct Totals {
    output_tokens: u64,
    input_tokens: u64,
    cache_read_tokens: u64,
    turns: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityPayload<'a> {
    user_id: &'a str,
    nickname: &'a str,
    color: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WireTotals {
    output_tokens: u64,
    input_tokens: u64,
    cache_read_tokens: u64,
    turns: u64,
    total_usd: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TurnDelta {
    output_tokens: u64,
    input_tokens: u64,
    cache_read_tokens: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotPayload {
    #[serde(rename = "type")]
    event_type: &'static str,
    model: String,
    source: String,
    totals: WireTotals,
    energy: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TurnPayload<'a> {
    #[serde(rename = "type")]
    event_type: &'static str,
    source: &'static str,
    provider: &'static str,
    model: &'a str,
    delta: TurnDelta,
    totals: WireTotals,
    source_totals: WireTotals,
    energy: f64,
    timestamp: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerPublishPayload<'a> {
    kind: &'static str,
    user_id: &'a str,
    nickname: &'a str,
    color: &'a str,
    source: &'static str,
    provider: &'static str,
    model: &'a str,
    delta: TurnDelta,
    totals: WireTotals,
    energy: f64,
    timestamp: &'a str,
}

struct NativeBridgeState {
    identity: Identity,
    token: String,
    worker_url: String,
    totals: Totals,
    clients: Vec<TcpStream>,
    active_sources: HashSet<&'static str>,
    watched_files: usize,
    watched_bytes: u64,
    latest_file: String,
    latest_file_size: u64,
    latest_file_modified_at: String,
    last_scan_at: String,
    last_event_at: String,
    last_source: String,
    last_model: String,
    last_file: String,
    last_read_at: String,
    last_read_file: String,
    read_lines: u64,
    parse_misses: u64,
    last_error: String,
    last_worker_publish_at: String,
    last_worker_error: String,
}

fn run_native_bridge(
    listener: TcpListener,
    shutdown: Arc<AtomicBool>,
    token: String,
    worker_url: String,
) {
    let _ = listener.set_nonblocking(true);

    let state = Arc::new(Mutex::new(NativeBridgeState {
        identity: get_or_create_identity(),
        token,
        worker_url,
        totals: Totals::default(),
        clients: Vec::new(),
        active_sources: HashSet::new(),
        watched_files: 0,
        watched_bytes: 0,
        latest_file: String::new(),
        latest_file_size: 0,
        latest_file_modified_at: String::new(),
        last_scan_at: String::new(),
        last_event_at: String::new(),
        last_source: String::new(),
        last_model: String::new(),
        last_file: String::new(),
        last_read_at: String::new(),
        last_read_file: String::new(),
        read_lines: 0,
        parse_misses: 0,
        last_error: String::new(),
        last_worker_publish_at: String::new(),
        last_worker_error: String::new(),
    }));

    let poll_state = Arc::clone(&state);
    let poll_shutdown = Arc::clone(&shutdown);
    let poller = thread::spawn(move || poll_sources(poll_shutdown, poll_state));

    while !shutdown.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => handle_http(stream, Arc::clone(&state)),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(60));
            }
            Err(_) => thread::sleep(Duration::from_millis(120)),
        }
    }

    let _ = poller.join();
}

fn handle_http(mut stream: TcpStream, state: Arc<Mutex<NativeBridgeState>>) {
    let Some(request) = read_http_request(&mut stream) else {
        return;
    };

    if request
        .origin
        .as_deref()
        .is_some_and(|origin| !is_allowed_origin(origin))
    {
        write_empty(&mut stream, "403 Forbidden", None);
        return;
    }

    if request.method == "OPTIONS" {
        write_empty(&mut stream, "204 No Content", request.origin.as_deref());
        return;
    }

    let target = request.path.as_str();
    let (path, query) = split_target(target);
    if !is_public_bridge_path(path) && !is_authorized(query, &state) {
        write_empty(&mut stream, "401 Unauthorized", request.origin.as_deref());
        return;
    }

    match path {
        "/identity" => {
            let identity = state.lock().ok().map(|state| state.identity.clone());
            if let Some(identity) = identity {
                write_json(
                    &mut stream,
                    &identity_json(&identity),
                    request.origin.as_deref(),
                );
            }
        }
        "/health" => {
            let recent_jsonl_files = discover_recent_jsonl_candidates();
            let source_roots = source_roots_status_json(home_dir().as_ref());
            if let Ok(state) = state.lock() {
                let sources = state
                    .active_sources
                    .iter()
                    .map(|source| format!("\"{source}\""))
                    .collect::<Vec<_>>()
                    .join(",");
                let recent_jsonl_files = json_string_array(&recent_jsonl_files);
                let scan_roots = json_string_array(
                    &FLOW_LINK_SCAN_ROOTS
                        .iter()
                        .map(|root| root.to_string())
                        .collect::<Vec<_>>(),
                );
                write_json(
                    &mut stream,
                    &format!(
                        "{{\"ok\":true,\"runtime\":\"tauri-native\",\"appVersion\":\"{}\",\"buildId\":\"{}\",\"scanRoots\":{},\"sourceRoots\":{},\"sources\":[{}],\"clients\":{},\"watchedFiles\":{},\"watchedBytes\":{},\"latestFile\":\"{}\",\"latestFileSize\":{},\"latestFileModifiedAt\":\"{}\",\"recentJsonlFiles\":{},\"lastScanAt\":\"{}\",\"lastEventAt\":\"{}\",\"lastSource\":\"{}\",\"lastModel\":\"{}\",\"lastFile\":\"{}\",\"lastReadAt\":\"{}\",\"lastReadFile\":\"{}\",\"readLines\":{},\"parseMisses\":{},\"lastError\":\"{}\",\"workerUrl\":\"{}\",\"lastWorkerPublishAt\":\"{}\",\"lastWorkerError\":\"{}\"}}",
                        FLOW_LINK_APP_VERSION,
                        FLOW_LINK_BUILD_ID,
                        scan_roots,
                        source_roots,
                        sources,
                        state.clients.len(),
                        state.watched_files,
                        state.watched_bytes,
                        escape_json(&state.latest_file),
                        state.latest_file_size,
                        escape_json(&state.latest_file_modified_at),
                        recent_jsonl_files,
                        escape_json(&state.last_scan_at),
                        escape_json(&state.last_event_at),
                        escape_json(&state.last_source),
                        escape_json(&state.last_model),
                        escape_json(&state.last_file),
                        escape_json(&state.last_read_at),
                        escape_json(&state.last_read_file),
                        state.read_lines,
                        state.parse_misses,
                        escape_json(&state.last_error),
                        escape_json(&state.worker_url),
                        escape_json(&state.last_worker_publish_at),
                        escape_json(&state.last_worker_error)
                    ),
                    request.origin.as_deref(),
                );
            }
        }
        "/events" => {
            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n{}\r\n: connected\n\n",
                cors_headers(request.origin.as_deref())
            );
            if stream.write_all(headers.as_bytes()).is_err() {
                return;
            }
            if let Ok(mut state) = state.lock() {
                if state.totals.turns > 0 {
                    let snapshot = snapshot_json(&state.totals);
                    let _ = stream.write_all(format!("data: {snapshot}\n\n").as_bytes());
                }
                if let Ok(client) = stream.try_clone() {
                    state.clients.push(client);
                }
            }
        }
        _ => {
            write_empty(&mut stream, "404 Not Found", request.origin.as_deref());
        }
    }
}

struct HttpRequest {
    method: String,
    path: String,
    origin: Option<String>,
}

fn read_http_request(stream: &mut TcpStream) -> Option<HttpRequest> {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(700)));
    let mut first_line = String::new();
    let mut origin = None;
    {
        let mut reader = BufReader::new(&mut *stream);
        reader.read_line(&mut first_line).ok()?;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).ok()? == 0 {
                break;
            }
            let trimmed = line.trim_end();
            if trimmed.is_empty() {
                break;
            }
            if let Some(value) = trimmed
                .strip_prefix("Origin:")
                .or_else(|| trimmed.strip_prefix("origin:"))
            {
                origin = Some(value.trim().to_string());
            }
        }
    }
    let _ = stream.set_read_timeout(None);

    let mut parts = first_line.split_whitespace();
    Some(HttpRequest {
        method: parts.next()?.to_string(),
        path: parts.next().unwrap_or("/").to_string(),
        origin,
    })
}

fn write_json(stream: &mut TcpStream, body: &str, origin: Option<&str>) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{}Content-Length: {}\r\n\r\n{}",
        cors_headers(origin),
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn write_empty(stream: &mut TcpStream, status: &str, origin: Option<&str>) {
    let response = format!(
        "HTTP/1.1 {status}\r\n{}Content-Length: 0\r\n\r\n",
        cors_headers(origin)
    );
    let _ = stream.write_all(response.as_bytes());
}

fn cors_headers(origin: Option<&str>) -> String {
    let Some(origin) = origin.filter(|origin| is_allowed_origin(origin)) else {
        return String::new();
    };

    format!(
        "Access-Control-Allow-Origin: {origin}\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nVary: Origin\r\n"
    )
}

fn is_allowed_origin(origin: &str) -> bool {
    if matches!(
        origin,
        "http://127.0.0.1:5175"
            | "http://localhost:5175"
            | "http://tauri.localhost"
            | "https://tauri.localhost"
            | "tauri://localhost"
    ) {
        return true;
    }

    origin
        .strip_prefix("http://")
        .and_then(|host| host.strip_suffix(":5175"))
        .is_some_and(is_private_lan_host)
}

fn is_private_lan_host(host: &str) -> bool {
    if host == "localhost" || host == "127.0.0.1" {
        return true;
    }

    if let Some(rest) = host.strip_prefix("192.168.") {
        return rest.split('.').count() == 2;
    }

    if let Some(rest) = host.strip_prefix("10.") {
        return rest.split('.').count() == 3;
    }

    if let Some(rest) = host.strip_prefix("172.") {
        let mut parts = rest.split('.');
        let Some(second) = parts.next().and_then(|value| value.parse::<u8>().ok()) else {
            return false;
        };
        return (16..=31).contains(&second) && parts.count() == 2;
    }

    false
}

fn split_target(target: &str) -> (&str, &str) {
    target.split_once('?').unwrap_or((target, ""))
}

fn is_public_bridge_path(path: &str) -> bool {
    matches!(path, "/identity" | "/events")
}

fn is_authorized(query: &str, state: &Arc<Mutex<NativeBridgeState>>) -> bool {
    let requested = query.split('&').find_map(|part| {
        let (key, value) = part.split_once('=')?;
        (key == "token").then_some(value)
    });

    let Ok(state) = state.lock() else {
        return false;
    };

    requested.is_some_and(|token| token == state.token)
}

fn poll_sources(shutdown: Arc<AtomicBool>, state: Arc<Mutex<NativeBridgeState>>) {
    let mut offsets = HashMap::<PathBuf, u64>::new();
    let mut codex_state = CodexParseState::default();
    let mut initialized_existing_files = false;

    while !shutdown.load(Ordering::Relaxed) {
        let files = discover_jsonl_files();
        let scan = summarize_files(&files);
        update_scan_status(&state, scan, "");

        for path in files {
            let current_size = fs::metadata(&path)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            let offset = offsets
                .entry(path.clone())
                .or_insert(if initialized_existing_files {
                    0
                } else {
                    current_size
                });
            if current_size < *offset {
                *offset = 0;
            }
            if current_size <= *offset {
                continue;
            }

            let lines = read_new_lines(&path, *offset);
            *offset = current_size;
            record_read_lines(&state, &path, lines.len() as u64);

            for line in lines {
                let turn = parse_turn_for_path(&mut codex_state, &line, &path);

                if let Some(turn) = turn {
                    publish_turn(&state, turn, &path);
                } else {
                    record_parse_miss(&state);
                }
            }
        }

        initialized_existing_files = true;
        thread::sleep(Duration::from_millis(SOURCE_POLL_INTERVAL_MS));
    }
}

fn parse_turn_for_path(
    codex_state: &mut CodexParseState,
    line: &str,
    path: &PathBuf,
) -> Option<Turn> {
    if is_codex_path(path) {
        return codex_state
            .parse_turn(line, path)
            .or_else(|| parse_claude_turn(line));
    }

    if is_pi_log_path(path) {
        return parse_pi_turn(line)
            .or_else(|| parse_claude_turn(line))
            .or_else(|| codex_state.parse_turn(line, path));
    }

    parse_claude_turn(line).or_else(|| codex_state.parse_turn(line, path))
}

fn record_read_lines(state: &Arc<Mutex<NativeBridgeState>>, path: &PathBuf, line_count: u64) {
    let Ok(mut state) = state.lock() else {
        return;
    };
    state.last_read_at = now_millis_string();
    state.last_read_file = path.to_string_lossy().to_string();
    state.read_lines = state.read_lines.saturating_add(line_count);
}

fn record_parse_miss(state: &Arc<Mutex<NativeBridgeState>>) {
    let Ok(mut state) = state.lock() else {
        return;
    };
    state.parse_misses = state.parse_misses.saturating_add(1);
}

struct ScanSummary {
    watched_files: usize,
    watched_bytes: u64,
    latest_file: String,
    latest_file_size: u64,
    latest_file_modified_at: String,
}

fn summarize_files(files: &[PathBuf]) -> ScanSummary {
    let mut watched_bytes = 0;
    let mut latest_file = String::new();
    let mut latest_file_size = 0;
    let mut latest_file_modified_at = String::new();
    let mut latest_modified = 0_u128;

    for path in files {
        let Ok(metadata) = fs::metadata(path) else {
            continue;
        };
        let size = metadata.len();
        watched_bytes += size;
        let modified = metadata_modified_millis(&metadata);
        if modified >= latest_modified {
            latest_modified = modified;
            latest_file = path.to_string_lossy().to_string();
            latest_file_size = size;
            latest_file_modified_at = modified.to_string();
        }
    }

    ScanSummary {
        watched_files: files.len(),
        watched_bytes,
        latest_file,
        latest_file_size,
        latest_file_modified_at,
    }
}

fn update_scan_status(state: &Arc<Mutex<NativeBridgeState>>, scan: ScanSummary, error: &str) {
    let Ok(mut state) = state.lock() else {
        return;
    };
    state.watched_files = scan.watched_files;
    state.watched_bytes = scan.watched_bytes;
    state.latest_file = scan.latest_file;
    state.latest_file_size = scan.latest_file_size;
    state.latest_file_modified_at = scan.latest_file_modified_at;
    state.last_scan_at = now_millis_string();
    state.last_error = error.to_string();
}

fn discover_jsonl_files() -> Vec<PathBuf> {
    let cwd = std::env::current_dir().ok();
    let home = home_dir();
    discover_jsonl_files_from(cwd.as_ref(), home.as_ref())
}

fn discover_jsonl_files_from(cwd: Option<&PathBuf>, home: Option<&PathBuf>) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut seen = HashSet::new();

    if let Some(cwd) = cwd {
        if let Ok(entries) = fs::read_dir(cwd) {
            for entry in entries.flatten() {
                let path = entry.path();
                if is_claude_session_path(&path) {
                    push_unique_file(path, &mut seen, &mut files);
                }
            }
        }
    }

    if let Some(home) = home {
        collect_claude_files(
            &home.join(".claude").join("projects"),
            0,
            &mut seen,
            &mut files,
        );
        collect_codex_files(
            &home.join(".codex").join("sessions"),
            0,
            &mut seen,
            &mut files,
        );
        collect_pi_files(&pi_sessions_dir(home), 0, &mut seen, &mut files);
        collect_recent_jsonl_files(
            &home.join(".claude").join("projects"),
            0,
            &mut seen,
            &mut files,
            Duration::from_secs(24 * 60 * 60).as_millis(),
        );
        collect_recent_jsonl_files(
            &home.join(".codex").join("sessions"),
            0,
            &mut seen,
            &mut files,
            Duration::from_secs(24 * 60 * 60).as_millis(),
        );
        collect_recent_jsonl_files(
            &pi_sessions_dir(home),
            0,
            &mut seen,
            &mut files,
            Duration::from_secs(24 * 60 * 60).as_millis(),
        );
    }

    files
}

struct SourceRootStatus {
    root_exists: bool,
    log_dir_exists: bool,
    supported_files: usize,
    recent_files: usize,
}

fn source_roots_status_json(home: Option<&PathBuf>) -> String {
    let Some(home) = home else {
        return "{\"home\":\"missing\"}".to_string();
    };

    let claude = source_root_status(
        &home.join(".claude"),
        &home.join(".claude").join("projects"),
        SourceKind::Claude,
    );
    let codex = source_root_status(
        &home.join(".codex"),
        &home.join(".codex").join("sessions"),
        SourceKind::Codex,
    );
    let pi_log_dir = pi_sessions_dir(home);
    let pi_root = pi_root_dir(home, &pi_log_dir);
    let pi = source_root_status(&pi_root, &pi_log_dir, SourceKind::Pi);

    format!(
        "{{\"claude\":{},\"codex\":{},\"pi\":{}}}",
        source_root_status_item_json(&claude),
        source_root_status_item_json(&codex),
        source_root_status_item_json(&pi)
    )
}

enum SourceKind {
    Claude,
    Codex,
    Pi,
}

fn source_root_status(root: &PathBuf, log_dir: &PathBuf, kind: SourceKind) -> SourceRootStatus {
    let mut supported = Vec::new();
    let mut recent = Vec::new();
    let mut seen = HashSet::new();

    match kind {
        SourceKind::Claude => collect_claude_files(log_dir, 0, &mut seen, &mut supported),
        SourceKind::Codex => collect_codex_files(log_dir, 0, &mut seen, &mut supported),
        SourceKind::Pi => collect_pi_files(log_dir, 0, &mut seen, &mut supported),
    }

    let mut recent_seen = HashSet::new();
    collect_recent_jsonl_files(
        log_dir,
        0,
        &mut recent_seen,
        &mut recent,
        Duration::from_secs(24 * 60 * 60).as_millis(),
    );

    SourceRootStatus {
        root_exists: root.is_dir(),
        log_dir_exists: log_dir.is_dir(),
        supported_files: supported.len(),
        recent_files: recent.len(),
    }
}

fn source_root_status_item_json(status: &SourceRootStatus) -> String {
    format!(
        "{{\"root\":\"{}\",\"logDir\":\"{}\",\"supportedFiles\":{},\"recentFiles\":{}}}",
        if status.root_exists {
            "exists"
        } else {
            "missing"
        },
        if status.log_dir_exists {
            "exists"
        } else {
            "missing"
        },
        status.supported_files,
        status.recent_files
    )
}

fn collect_claude_files(
    dir: &PathBuf,
    depth: usize,
    seen: &mut HashSet<PathBuf>,
    files: &mut Vec<PathBuf>,
) {
    if depth > 5 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_claude_files(&path, depth + 1, seen, files);
        } else if is_claude_session_path(&path) {
            push_unique_file(path, seen, files);
        }
    }
}

fn collect_codex_files(
    dir: &PathBuf,
    depth: usize,
    seen: &mut HashSet<PathBuf>,
    files: &mut Vec<PathBuf>,
) {
    if depth > 5 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_codex_files(&path, depth + 1, seen, files);
        } else if is_codex_path(&path) {
            push_unique_file(path, seen, files);
        }
    }
}

fn collect_pi_files(
    dir: &PathBuf,
    depth: usize,
    seen: &mut HashSet<PathBuf>,
    files: &mut Vec<PathBuf>,
) {
    if depth > 7 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_pi_files(&path, depth + 1, seen, files);
        } else if is_pi_session_jsonl(&path, dir) {
            push_unique_file(path, seen, files);
        }
    }
}

fn collect_recent_jsonl_files(
    dir: &PathBuf,
    depth: usize,
    seen: &mut HashSet<PathBuf>,
    files: &mut Vec<PathBuf>,
    max_age_millis: u128,
) {
    if depth > 7 || files.len() > 5000 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let now = chrono_like_timestamp();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_recent_jsonl_files(&path, depth + 1, seen, files, max_age_millis);
            continue;
        }
        if !is_jsonl_file(&path) {
            continue;
        }
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        let modified = metadata_modified_millis(&metadata);
        if modified == 0 || now.saturating_sub(modified) > max_age_millis {
            continue;
        }
        push_unique_file(path, seen, files);
    }
}

fn push_unique_file(path: PathBuf, seen: &mut HashSet<PathBuf>, files: &mut Vec<PathBuf>) {
    if seen.insert(path.clone()) {
        files.push(path);
    }
}

fn is_jsonl_file(path: &PathBuf) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension == "jsonl")
}

fn pi_agent_dir(home: &PathBuf) -> PathBuf {
    std::env::var_os("PI_CODING_AGENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".pi").join("agent"))
}

fn pi_sessions_dir(home: &PathBuf) -> PathBuf {
    std::env::var_os("PI_CODING_AGENT_SESSION_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| pi_agent_dir(home).join("sessions"))
}

fn pi_root_dir(home: &PathBuf, session_dir: &PathBuf) -> PathBuf {
    if std::env::var_os("PI_CODING_AGENT_SESSION_DIR").is_some() {
        session_dir.clone()
    } else {
        pi_agent_dir(home)
    }
}

fn is_pi_log_path(path: &Path) -> bool {
    if is_pi_path(path) {
        return true;
    }

    let Some(home) = home_dir() else {
        return false;
    };
    is_pi_session_jsonl(path, &pi_sessions_dir(&home))
}

fn is_pi_session_jsonl(path: &Path, session_dir: &Path) -> bool {
    path.starts_with(session_dir)
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension == "jsonl")
}

fn read_new_lines(path: &PathBuf, offset: u64) -> Vec<String> {
    let Ok(mut file) = File::open(path) else {
        return Vec::new();
    };
    if file.seek(SeekFrom::Start(offset)).is_err() {
        return Vec::new();
    }
    let mut content = String::new();
    if file.read_to_string(&mut content).is_err() {
        return Vec::new();
    }
    content.lines().map(str::to_string).collect()
}

struct RecentJsonlCandidate {
    modified: u128,
    size: u64,
    path: PathBuf,
}

fn discover_recent_jsonl_candidates() -> Vec<String> {
    let Some(home) = home_dir() else {
        return Vec::new();
    };

    let roots = [
        home.join(".claude").join("projects"),
        home.join(".codex").join("sessions"),
        pi_sessions_dir(&home),
    ];
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    for root in roots {
        collect_recent_jsonl_candidates(&root, 0, &mut seen, &mut candidates);
    }

    candidates.sort_by(|left, right| {
        right
            .modified
            .cmp(&left.modified)
            .then_with(|| right.size.cmp(&left.size))
    });
    candidates
        .into_iter()
        .take(8)
        .map(|candidate| {
            let pi_session_root = pi_sessions_dir(&home);
            let supported = is_claude_session_path(&candidate.path)
                || is_codex_path(&candidate.path)
                || is_pi_session_jsonl(&candidate.path, &pi_session_root);
            format!(
                "{} | {} bytes | {} | {}",
                candidate.modified,
                candidate.size,
                if supported {
                    "supported"
                } else {
                    "unsupported"
                },
                candidate.path.to_string_lossy()
            )
        })
        .collect()
}

fn collect_recent_jsonl_candidates(
    dir: &PathBuf,
    depth: usize,
    seen: &mut HashSet<PathBuf>,
    candidates: &mut Vec<RecentJsonlCandidate>,
) {
    if depth > 7 || candidates.len() > 2000 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_recent_jsonl_candidates(&path, depth + 1, seen, candidates);
            continue;
        }
        if !is_jsonl_file(&path) {
            continue;
        }
        if !seen.insert(path.clone()) {
            continue;
        }
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        candidates.push(RecentJsonlCandidate {
            modified: metadata_modified_millis(&metadata),
            size: metadata.len(),
            path,
        });
    }
}

fn publish_turn(state: &Arc<Mutex<NativeBridgeState>>, turn: Turn, path: &PathBuf) {
    let worker_publish = {
        let Ok(mut state) = state.lock() else {
            return;
        };
        state.active_sources.insert(turn.source);
        state.last_event_at = now_millis_string();
        state.last_source = turn.source.to_string();
        state.last_model = turn.model.clone();
        state.last_file = path.to_string_lossy().to_string();
        state.last_error.clear();
        state.totals.output_tokens += turn.output_tokens;
        state.totals.input_tokens += turn.input_tokens;
        state.totals.cache_read_tokens += turn.cache_read_tokens;
        state.totals.turns += 1;

        let event = turn_json(&turn, &state.totals);
        let payload = format!("data: {event}\n\n");
        state
            .clients
            .retain_mut(|client| client.write_all(payload.as_bytes()).is_ok());

        if state.worker_url.is_empty() {
            state.last_worker_publish_at.clear();
            state.last_worker_error.clear();
            return;
        }

        Some((
            state.worker_url.clone(),
            worker_publish_json(&state.identity, &turn, &state.totals),
        ))
    };

    let Some(worker_publish) = worker_publish else {
        return;
    };

    let state = Arc::clone(state);
    thread::spawn(move || {
        let (worker_url, payload) = worker_publish;
        let result = publish_to_worker(&worker_url, &payload);
        if let Ok(mut state) = state.lock() {
            match result {
                Ok(()) => {
                    state.last_worker_publish_at = now_millis_string();
                    state.last_worker_error.clear();
                }
                Err(error) => {
                    state.last_worker_error = error;
                }
            }
        }
    });
}

fn get_or_create_identity() -> Identity {
    let path = home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".sync-and-flow")
        .join("identity.json");
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let (Some(user_id), Some(nickname)) = (
                value.get("userId").and_then(|v| v.as_str()),
                value.get("nickname").and_then(|v| v.as_str()),
            ) {
                return Identity {
                    user_id: user_id.to_string(),
                    nickname: nickname.to_string(),
                    color: value
                        .get("color")
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                        .unwrap_or_else(|| color_for_id(user_id)),
                };
            }
        }
    }

    let user_id = format!("flow-{}-{}", std::process::id(), chrono_like_timestamp());
    let nickname = format!("Flow {}", &user_id[user_id.len().saturating_sub(4)..]);
    let identity = Identity {
        color: color_for_id(&user_id),
        user_id,
        nickname,
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, identity_json(&identity));
    identity
}

fn identity_json(identity: &Identity) -> String {
    serde_json::to_string(&IdentityPayload {
        user_id: &identity.user_id,
        nickname: &identity.nickname,
        color: &identity.color,
    })
    .unwrap_or_else(|_| "{}".to_string())
}

fn snapshot_json(totals: &Totals) -> String {
    serde_json::to_string(&SnapshotPayload {
        event_type: "snapshot",
        model: String::new(),
        source: String::new(),
        totals: wire_totals(totals),
        energy: flow_energy(totals),
    })
    .unwrap_or_else(|_| "{}".to_string())
}

fn turn_json(turn: &Turn, totals: &Totals) -> String {
    serde_json::to_string(&TurnPayload {
        event_type: "turn",
        source: turn.source,
        provider: turn.provider,
        model: &turn.model,
        delta: turn_delta(turn),
        totals: wire_totals(totals),
        source_totals: wire_totals(totals),
        energy: flow_energy(totals),
        timestamp: &turn.timestamp,
    })
    .unwrap_or_else(|_| "{}".to_string())
}

fn worker_publish_json(identity: &Identity, turn: &Turn, totals: &Totals) -> String {
    serde_json::to_string(&WorkerPublishPayload {
        kind: "publish",
        user_id: &identity.user_id,
        nickname: &identity.nickname,
        color: &identity.color,
        source: turn.source,
        provider: turn.provider,
        model: &turn.model,
        delta: turn_delta(turn),
        totals: wire_totals(totals),
        energy: flow_energy(totals),
        timestamp: &turn.timestamp,
    })
    .unwrap_or_else(|_| "{}".to_string())
}

fn wire_totals(totals: &Totals) -> WireTotals {
    WireTotals {
        output_tokens: totals.output_tokens,
        input_tokens: totals.input_tokens,
        cache_read_tokens: totals.cache_read_tokens,
        turns: totals.turns,
        total_usd: 0,
    }
}

fn turn_delta(turn: &Turn) -> TurnDelta {
    TurnDelta {
        output_tokens: turn.output_tokens,
        input_tokens: turn.input_tokens,
        cache_read_tokens: turn.cache_read_tokens,
    }
}

fn flow_energy(totals: &Totals) -> f64 {
    totals.output_tokens as f64 + totals.cache_read_tokens as f64 * 0.1
}

fn color_for_id(id: &str) -> String {
    let colors = [
        "#f97316", "#14b8a6", "#38bdf8", "#facc15", "#fb7185", "#a3e635",
    ];
    let hash = id.bytes().fold(0usize, |acc, byte| {
        acc.wrapping_mul(31).wrapping_add(byte as usize)
    });
    colors[hash % colors.len()].to_string()
}

fn generate_bridge_token() -> String {
    let mut bytes = [0_u8; 32];
    let filled = File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .is_ok();

    if !filled {
        let fallback = format!("{}-{}", std::process::id(), chrono_like_timestamp());
        for (index, byte) in fallback.bytes().enumerate() {
            bytes[index % bytes.len()] ^= byte;
        }
    }

    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn escape_json(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn json_string_array(values: &[String]) -> String {
    let items = values
        .iter()
        .map(|value| format!("\"{}\"", escape_json(value)))
        .collect::<Vec<_>>()
        .join(",");
    format!("[{items}]")
}

fn chrono_like_timestamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn now_millis_string() -> String {
    chrono_like_timestamp().to_string()
}

fn metadata_modified_millis(metadata: &fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn native_bridge_serves_authorized_health_and_identity() {
        let mut bridge = spawn_native_bridge().expect("bridge");
        wait_for_bridge_http(bridge.port);

        let unauthorized = http_get(bridge.port, "/health");
        assert!(unauthorized.starts_with("HTTP/1.1 401 Unauthorized"));

        let health = http_get(bridge.port, &format!("/health?token={}", bridge.token));
        assert!(health.starts_with("HTTP/1.1 200 OK"));
        assert!(health.contains(r#""runtime":"tauri-native""#));

        let identity = http_get(bridge.port, "/identity");
        assert!(identity.starts_with("HTTP/1.1 200 OK"));
        assert!(identity.contains(r#""userId":"#));
        assert!(identity.contains(r#""nickname":"#));

        bridge.shutdown.store(true, Ordering::Relaxed);
        let _ = TcpStream::connect(("127.0.0.1", bridge.port));
        if let Some(handle) = bridge.handle.take() {
            handle.join().expect("bridge thread joined");
        }
    }

    #[test]
    fn native_bridge_allows_lan_dev_origin() {
        assert!(is_allowed_origin("http://192.168.0.38:5175"));
        assert!(is_allowed_origin("http://10.0.0.2:5175"));
        assert!(is_allowed_origin("http://172.16.0.2:5175"));
        assert!(!is_allowed_origin("http://192.168.0.38:3000"));
        assert!(!is_allowed_origin("https://192.168.0.38:5175"));
    }

    #[test]
    fn recognizes_jsonl_under_explicit_pi_session_root() {
        let session_root = PathBuf::from("/tmp/custom-pi-sessions");

        assert!(is_pi_session_jsonl(
            Path::new("/tmp/custom-pi-sessions/project/session.jsonl"),
            &session_root,
        ));
        assert!(!is_pi_session_jsonl(
            Path::new("/tmp/custom-pi-sessions/project/session.txt"),
            &session_root,
        ));
        assert!(!is_pi_session_jsonl(
            Path::new("/tmp/other-pi-sessions/project/session.jsonl"),
            &session_root,
        ));
    }

    #[test]
    fn discovers_supported_and_recent_jsonl_files() {
        let root = temp_test_dir("flow-link-discovery");
        let cwd = root.join("cwd");
        let home = root.join("home");
        let claude_project = home.join(".claude").join("projects").join("project-a");
        let codex_day = home
            .join(".codex")
            .join("sessions")
            .join("2026")
            .join("05")
            .join("15");
        let pi_session = home
            .join(".pi")
            .join("agent")
            .join("sessions")
            .join("project-a");
        let too_deep = home
            .join(".claude")
            .join("projects")
            .join("a")
            .join("b")
            .join("c")
            .join("d")
            .join("e")
            .join("f");

        fs::create_dir_all(&cwd).expect("cwd");
        fs::create_dir_all(&claude_project).expect("claude project");
        fs::create_dir_all(&codex_day).expect("codex day");
        fs::create_dir_all(&pi_session).expect("pi session");
        fs::create_dir_all(&too_deep).expect("deep claude project");

        let cwd_claude = cwd.join("00000000-0000-0000-0000-000000000001.jsonl");
        let home_claude = claude_project.join("00000000-0000-0000-0000-000000000002.jsonl");
        let codex = codex_day.join("rollout-test.jsonl");
        let pi = pi_session.join("session.jsonl");
        let ignored_cwd = cwd.join("not-a-session.jsonl");
        let ignored_codex = codex_day.join("notes.jsonl");
        let ignored_deep = too_deep.join("00000000-0000-0000-0000-000000000003.jsonl");

        for path in [
            &cwd_claude,
            &home_claude,
            &codex,
            &pi,
            &ignored_cwd,
            &ignored_codex,
            &ignored_deep,
        ] {
            fs::write(path, "").expect("fixture file");
        }

        let mut discovered = discover_jsonl_files_from(Some(&cwd), Some(&home));
        discovered.sort();

        let mut expected = vec![
            cwd_claude,
            home_claude,
            codex,
            pi,
            ignored_codex,
            ignored_deep,
        ];
        expected.sort();
        assert_eq!(discovered, expected);

        fs::remove_dir_all(root).expect("cleanup");
    }

    fn wait_for_bridge_http(port: u16) {
        for _ in 0..50 {
            let response = http_get_maybe(port, "/identity").unwrap_or_default();
            if response.starts_with("HTTP/1.1 200 OK") {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("bridge did not start");
    }

    fn http_get(port: u16, path: &str) -> String {
        for _ in 0..20 {
            if let Some(response) = http_get_maybe(port, path) {
                if !response.is_empty() {
                    return response;
                }
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("bridge did not respond to {path}");
    }

    fn http_get_maybe(port: u16, path: &str) -> Option<String> {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).ok()?;
        let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        stream.write_all(request.as_bytes()).ok()?;
        let _ = stream.set_read_timeout(Some(Duration::from_millis(1_000)));
        let mut response = String::new();
        let mut buf = [0_u8; 4096];
        for _ in 0..20 {
            match stream.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    response.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if response.contains("\r\n\r\n") {
                        break;
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) && !response.is_empty() =>
                {
                    break;
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => {
                    if response.is_empty() {
                        return None;
                    }
                    break;
                }
                Err(error) => panic!("read response: {error}"),
            }
        }
        Some(response)
    }

    fn temp_test_dir(prefix: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "{}-{}-{}",
            prefix,
            std::process::id(),
            chrono_like_timestamp()
        ));
        fs::create_dir_all(&path).expect("temp root");
        path
    }
}
