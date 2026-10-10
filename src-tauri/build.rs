fn main() {
    // 視窗載入的是本機核心的 http://127.0.0.1:<port>，對 Tauri 來說是遠端網址：
    // 自訂指令必須在 ACL 明確允許（capabilities/default.json 的 allow-open-codex），否則網頁呼叫不到。
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["open_codex"])),
    )
    .expect("failed to run tauri-build");
}
