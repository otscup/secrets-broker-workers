use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use url::Url;

pub struct NavState {
    pub setup_url: Url,
}

pub fn setup_url() -> Result<Url, String> {
    // window.url() is not readable during setup; the embedded app origin is fixed.
    let base = if cfg!(windows) { "http://tauri.localhost/" } else { "tauri://localhost/" };
    Url::parse(base)
        .map_err(|error| error.to_string())?
        .join("setup.html")
        .map_err(|error| error.to_string())
}

pub fn restore(app: &AppHandle, setup: Url) {
    if let Some(saved) = read_saved(app) {
        if navigate(app, &(saved + "/login")).is_ok() {
            return;
        }
    }
    let _ = navigate_url(app, setup);
}

pub fn show_setup(app: &AppHandle) {
    if let Some(state) = app.try_state::<NavState>() {
        let _ = navigate_url(app, state.setup_url.clone());
    }
}

#[tauri::command]
pub fn get_server(app: AppHandle) -> Option<String> {
    read_saved(&app)
}

#[tauri::command]
pub fn connect_server(app: AppHandle, url: String) -> Result<String, String> {
    let normalized = normalize(&url)?;
    save(&app, &normalized)?;
    navigate(&app, &(normalized.clone() + "/login"))?;
    Ok(normalized)
}

fn normalize(raw: &str) -> Result<String, String> {
    let text = raw.trim();
    if text.is_empty() {
        return Err("请输入服务器地址".into());
    }
    let mut url = Url::parse(text).map_err(|_| "地址格式不对，例如 https://sb.otscup.com".to_string())?;
    let local = matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("只接受 https 地址；本机调试可以用 http://127.0.0.1".into());
    }
    if url.path() != "/" && !url.path().is_empty() {
        return Err("只填服务器根地址，不要带路径".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("地址里不要带用户名或密码".into());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("地址不要带查询参数".into());
    }
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("server.json"))
}

fn read_saved(app: &AppHandle) -> Option<String> {
    let text = fs::read_to_string(config_path(app).ok()?).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    normalize(value.get("url")?.as_str()?).ok()
}

fn save(app: &AppHandle, url: &str) -> Result<(), String> {
    let path = config_path(app)?;
    let body = serde_json::json!({ "url": url });
    fs::write(path, serde_json::to_vec_pretty(&body).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

fn navigate(app: &AppHandle, target: &str) -> Result<(), String> {
    navigate_url(app, Url::parse(target).map_err(|error| error.to_string())?)
}

fn navigate_url(app: &AppHandle, target: Url) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window is not open".to_string())?;
    window.navigate(target).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_https_origin_is_accepted() {
        assert_eq!(normalize(" https://sb.example/ ").unwrap(), "https://sb.example");
    }

    #[test]
    fn loopback_http_is_allowed_for_local_development() {
        assert_eq!(normalize("http://127.0.0.1:8787").unwrap(), "http://127.0.0.1:8787");
    }

    #[test]
    fn a_remote_http_origin_is_refused() {
        assert!(normalize("http://sb.example").is_err());
    }

    #[test]
    fn a_path_is_refused() {
        assert!(normalize("https://sb.example/pair").is_err());
    }

    #[test]
    fn the_setup_page_is_local() {
        let url = setup_url().unwrap();
        assert!(url.as_str().ends_with("/setup.html"));
    }
}
