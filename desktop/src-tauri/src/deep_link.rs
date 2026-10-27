use std::process::Command;
use tauri::{AppHandle, Manager};
use url::Url;

// Deep links carry only the short pairing code and the browser URL. The device
// token and password stay in the CLI/DPAPI store; this handler never sees them.
pub fn handle(app: &AppHandle, urls: &[Url]) {
    for url in urls {
        let Some(approval) = approval_url(url) else { continue };
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
        open_browser(&approval);
    }
}

fn approval_url(url: &Url) -> Option<String> {
    if url.scheme() != "secrets-broker" || url.host_str() != Some("pair") {
        return None;
    }
    let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    let base = params.get("url")?;
    let code = params.get("code")?;
    if !(base.starts_with("https://") || base.starts_with("http://127.0.0.1")) {
        return None;
    }
    if code.is_empty() || code.len() > 32 {
        return None;
    }
    Some(format!(
        "{}/pair?code={}",
        base.trim_end_matches('/'),
        urlencoding(code)
    ))
}

fn urlencoding(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(windows)]
fn open_browser(url: &str) {
    let _ = Command::new("cmd").args(["/C", "start", "", url]).spawn();
}

#[cfg(target_os = "macos")]
fn open_browser(url: &str) {
    let _ = Command::new("open").arg(url).spawn();
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_browser(url: &str) {
    let _ = Command::new("xdg-open").arg(url).spawn();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pairing_link_becomes_the_approval_page() {
        let link = Url::parse("secrets-broker://pair?url=https%3A%2F%2Fsb.example%2F&code=AB12CD").unwrap();
        assert_eq!(
            approval_url(&link).as_deref(),
            Some("https://sb.example/pair?code=AB12CD")
        );
    }

    #[test]
    fn a_link_to_another_scheme_is_ignored() {
        let link = Url::parse("https://evil.example/pair?code=AB12CD").unwrap();
        assert!(approval_url(&link).is_none());
    }

    #[test]
    fn a_plain_http_host_is_ignored_except_for_loopback() {
        let remote = Url::parse("secrets-broker://pair?url=http%3A%2F%2Fevil.example&code=AB12CD").unwrap();
        assert!(approval_url(&remote).is_none());
        let local = Url::parse("secrets-broker://pair?url=http%3A%2F%2F127.0.0.1%3A8787&code=AB12CD").unwrap();
        assert_eq!(
            approval_url(&local).as_deref(),
            Some("http://127.0.0.1:8787/pair?code=AB12CD")
        );
    }
}
