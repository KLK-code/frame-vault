use crate::error::AppResult;
use tauri::Manager; // 提供 get_webview_window

// 注意 #[tauri::command(async)]：**没有 async 关键字的命令跑在主线程**，
// 在主线程里建窗口会把消息循环搞坏（窗口建出来但关不掉）——踩过这个坑。

#[tauri::command(async)]
pub fn open_vault_manager(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("vault-manager") {
        w.set_focus()?;
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        "vault-manager",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("管理仓库")
    .inner_size(760.0, 540.0)
    .resizable(true)
    .decorations(false) // 自绘标题栏
    .closable(true)
    .center()
    .build()?;

    Ok(())
}

#[tauri::command(async)]
pub fn close_vault_manager(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("vault-manager") {
        w.close()?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn open_settings(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("settings") {
        w.set_focus()?;
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("设置")
    .inner_size(720.0, 560.0)
    .resizable(true)
    .decorations(false)
    .closable(true)
    .center()
    .build()?;

    Ok(())
}

#[tauri::command(async)]
pub fn close_settings(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("settings") {
        w.close()?;
    }
    Ok(())
}
