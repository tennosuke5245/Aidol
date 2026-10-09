#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};

struct CoreProcess(Mutex<Option<CommandChild>>);

#[tauri::command]
fn open_codex(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "聊天交接連結格式不正確。".to_string())?;
    if parsed.scheme() != "codex" || parsed.host_str() != Some("new") || url.len() > 16000 {
        return Err("只允許開啟新的 Codex 聊天。".to_string());
    }
    #[allow(deprecated)]
    app.shell().open(url, None).map_err(|_| "無法開啟 Codex App，請確認已安裝。".to_string())
}

fn stop_core(app: &tauri::AppHandle) {
    if let Some(child) = app.state::<CoreProcess>().0.lock().unwrap().take() {
        let _ = child.kill();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![open_codex])
        .manage(CoreProcess(Mutex::new(None)))
        .setup(|app| {
            let resources = app.path().resource_dir()?.join("resources");
            let runtime = app.path().app_data_dir()?.join("runtime");
            std::fs::create_dir_all(&runtime)?;
            let command = app.shell().sidecar("aidol-core")?
                .env("AIDOL_PORT", "0")
                .env("AIDOL_DATA_DIR", runtime.to_string_lossy().to_string())
                .env("AIDOL_STATIC_DIR", resources.join("client").to_string_lossy().to_string())
                .env("AIDOL_PUBLIC_DIR", resources.join("public").to_string_lossy().to_string())
                .env("AIDOL_SKILL_SOURCE", resources.join("skill").to_string_lossy().to_string())
                .current_dir(&runtime);
            let (mut events, child) = command.spawn()?;
            *app.state::<CoreProcess>().0.lock().unwrap() = Some(child);
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut ready = false;
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(line) if !ready => {
                            let line = String::from_utf8_lossy(&line);
                            if let Some(payload) = line.trim().strip_prefix("AIDOL_READY ") {
                                if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
                                    if let Some(port) = value["port"].as_u64() {
                                        if (1..=65535).contains(&port) {
                                            let url = url::Url::parse(&format!("http://127.0.0.1:{port}")).unwrap();
                                            let builder = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))
                                                .title("AIDOL · 角色設計工作室")
                                                .inner_size(1480.0, 940.0)
                                                .min_inner_size(1000.0, 700.0)
                                                .on_navigation(|url| url.scheme() == "http" && url.host_str() == Some("127.0.0.1"));
                                            if builder.build().is_ok() { ready = true; }
                                        }
                                    }
                                }
                            }
                        }
                        CommandEvent::Terminated(_) => {
                            if let Some(window) = handle.get_webview_window("main") {
                                let _ = window.set_title("AIDOL · 本機服務已結束，請重新開啟工作台");
                            } else { handle.exit(1); }
                            break;
                        }
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) { stop_core(window.app_handle()); }
        })
        .build(tauri::generate_context!())
        .expect("AIDOL 桌面工作台啟動失敗")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) { stop_core(app); }
        });
}
