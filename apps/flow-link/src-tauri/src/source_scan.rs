use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::Duration,
};

use crate::{
    chrono_like_timestamp, home_dir, metadata_modified_millis,
    native_bridge::{is_claude_session_path, is_codex_path, is_pi_path},
};

pub(crate) struct ScanSummary {
    pub(crate) watched_files: usize,
    pub(crate) watched_bytes: u64,
    pub(crate) latest_file: String,
    pub(crate) latest_file_size: u64,
    pub(crate) latest_file_modified_at: String,
}

pub(crate) fn summarize_files(files: &[PathBuf]) -> ScanSummary {
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

pub(crate) fn discover_jsonl_files() -> Vec<PathBuf> {
    let cwd = std::env::current_dir().ok();
    let home = home_dir();
    discover_jsonl_files_from(cwd.as_ref(), home.as_ref())
}

pub(crate) fn discover_jsonl_files_from(
    cwd: Option<&PathBuf>,
    home: Option<&PathBuf>,
) -> Vec<PathBuf> {
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

pub(crate) fn source_roots_status_json(home: Option<&PathBuf>) -> String {
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

pub(crate) fn is_pi_log_path(path: &Path) -> bool {
    if is_pi_path(path) {
        return true;
    }

    let Some(home) = home_dir() else {
        return false;
    };
    is_pi_session_jsonl(path, &pi_sessions_dir(&home))
}

pub(crate) fn is_pi_session_jsonl(path: &Path, session_dir: &Path) -> bool {
    path.starts_with(session_dir)
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension == "jsonl")
}

pub(crate) fn read_new_lines(path: &PathBuf, offset: u64) -> Vec<String> {
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

pub(crate) fn discover_recent_jsonl_candidates() -> Vec<String> {
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
