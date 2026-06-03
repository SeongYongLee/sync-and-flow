use serde::Serialize;

use crate::native_bridge::Turn;

#[derive(Clone)]
pub(crate) struct Identity {
    pub(crate) user_id: String,
    pub(crate) nickname: String,
    pub(crate) color: String,
}

#[derive(Default, Clone)]
pub(crate) struct Totals {
    pub(crate) output_tokens: u64,
    pub(crate) input_tokens: u64,
    pub(crate) cache_read_tokens: u64,
    pub(crate) turns: u64,
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

pub(crate) fn identity_json(identity: &Identity) -> String {
    serde_json::to_string(&IdentityPayload {
        user_id: &identity.user_id,
        nickname: &identity.nickname,
        color: &identity.color,
    })
    .unwrap_or_else(|_| "{}".to_string())
}

pub(crate) fn snapshot_json(totals: &Totals) -> String {
    serde_json::to_string(&SnapshotPayload {
        event_type: "snapshot",
        model: String::new(),
        source: String::new(),
        totals: wire_totals(totals),
        energy: flow_energy(totals),
    })
    .unwrap_or_else(|_| "{}".to_string())
}

pub(crate) fn turn_json(turn: &Turn, totals: &Totals) -> String {
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

pub(crate) fn worker_publish_json(identity: &Identity, turn: &Turn, totals: &Totals) -> String {
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

pub(crate) fn color_for_id(id: &str) -> String {
    let colors = [
        "#f97316", "#14b8a6", "#38bdf8", "#facc15", "#fb7185", "#a3e635",
    ];
    let hash = id.bytes().fold(0usize, |acc, byte| {
        acc.wrapping_mul(31).wrapping_add(byte as usize)
    });
    colors[hash % colors.len()].to_string()
}
