use crate::state::AppState;
use crate::vault::{self, Entry};
use std::path::PathBuf;
use tauri::Manager;
use tauri::State;

/// 所有命令共用的取路径逻辑
fn active_vault(state: &AppState) -> Result<PathBuf, String> {
    let guard = state.vaults.lock().map_err(|e| e.to_string())?;
    guard
        .active
        .clone()
        .ok_or_else(|| "还没有选择仓库".to_string())
}

#[derive(serde::Serialize)]
pub struct VaultInfo {
    pub path: String,
    pub name: String,
    pub active: bool,
    pub exists: bool,
}

/// 列表逻辑抽出来，add / forget 复用
fn vault_list(app: &AppState) -> Result<Vec<VaultInfo>, String> {
    let guard = app.vaults.lock().map_err(|e| e.to_string())?;

    Ok(guard
        .known
        .iter()
        .map(|p| VaultInfo {
            path: p.display().to_string(),
            name: p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            active: guard.active.as_deref() == Some(p.as_path()),
            exists: p.is_dir(),
        })
        .collect())
}

#[tauri::command]
pub fn list_vaults(state: State<'_, AppState>) -> Result<Vec<VaultInfo>, String> {
    vault_list(state.inner())
}

#[tauri::command]
pub fn add_vault(state: State<'_, AppState>, path: String) -> Result<Vec<VaultInfo>, String> {
    let app = state.inner();
    {
        let mut guard = app.vaults.lock().map_err(|e| e.to_string())?;
        let p = PathBuf::from(&path);
        if !p.is_dir() {
            return Err(format!("不是有效目录: {path}"));
        }
        if !guard.known.iter().any(|k| k == &p) {
            guard.known.push(p.clone());
        }
        guard.active = Some(p);
    }
    app.save().map_err(|e| e.to_string())?;
    vault_list(app)
}

#[tauri::command]
pub fn switch_vault(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let app = state.inner();
    {
        let mut guard = app.vaults.lock().map_err(|e| e.to_string())?;
        guard.active = Some(PathBuf::from(&path));
    }
    app.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn forget_vault(state: State<'_, AppState>, path: String) -> Result<Vec<VaultInfo>, String> {
    let app = state.inner();
    {
        let mut guard = app.vaults.lock().map_err(|e| e.to_string())?;
        let p = PathBuf::from(&path);
        guard.known.retain(|k| k != &p);
        if guard.active.as_ref() == Some(&p) {
            guard.active = guard.known.first().cloned();
        }
    }
    app.save().map_err(|e| e.to_string())?;
    vault_list(app)
}

#[tauri::command]
pub fn save_entry(
    state: State<'_, AppState>,
    id: String,
    title: String,
    created_at: String,
) -> Result<String, String> {
    let vault_dir = active_vault(state.inner())?;
    println!("[rust] save_entry: {id} -> {}", vault_dir.display());

    let entry = Entry::new(&id, &title, &created_at);
    let path = vault::write_entry(&vault_dir, &entry).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn load_entry(state: State<'_, AppState>, id: String) -> Result<Entry, String> {
    let vault_dir = active_vault(state.inner())?;
    vault::read_entry(&vault_dir, &id).map_err(|e| e.to_string())
}

// ── 多窗口 ──
// 注意 #[tauri::command(async)]：官方文档说没有 async 关键字的命令在**主线程**执行，
// 在主线程里建窗口会把消息循环搞坏（窗口建出来但关不掉）。
// 加上 async 后，函数体会在单独的线程上跑。

#[tauri::command(async)]
pub fn open_vault_manager(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("vault-manager") {
        w.set_focus().map_err(|e| e.to_string())?;
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
    .decorations(true)
    .closable(true)
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command(async)]
pub fn close_vault_manager(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("vault-manager") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
