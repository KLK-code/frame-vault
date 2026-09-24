mod commands;
mod error;
mod saf;
mod state;
mod vaultfs;
pub mod vault;

use state::AppState;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // 安卓：把 Kotlin 那边的 SAF 桥挂上（用户选的目录只有 `content://` 树 URI）。
    // **只有安卓有** —— SAF 是安卓概念，桌面上没有这个插件，也没有这条代码路径。
    // 句柄存进托管状态：命令层只要手里有 AppHandle，就能把仓库引用变成根句柄。
    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("saf")
            .setup(|app, api| {
                let handle = api.register_android_plugin("com.framevault.app", "SafBridgePlugin")?;
                app.manage(crate::saf::SafBridge::new(handle));
                Ok(())
            })
            .build(),
    );

    builder
        // `vaultfs://`：WebView 显示**仓库里**的媒体（安卓上必须走它 —— SAF 没有文件系统路径）。
        // 读字节可能很重（视频几百兆），所以丢到后台线程，绝不占主线程。
        .register_asynchronous_uri_scheme_protocol("vaultfs", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            std::thread::spawn(move || {
                let (status, mime, body) = crate::vaultfs::read_or_message(&app, &path);
                let response = tauri::http::Response::builder()
                    .status(status)
                    .header("Content-Type", mime)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(body)
                    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()));
                responder.respond(response);
            });
        })
        .setup(|app| {
            // app_data_dir 需要 AppHandle，所以 AppState 在这里注册
            let config = app.path().app_data_dir()?.join("vaults.json");
            let state = AppState::new(config);
            state.load()?;

            // 启动时就把当前 Vault 放行给 asset 协议（WebView 要靠它显示本地照片；
            // SAF 仓库放行的是缩略图缓存，原图走 vaultfs://）。
            let active = state
                .vaults
                .lock()
                .ok()
                .and_then(|guard| guard.active.clone());
            if let Some(reference) = active {
                if let Ok(vault) = commands::vault_for_ref(app.handle(), &reference) {
                    commands::allow_vault_assets(app.handle(), &vault);
                }
            }

            app.manage(state);
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关掉主窗口就让整个程序退出。
            // 否则管理窗口还开着，按 Tauri「最后一个窗口关闭才退出」的规则，进程会一直留着。
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::CloseRequested { .. })
            {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            // 仓库
            commands::vault::list_vaults,
            commands::vault::add_vault,
            commands::vault::create_vault,
            commands::vault::switch_vault,
            commands::vault::forget_vault,
            commands::vault::vault_exists,
            commands::vault::pick_saf_tree,
            // 场景（= 文件夹 + 主题）
            commands::folder::list_folder_tree,
            commands::folder::create_folder,
            commands::folder::rename_folder,
            commands::folder::delete_folder,
            commands::folder::reorder_folders,
            commands::folder::set_folder_pinned,
            commands::folder::bind_folder_scene,
            commands::folder::list_scenes,
            commands::folder::list_topics,
            commands::folder::create_topic,
            commands::folder::rename_topic,
            commands::folder::delete_topic,
            // 记录
            commands::entry::new_id,
            commands::entry::save_entry,
            commands::entry::update_entry,
            commands::entry::delete_entry,
            commands::entry::restore_entry,
            commands::entry::load_entry,
            commands::entry::list_entries,
        commands::entry::reorder_entries,
            commands::entry::read_vault_meta,
            // 媒体
            commands::media::import_media,
            commands::media::list_media,
            // 窗口
            commands::window::open_vault_manager,
            commands::window::close_vault_manager,
            commands::window::open_settings,
            commands::window::close_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
