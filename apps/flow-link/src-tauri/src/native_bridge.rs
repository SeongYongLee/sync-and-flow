use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Turn {
    pub source: &'static str,
    pub provider: &'static str,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub timestamp: String,
}

#[derive(Default)]
pub struct CodexParseState {
    models: HashMap<PathBuf, String>,
    sessions: HashMap<PathBuf, String>,
    cumulative_by_session: HashMap<String, u64>,
}

impl CodexParseState {
    pub fn parse_turn(&mut self, line: &str, path: &Path) -> Option<Turn> {
        let entry: serde_json::Value = serde_json::from_str(line).ok()?;
        let entry_type = entry.get("type")?.as_str()?;
        let payload = entry.get("payload")?;
        let path = path.to_path_buf();

        if entry_type == "session_meta" {
            if let Some(model) = payload.get("model").and_then(|v| v.as_str()) {
                self.models.insert(path.clone(), model.to_string());
            }
            if let Some(session) = payload
                .get("id")
                .or_else(|| payload.get("session_id"))
                .and_then(|v| v.as_str())
            {
                self.sessions.insert(path, session.to_string());
            }
            return None;
        }

        if entry_type == "turn_context" {
            if let Some(model) = payload.get("model").and_then(|v| v.as_str()) {
                self.models.insert(path, model.to_string());
            }
            return None;
        }

        if entry_type != "event_msg" || payload.get("type")?.as_str()? != "token_count" {
            return None;
        }

        let info = payload.get("info")?;
        let last = info.get("last_token_usage")?;
        let total = info.get("total_token_usage").unwrap_or(last);
        let cumulative = total.get("total_tokens")?.as_u64()?;
        let session = self
            .sessions
            .get(&path)
            .cloned()
            .unwrap_or_else(|| path.to_string_lossy().to_string());
        if self.cumulative_by_session.get(&session) == Some(&cumulative) {
            return None;
        }
        self.cumulative_by_session.insert(session, cumulative);

        let input = last.get("input_tokens")?.as_u64()?;
        let cached = last
            .get("cached_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let output = last.get("output_tokens")?.as_u64()?
            + last
                .get("reasoning_output_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

        Some(Turn {
            source: "codex",
            provider: "openai",
            model: self
                .models
                .get(&path)
                .cloned()
                .unwrap_or_else(|| "unknown".to_string()),
            input_tokens: input.saturating_sub(cached),
            output_tokens: output,
            cache_read_tokens: cached,
            timestamp: entry
                .get("timestamp")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
    }
}

pub fn parse_claude_turn(line: &str) -> Option<Turn> {
    let entry: serde_json::Value = serde_json::from_str(line).ok()?;
    if entry.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let message = entry.get("message")?;
    if message.get("role")?.as_str()? != "assistant" {
        return None;
    }
    let model = message.get("model")?.as_str()?.to_string();
    if model == "<synthetic>" {
        return None;
    }
    let usage = message.get("usage")?;
    Some(Turn {
        source: "claude",
        provider: "anthropic",
        model,
        input_tokens: usage.get("input_tokens")?.as_u64()?,
        output_tokens: usage.get("output_tokens")?.as_u64()?,
        cache_read_tokens: usage
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        timestamp: entry
            .get("timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

pub fn parse_pi_turn(line: &str) -> Option<Turn> {
    let entry: serde_json::Value = serde_json::from_str(line).ok()?;

    if let Some(turn) = parse_pi_message_entry(&entry) {
        return Some(turn);
    }

    if let Some(turn) = parse_pi_claude_like(&entry) {
        return Some(turn);
    }

    if let Some(turn) = parse_pi_codex_like(&entry) {
        return Some(turn);
    }

    parse_pi_generic_usage(&entry)
}

fn parse_pi_message_entry(entry: &serde_json::Value) -> Option<Turn> {
    if entry.get("type")?.as_str()? != "message" {
        return None;
    }
    let message = entry.get("message")?;
    if message.get("role")?.as_str()? != "assistant" {
        return None;
    }
    let usage = message.get("usage")?;
    let provider = match message.get("provider").and_then(|v| v.as_str()) {
        Some("anthropic") => "anthropic",
        Some("google") => "google",
        Some("github") => "github",
        _ => "openai",
    };
    Some(Turn {
        source: "pi",
        provider,
        model: message
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("pi-agent")
            .to_string(),
        input_tokens: usage_number(usage, &["input", "input_tokens", "inputTokens"])?,
        output_tokens: usage_number(usage, &["output", "output_tokens", "outputTokens"])?,
        cache_read_tokens: usage_number(
            usage,
            &[
                "cacheRead",
                "cache_read_input_tokens",
                "cacheReadTokens",
                "cached_input_tokens",
            ],
        )
        .unwrap_or(0),
        timestamp: entry
            .get("timestamp")
            .or_else(|| message.get("timestamp"))
            .and_then(|v| {
                v.as_str()
                    .map(str::to_string)
                    .or_else(|| v.as_u64().map(|n| n.to_string()))
            })
            .unwrap_or_default(),
    })
}

fn parse_pi_claude_like(entry: &serde_json::Value) -> Option<Turn> {
    if entry.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let message = entry.get("message")?;
    if message.get("role")?.as_str()? != "assistant" {
        return None;
    }
    let usage = message.get("usage")?;
    Some(Turn {
        source: "pi",
        provider: "anthropic",
        model: message
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("pi-claude")
            .to_string(),
        input_tokens: usage.get("input_tokens")?.as_u64()?,
        output_tokens: usage.get("output_tokens")?.as_u64()?,
        cache_read_tokens: usage
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        timestamp: entry
            .get("timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

fn parse_pi_codex_like(entry: &serde_json::Value) -> Option<Turn> {
    if entry.get("type")?.as_str()? != "event_msg" {
        return None;
    }
    let payload = entry.get("payload")?;
    if payload.get("type")?.as_str()? != "token_count" {
        return None;
    }
    let info = payload.get("info")?;
    let last = info.get("last_token_usage")?;
    Some(Turn {
        source: "pi",
        provider: "openai",
        model: payload
            .get("model")
            .or_else(|| info.get("model"))
            .and_then(|v| v.as_str())
            .unwrap_or("pi-agent")
            .to_string(),
        input_tokens: last.get("input_tokens")?.as_u64()?.saturating_sub(
            last.get("cached_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
        ),
        output_tokens: last.get("output_tokens")?.as_u64()?
            + last
                .get("reasoning_output_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
        cache_read_tokens: last
            .get("cached_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        timestamp: entry
            .get("timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

fn parse_pi_generic_usage(entry: &serde_json::Value) -> Option<Turn> {
    let usage = entry
        .get("usage")
        .or_else(|| entry.get("token_usage"))
        .or_else(|| entry.get("tokenUsage"))
        .or_else(|| {
            entry
                .get("message")
                .and_then(|message| message.get("usage"))
        })?;
    let model = entry
        .get("model")
        .or_else(|| {
            entry
                .get("message")
                .and_then(|message| message.get("model"))
        })
        .and_then(|v| v.as_str())
        .unwrap_or("pi-agent")
        .to_string();
    let cached = usage_number(
        usage,
        &[
            "cacheRead",
            "cached_input_tokens",
            "cache_read_input_tokens",
            "cacheReadTokens",
        ],
    )
    .unwrap_or(0);
    Some(Turn {
        source: "pi",
        provider: if model.to_ascii_lowercase().contains("claude") {
            "anthropic"
        } else {
            "openai"
        },
        model,
        input_tokens: usage_number(usage, &["input", "input_tokens", "inputTokens"])?
            .saturating_sub(usage_number(usage, &["cached_input_tokens"]).unwrap_or(0)),
        output_tokens: usage_number(usage, &["output", "output_tokens", "outputTokens"])?
            + usage_number(usage, &["reasoning_output_tokens"]).unwrap_or(0),
        cache_read_tokens: cached,
        timestamp: entry
            .get("timestamp")
            .or_else(|| entry.get("created_at"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

fn usage_number(usage: &serde_json::Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| usage.get(*key).and_then(|value| value.as_u64()))
}

pub fn is_claude_session_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(stem) = name.strip_suffix(".jsonl") else {
        return false;
    };
    stem.len() == 36 && stem.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

pub fn is_codex_path(path: &Path) -> bool {
    path.components()
        .any(|component| component.as_os_str() == "sessions")
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
}

pub fn is_pi_path(path: &Path) -> bool {
    let components = path
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect::<Vec<_>>();
    components
        .windows(3)
        .any(|window| window == [".pi", "agent", "sessions"])
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".jsonl"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_claude_assistant_usage() {
        let line = r#"{"type":"assistant","timestamp":"2026-05-12T00:00:00Z","message":{"role":"assistant","model":"claude-sonnet","usage":{"input_tokens":10,"output_tokens":20,"cache_creation_input_tokens":0,"cache_read_input_tokens":3}}}"#;
        let turn = parse_claude_turn(line).expect("turn");

        assert_eq!(turn.source, "claude");
        assert_eq!(turn.provider, "anthropic");
        assert_eq!(turn.model, "claude-sonnet");
        assert_eq!(turn.input_tokens, 10);
        assert_eq!(turn.output_tokens, 20);
        assert_eq!(turn.cache_read_tokens, 3);
    }

    #[test]
    fn matches_typescript_claude_fixture_contract() {
        let line = include_str!("../../../../fixtures/single-turn.jsonl")
            .lines()
            .next()
            .expect("fixture line");
        let turn = parse_claude_turn(line).expect("turn");

        assert_eq!(turn.source, "claude");
        assert_eq!(turn.provider, "anthropic");
        assert_eq!(turn.model, "claude-sonnet-4-6");
        assert_eq!(turn.input_tokens, 100);
        assert_eq!(turn.output_tokens, 50);
        assert_eq!(turn.cache_read_tokens, 200);
        assert_eq!(turn.timestamp, "2026-05-06T10:00:00.000Z");
    }

    #[test]
    fn parses_codex_token_count_with_cached_normalization_and_reasoning() {
        let path = PathBuf::from("/Users/me/.codex/sessions/2026/05/12/rollout-test.jsonl");
        let mut state = CodexParseState::default();
        assert!(state
            .parse_turn(
                r#"{"type":"session_meta","payload":{"id":"s1","model":"gpt-5.4"}}"#,
                &path
            )
            .is_none());

        let line = r#"{"type":"event_msg","timestamp":"2026-05-12T00:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":15,"cached_input_tokens":5,"output_tokens":7,"reasoning_output_tokens":2,"total_tokens":24},"total_token_usage":{"total_tokens":24}}}}"#;
        let turn = state.parse_turn(line, &path).expect("turn");

        assert_eq!(turn.source, "codex");
        assert_eq!(turn.provider, "openai");
        assert_eq!(turn.model, "gpt-5.4");
        assert_eq!(turn.input_tokens, 10);
        assert_eq!(turn.output_tokens, 9);
        assert_eq!(turn.cache_read_tokens, 5);
        assert!(state.parse_turn(line, &path).is_none());
    }

    #[test]
    fn matches_typescript_codex_fixture_contract() {
        let path = PathBuf::from("/Users/me/.codex/sessions/2026/05/07/rollout-test.jsonl");
        let mut state = CodexParseState::default();
        let turns = include_str!("../../../../fixtures/codex-single-turn.jsonl")
            .lines()
            .filter_map(|line| state.parse_turn(line, &path))
            .collect::<Vec<_>>();

        assert_eq!(turns.len(), 1);
        let turn = &turns[0];
        assert_eq!(turn.source, "codex");
        assert_eq!(turn.provider, "openai");
        assert_eq!(turn.model, "gpt-5-codex");
        assert_eq!(turn.input_tokens, 80);
        assert_eq!(turn.output_tokens, 15);
        assert_eq!(turn.cache_read_tokens, 20);
        assert_eq!(turn.timestamp, "2026-05-07T00:00:01.000Z");
    }

    #[test]
    fn identifies_supported_session_paths() {
        assert!(is_claude_session_path(Path::new(
            "28d3eb5b-48b3-4757-bf75-4c876dadaaf5.jsonl"
        )));
        assert!(!is_claude_session_path(Path::new("not-a-session.jsonl")));
        assert!(is_codex_path(Path::new(
            "/Users/me/.codex/sessions/2026/05/12/rollout-test.jsonl"
        )));
        assert!(!is_codex_path(Path::new(
            "/Users/me/.codex/rollout-test.jsonl"
        )));
        assert!(is_pi_path(Path::new(
            "/Users/me/.pi/agent/sessions/project/session.jsonl"
        )));
        assert!(!is_pi_path(Path::new(
            "/Users/me/.codex/sessions/2026/05/12/rollout-test.jsonl"
        )));
    }

    #[test]
    fn parses_pi_claude_like_assistant_usage_as_pi_source() {
        let line = r#"{"type":"assistant","timestamp":"2026-05-19T01:00:00Z","message":{"role":"assistant","model":"claude-opus-4","usage":{"input_tokens":30,"output_tokens":40,"cache_creation_input_tokens":0,"cache_read_input_tokens":8}}}"#;
        let turn = parse_pi_turn(line).expect("turn");

        assert_eq!(turn.source, "pi");
        assert_eq!(turn.provider, "anthropic");
        assert_eq!(turn.model, "claude-opus-4");
        assert_eq!(turn.input_tokens, 30);
        assert_eq!(turn.output_tokens, 40);
        assert_eq!(turn.cache_read_tokens, 8);
        assert_eq!(turn.timestamp, "2026-05-19T01:00:00Z");
    }

    #[test]
    fn parses_pi_generic_usage_and_infers_provider_from_model() {
        let line = r#"{"created_at":"2026-05-19T02:00:00Z","model":"gpt-5-codex","usage":{"input_tokens":50,"cached_input_tokens":15,"output_tokens":12,"reasoning_output_tokens":4}}"#;
        let turn = parse_pi_turn(line).expect("turn");

        assert_eq!(turn.source, "pi");
        assert_eq!(turn.provider, "openai");
        assert_eq!(turn.model, "gpt-5-codex");
        assert_eq!(turn.input_tokens, 35);
        assert_eq!(turn.output_tokens, 16);
        assert_eq!(turn.cache_read_tokens, 15);
        assert_eq!(turn.timestamp, "2026-05-19T02:00:00Z");
    }

    #[test]
    fn parses_pi_codex_like_usage_as_pi_source() {
        let line = r#"{"type":"event_msg","timestamp":"2026-05-18T00:00:00Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":15,"cached_input_tokens":5,"output_tokens":7,"reasoning_output_tokens":2,"total_tokens":24}}}}"#;
        let turn = parse_pi_turn(line).expect("turn");

        assert_eq!(turn.source, "pi");
        assert_eq!(turn.provider, "openai");
        assert_eq!(turn.model, "pi-agent");
        assert_eq!(turn.input_tokens, 10);
        assert_eq!(turn.output_tokens, 9);
        assert_eq!(turn.cache_read_tokens, 5);
    }

    #[test]
    fn parses_pi_message_usage_with_openai_codex_provider_name() {
        let line = r#"{"type":"message","id":"entry-1","parentId":"entry-0","timestamp":"2026-05-19T03:00:00Z","message":{"role":"assistant","api":"responses","provider":"openai-codex","model":"gpt-5.5","usage":{"input":4864,"output":61,"cacheRead":100,"cacheWrite":25,"totalTokens":5025,"cost":0}}}"#;
        let turn = parse_pi_turn(line).expect("turn");

        assert_eq!(turn.source, "pi");
        assert_eq!(turn.provider, "openai");
        assert_eq!(turn.model, "gpt-5.5");
        assert_eq!(turn.input_tokens, 4864);
        assert_eq!(turn.output_tokens, 61);
        assert_eq!(turn.cache_read_tokens, 100);
        assert_eq!(turn.timestamp, "2026-05-19T03:00:00Z");
    }

    #[test]
    fn parses_pi_message_usage_with_simple_token_names() {
        let line = r#"{"type":"message","timestamp":"2026-05-19T00:00:00Z","message":{"role":"assistant","provider":"anthropic","model":"claude-sonnet-4","usage":{"input":10,"output":20,"cacheRead":3,"totalTokens":33}}}"#;
        let turn = parse_pi_turn(line).expect("turn");

        assert_eq!(turn.source, "pi");
        assert_eq!(turn.provider, "anthropic");
        assert_eq!(turn.model, "claude-sonnet-4");
        assert_eq!(turn.input_tokens, 10);
        assert_eq!(turn.output_tokens, 20);
        assert_eq!(turn.cache_read_tokens, 3);
        assert_eq!(turn.timestamp, "2026-05-19T00:00:00Z");
    }
}
