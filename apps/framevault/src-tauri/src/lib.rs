mod commands;
mod error;
mod state;
pub mod vault;

use state::AppState;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // app_data_dir 需要 AppHandle，所以 AppState 在这里注册
            let config = app.path().app_data_dir()?.join("vaults.json");
            let state = AppState::new(config);
            state.load()?;
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
            // 场景（= 文件夹 + 主题）
            commands::folder::list_folders,
            commands::folder::create_folder,
            commands::folder::rename_folder,
            commands::folder::move_folder,
            commands::folder::reorder_folders,
            commands::folder::set_folder_pinned,
            commands::folder::bind_folder_scene,
            commands::folder::list_scenes,
            // 记录
            commands::entry::save_entry,
            commands::entry::load_entry,
            commands::entry::list_entries,
            commands::entry::read_vault_meta,
            // 窗口
            commands::window::open_vault_manager,
            commands::window::close_vault_manager,
            commands::window::open_settings,
            commands::window::close_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
