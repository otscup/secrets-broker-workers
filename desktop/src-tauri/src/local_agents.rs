use std::process::{Command, Stdio};
use tauri::AppHandle;

/// Add the local sidecar to the MCP clients found on this machine.
///
/// The CLI already owns the config shapes; this only supplies the installed
/// sidecar's own Node and entry point, so the desktop never depends on PATH.
#[tauri::command]
pub fn connect_local_agents(app: AppHandle) -> Result<String, String> {
    let dir = crate::sidecar::sidecar_dir(&app)
        .ok_or("sidecar resources missing; reinstall Secrets Broker")?;
    let mut command = Command::new(dir.join("node.exe"));
    command
        .arg(dir.join("cli/index.mjs"))
        .args(["agents", "connect", "--apply", "--local"])
        .current_dir(&dir)
        .stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let output = command
        .output()
        .map_err(|error| format!("cannot run the local CLI: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("local agent setup failed ({})", output.status)
        } else {
            stderr
        });
    }
    Ok(if stdout.is_empty() {
        "已接入本机 Agent".to_string()
    } else {
        stdout
    })
}

/// Check-only update lookup. The CLI owns the GitHub comparison; the desktop
/// passes its own version because the packed sidecar has no desktop config.
#[tauri::command]
pub fn check_update(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = crate::sidecar::sidecar_dir(&app)
        .ok_or("sidecar resources missing; reinstall Secrets Broker")?;
    let current = app.package_info().version.to_string();
    let mut command = Command::new(dir.join("node.exe"));
    command
        .arg(dir.join("cli/index.mjs"))
        .args(["update", "--json", "--current", &current])
        .current_dir(&dir)
        .stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let output = command
        .output()
        .map_err(|error| format!("cannot run the local CLI: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("update check failed ({})", output.status)
        } else {
            stderr
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(stdout.trim()).map_err(|error| format!("bad update response: {error}"))
}
