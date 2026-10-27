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
