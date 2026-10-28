fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "connect_server",
                "get_server",
                "connect_local_agents",
                "check_update",
                "open_update_page",
            ]),
        ),
    )
    .unwrap()
}
