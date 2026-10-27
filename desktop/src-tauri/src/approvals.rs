// A local agent read waits on the daemon's approval page. Poll that queue and
// raise a native notification so the person knows to act; the page itself is
// opened by the daemon.
use std::collections::HashSet;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

fn pending() -> Option<Vec<serde_json::Value>> {
    let mut stream = TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], 4319)),
        Duration::from_millis(800),
    )
    .ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    stream
        .write_all(b"GET /local/pending HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .ok()?;
    let mut raw = String::new();
    stream.read_to_string(&mut raw).ok()?;
    let body = raw.split("\r\n\r\n").nth(1)?;
    serde_json::from_str(body).ok()
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut seen = HashSet::new();
        loop {
            if let Some(rows) = pending() {
                if seen.len() > 200 {
                    seen.clear();
                }
                for row in rows {
                    let Some(id) = row.get("id").and_then(|value| value.as_str()) else { continue };
                    if !seen.insert(id.to_string()) {
                        continue;
                    }
                    let agent = row.get("agent").and_then(|value| value.as_str()).unwrap_or("agent");
                    let item = row.get("item").and_then(|value| value.as_str()).unwrap_or("a secret");
                    let tool = row.get("tool").and_then(|value| value.as_str()).unwrap_or("read");
                    let body = format!("{agent} wants to {tool} {item}. Approve in the opened page.");
                    let _ = app
                        .notification()
                        .builder()
                        .title("Secrets Broker approval")
                        .body(body)
                        .sound("Default")
                        .show();
                }
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}
