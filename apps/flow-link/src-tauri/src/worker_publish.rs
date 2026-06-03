use std::time::Duration;

pub(crate) fn resolve_worker_url() -> String {
    std::env::var("SYNC_FLOW_WORKER_URL")
        .or_else(|_| std::env::var("VITE_SYNC_FLOW_WORKER_URL"))
        .or_else(|_| {
            option_env!("FLOW_LINK_DEFAULT_WORKER_URL")
                .map(str::to_string)
                .ok_or(std::env::VarError::NotPresent)
        })
        .unwrap_or_default()
}

pub(crate) fn publish_to_worker(worker_url: &str, payload: &str) -> Result<(), String> {
    let endpoint = worker_publish_endpoint(worker_url)?;
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(1_500))
        .build()
        .map_err(|error| error.to_string())?
        .post(endpoint)
        .header("Content-Type", "application/json")
        .body(payload.to_string())
        .send()
        .map_err(|error| error.to_string())?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("worker publish failed: {}", response.status()))
    }
}

fn worker_publish_endpoint(worker_url: &str) -> Result<String, String> {
    let base = worker_url.trim().trim_end_matches('/');
    if let Some(rest) = base.strip_prefix("ws://") {
        return Ok(worker_publish_endpoint_with_scheme("http://", rest));
    }
    if let Some(rest) = base.strip_prefix("http://") {
        return Ok(worker_publish_endpoint_with_scheme("http://", rest));
    }
    if let Some(rest) = base.strip_prefix("wss://") {
        return Ok(worker_publish_endpoint_with_scheme("https://", rest));
    }
    if let Some(rest) = base.strip_prefix("https://") {
        return Ok(worker_publish_endpoint_with_scheme("https://", rest));
    }
    Err(format!("unsupported worker url: {worker_url}"))
}

fn worker_publish_endpoint_with_scheme(scheme: &str, rest: &str) -> String {
    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
    let query = if query.is_empty() {
        String::new()
    } else {
        format!("?{query}")
    };
    format!("{scheme}{}/publish{query}", path.trim_end_matches('/'))
}

pub(crate) fn worker_watch_url(worker_url: &str) -> String {
    let Some((base, query)) = worker_url.split_once('?') else {
        return worker_url.to_string();
    };
    let query = query
        .split('&')
        .filter(|part| !part.starts_with("token="))
        .collect::<Vec<_>>()
        .join("&");
    if query.is_empty() {
        base.to_string()
    } else {
        format!("{base}?{query}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worker_publish_endpoint_converts_ws_to_http() {
        assert_eq!(
            worker_publish_endpoint("ws://127.0.0.1:8788").unwrap(),
            "http://127.0.0.1:8788/publish"
        );
        assert_eq!(
            worker_publish_endpoint("wss://example.com/presence").unwrap(),
            "https://example.com/presence/publish"
        );
        assert_eq!(
            worker_publish_endpoint("wss://example.com/presence?token=secret").unwrap(),
            "https://example.com/presence/publish?token=secret"
        );
        assert_eq!(
            worker_watch_url("wss://example.com/presence?token=secret"),
            "wss://example.com/presence"
        );
        assert_eq!(
            worker_watch_url("wss://example.com/presence?room=a&token=secret"),
            "wss://example.com/presence?room=a"
        );
    }
}
