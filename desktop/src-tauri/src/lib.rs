mod approvals;
mod deep_link;
mod local_agents;
mod server;
mod sidecar;

use sidecar::SidecarState;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        #[cfg(windows)]
        force_show(&window);
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(windows)]
fn force_show(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW,
    };
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_SHOWWINDOW,
            );
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            server::connect_server,
            server::get_server,
            local_agents::connect_local_agents
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            app.deep_link()
                .on_open_url(move |event| deep_link::handle(&handle, &event.urls()));
            #[cfg(desktop)]
            let _ = app.deep_link().register_all();
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                deep_link::handle(app.handle(), &urls);
            }

            // Create the window manually so its WebView2 data dir exists first.
            let data = app.path().app_local_data_dir()?.join("webview");
            std::fs::create_dir_all(&data)?;
            let cfg = app.config().app.windows[0].clone();
            tauri::WebviewWindowBuilder::from_config(app, &cfg)?
                .data_directory(data)
                .on_page_load(|window, payload| {
                    if payload.event() == tauri::webview::PageLoadEvent::Finished {
                        let _ = window.eval(include_str!("unlock.js"));
                    }
                })
                .build()?;
            let setup_url = server::setup_url()?;
            app.manage(server::NavState {
                setup_url: setup_url.clone(),
            });

            let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let status = MenuItem::with_id(app, "status", "状态：未连接", false, None::<&str>)?;
            let settings = MenuItem::with_id(app, "server", "服务器设置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出并停止本地服务", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(
                app,
                &[&show, &status, &settings, &separator, &quit],
            )?;

            let mut tray = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "server" => {
                        show_main(app);
                        server::show_setup(app);
                    }
                    "quit" => {
                        if let Some(state) = app.try_state::<SidecarState>() {
                            state.stop();
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;

            app.manage(SidecarState::start(app.handle().clone(), status));
            approvals::start(app.handle().clone());
            server::restore(app.handle(), setup_url);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Closing the window keeps the local daemon alive in the tray.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<SidecarState>() {
                    state.stop();
                }
            }
        });
}
