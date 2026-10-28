use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::{server, sidecar};

#[derive(serde::Serialize)]
pub struct Diagnostics {
    version: &'static str,
    server: Option<String>,
    local: Option<Value>,
    backup: Option<Value>,
}

#[tauri::command]
pub fn get_diagnostics(app: AppHandle) -> Diagnostics {
    Diagnostics {
        version: env!("CARGO_PKG_VERSION"),
        server: server::read_saved(&app),
        local: sidecar::local_health(),
        backup: backup_status(),
    }
}

fn backup_status() -> Option<Value> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    backup_status_at(&PathBuf::from(home).join("secrets-broker-backups"))
}

fn backup_status_at(root: &Path) -> Option<Value> {
    if let Ok(text) = fs::read_to_string(root.join("last-backup.json")) {
        if let Ok(value) = serde_json::from_str(&text) {
            return Some(value);
        }
    }
    let mut snapshots = fs::read_dir(root)
        .ok()?
        .flatten()
        .filter(|entry| entry.path().join("backup.json").is_file())
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    snapshots.sort();
    let target = snapshots.pop()?;
    let at = fs::read_to_string(target.join("backup.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|meta| meta.get("createdAt")?.as_str().map(str::to_string));
    Some(json!({ "ok": true, "at": at, "target": target }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_status_file_falls_back_to_the_newest_snapshot() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("sb-diag-{}-{stamp}", std::process::id()));
        let snapshot = root.join("2026-01-01T00-00-00-000Z");
        fs::create_dir_all(&snapshot).unwrap();
        fs::write(snapshot.join("backup.json"), r#"{"createdAt":"2026-01-01T00:00:00.000Z"}"#).unwrap();
        let value = backup_status_at(&root).unwrap();
        assert_eq!(value["at"], "2026-01-01T00:00:00.000Z");
        assert_eq!(value["ok"], true);
        let _ = fs::remove_dir_all(root);
    }
}
