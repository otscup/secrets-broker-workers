use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::MenuItem;
use tauri::{AppHandle, Manager, Wry};

pub struct SidecarState {
    child: Mutex<Option<Child>>,
}

impl SidecarState {
    pub fn start(app: AppHandle, status_item: MenuItem<Wry>) -> Self {
        let child = match spawn(&app) {
            Ok(child) => Some(child),
            Err(error) => {
                eprintln!("sidecar not started: {error}");
                None
            }
        };
        let state = Self { child: Mutex::new(child) };
        let app_handle = app.clone();
        std::thread::spawn(move || loop {
            let label = health_label();
            let _ = status_item.set_text(format!("状态：{label}"));
            if let Some(tray) = app_handle.tray_by_id("main") {
                let _ = tray.set_tooltip(Some(format!("Secrets Broker · {label}")));
            }
            std::thread::sleep(Duration::from_secs(3));
        });
        state
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn sidecar_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/sidecar")];
    if let Ok(resource) = app.path().resource_dir() {
        candidates.push(resource.join("resources/sidecar"));
        candidates.push(resource.join("sidecar"));
    }
    candidates.into_iter().find(|dir| dir.join("node.exe").is_file())
}

fn spawn(app: &AppHandle) -> Result<Child, String> {
    let dir = sidecar_dir(app).ok_or("sidecar resources missing; run npm run desktop:sidecar")?;
    let mut command = Command::new(dir.join("node.exe"));
    command
        .arg(dir.join("cli/index.mjs"))
        .arg("up")
        .arg("--port")
        .arg("4319")
        .arg("--every")
        .arg("15")
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
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
