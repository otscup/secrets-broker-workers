use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::MenuItem;
use tauri::{AppHandle, Manager, Wry};

pub struct SidecarState {
    child: Arc<Mutex<Option<Child>>>,
    stopped: Arc<AtomicBool>,
}

impl SidecarState {
    pub fn start(app: AppHandle, status_item: MenuItem<Wry>) -> Self {
        let child = Arc::new(Mutex::new(None));
        let stopped = Arc::new(AtomicBool::new(false));
        let thread_child = child.clone();
        let thread_stopped = stopped.clone();
        std::thread::spawn(move || loop {
            if thread_stopped.load(Ordering::Relaxed) {
                kill(&thread_child);
                break;
            }
            let paired = is_paired();
            {
                let mut guard = thread_child.lock().unwrap();
                // A revoked device removes device.json; stop holding decrypted
                // rows as soon as the file goes away.
                if !paired {
                    kill_locked(&mut guard);
                } else if let Some(process) = guard.as_mut() {
                    if process.try_wait().ok().flatten().is_some() {
                        *guard = None;
                    }
                }
                // The app can start before pairing and stay open: `up` used to
                // exit for good when there was no device yet.
                if paired && guard.is_none() {
                    match spawn(&app) {
                        Ok(process) => *guard = Some(process),
                        Err(error) => eprintln!("sidecar not started: {error}"),
                    }
                }
            }
            let label = if paired { health_label() } else { "未配对" };
            let _ = status_item.set_text(format!("状态：{label}"));
            if let Some(tray) = app.tray_by_id("main") {
                let _ = tray.set_tooltip(Some(format!("Secrets Broker · {label}")));
            }
            std::thread::sleep(Duration::from_secs(2));
        });
        Self { child, stopped }
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Relaxed);
        kill(&self.child);
    }
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        self.stop();
    }
}

fn kill(child: &Arc<Mutex<Option<Child>>>) {
    if let Ok(mut guard) = child.lock() {
        kill_locked(&mut guard);
    }
}

fn kill_locked(guard: &mut Option<Child>) {
    if let Some(mut process) = guard.take() {
        let _ = process.kill();
        let _ = process.wait();
    }
}

// The app and the CLI share the same per-user device record; the desktop does
// not add a second credential store.
fn device_file() -> Option<PathBuf> {
    device_file_with(
        std::env::var_os("BROKER_HOME").map(PathBuf::from),
        std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from),
    )
}

fn device_file_with(broker_home: Option<PathBuf>, home: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(home) = broker_home {
        return Some(home.join("device.json"));
    }
    home.map(|home| home.join(".secrets-broker").join("device.json"))
}

fn is_paired() -> bool {
    device_file().map(|file| file.is_file()).unwrap_or(false)
}

fn sidecar_dir(app: &AppHandle) -> Option<PathBuf> {
    // Prefer the copies shipped with the app; a machine that also has the
    // checkout must not silently run the developer tree.
    let mut candidates = Vec::new();
    if let Ok(resource) = app.path().resource_dir() {
        candidates.push(resource.join("resources/sidecar"));
        candidates.push(resource.join("sidecar"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/sidecar"));
    candidates.into_iter().find(|dir| dir.join("node.exe").is_file())
}

fn spawn(app: &AppHandle) -> Result<Child, String> {
    let dir = sidecar_dir(app).ok_or("sidecar resources missing; run npm run desktop:sidecar")?;
    let mut command = Command::new(dir.join("node.exe"));
    // Keep the daemon's own diagnostics; a silent exit is otherwise impossible
    // to tell apart from "never paired".
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(std::env::temp_dir().join("secrets-broker-sidecar.log"))
        .ok();
    let stdout = log.as_ref().and_then(|file| file.try_clone().ok()).map(Stdio::from);
    let stderr = log.map(Stdio::from);
    command
        .arg(dir.join("cli/index.mjs"))
        .arg("up")
        .arg("--port")
        .arg("4319")
        .arg("--every")
        .arg("15")
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(stdout.unwrap_or_else(Stdio::null))
        .stderr(stderr.unwrap_or_else(Stdio::null));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command.spawn().map_err(|error| error.to_string())
}

fn health_label() -> &'static str {
    let address = SocketAddr::from(([127, 0, 0, 1], 4319));
    let mut stream = match TcpStream::connect_timeout(&address, Duration::from_millis(400)) {
        Ok(stream) => stream,
        Err(_) => return "未解锁",
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    if stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return "未解锁";
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return "未解锁";
    }
    if !response.starts_with("HTTP/1.1 200") && !response.starts_with("HTTP/1.0 200") {
        return "未解锁";
    }
    if response.contains("\"stale\":true") {
        "本地副本已过期"
    } else {
        "已解锁"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn broker_home_wins_over_the_user_profile() {
        let path = device_file_with(Some("C:/broker".into()), Some("C:/users/me".into()));
        assert_eq!(path, Some(PathBuf::from("C:/broker").join("device.json")));
    }

    #[test]
    fn the_default_record_lives_under_the_user_profile() {
        let path = device_file_with(None, Some("C:/users/me".into()));
        assert_eq!(
            path,
            Some(PathBuf::from("C:/users/me").join(".secrets-broker").join("device.json"))
        );
    }
}
