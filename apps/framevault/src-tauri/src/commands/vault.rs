use super::allow_vault_assets;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::vault;
use std::path::PathBuf;
use tauri::Emitter;
use tauri::State;

#[derive(serde::Serialize)]
pub struct VaultInfo {
    pub path: String,
    pub name: String,
    pub active: bool,
    pub exists: bool,
}

/// 列表逻辑抽出来，add / create / forget 复用
pub(crate) fn vault_list(app: &AppState) -> AppResult<Vec<VaultInfo>> {
    let guard = app.vaults.lock()?;

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
pub fn list_vaults(state: State<'_, AppState>) -> AppResult<Vec<VaultInfo>> {
    vault_list(state.inner())
}

/// 导入一个**已经存在**的 Vault 目录：必须有 vault.json
#[tauri::command]
pub fn add_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<Vec<VaultInfo>> {
    let app_handle = app;
    let app = state.inner();
    let dir = PathBuf::from(&path);

    if !dir.is_dir() {
        return Err(AppError::Invalid(format!("不是有效目录：{path}")));
    }
    if !vault::is_vault(&dir) {
        return Err(AppError::Invalid(format!(
            "{} 不是 Vault 目录（缺少 vault.json）。\n如果想把它变成 Vault，请用「新建仓库…」。",
            dir.display()
        )));
    }

    {
        let mut guard = app.vaults.lock()?;
        if !guard.known.iter().any(|k| k == &dir) {
            guard.known.push(dir.clone());
        }
        guard.active = Some(dir.clone());
    }
    app.save()?;

    allow_vault_assets(&app_handle, &dir);
    let _ = app_handle.emit("vault://changed", ());
    vault_list(app)
}

/// 在指定目录里创建一个新 Vault（会预建「未归类」容器与回收站目录）
#[tauri::command]
pub fn create_vault(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
    name: String,
    created_at: String,
) -> AppResult<Vec<VaultInfo>> {
    let app = state.inner();
    let dir = PathBuf::from(&path);

    // 名字留空就取目录名：路径解析属于 Rust 的活，前端不做字符串手术
    let display_name = if name.trim().is_empty() {
        dir.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "新仓库".to_string())
    } else {
        name
    };

    let meta = vault::create_vault(&dir, &display_name, &created_at)?;
    println!("[rust] create_vault: {} = {}", meta.name, dir.display());

    {
        let mut guard = app.vaults.lock()?;
        if !guard.known.iter().any(|k| k == &dir) {
            guard.known.push(dir.clone());
        }
        guard.active = Some(dir.clone());
    }
    app.save()?;

    allow_vault_assets(&app_handle, &dir);
    let _ = app_handle.emit("vault://changed", ());
    vault_list(app)
}

#[tauri::command]
pub fn switch_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<()> {
    let app_state = state.inner();
    let dir = PathBuf::from(&path);
    {
        let mut guard = app_state.vaults.lock()?;
        guard.active = Some(dir.clone());
    }
    app_state.save()?;

    // 切仓库后必须放行新目录，否则界面里的照片全是碎图
    allow_vault_assets(&app, &dir);
    let _ = app.emit("vault://changed", ());
    Ok(())
}

#[tauri::command]
pub fn forget_vault(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<Vec<VaultInfo>> {
    let app = state.inner();
    {
        let mut guard = app.vaults.lock()?;
        let p = PathBuf::from(&path);
        guard.known.retain(|k| k != &p);
        if guard.active.as_ref() == Some(&p) {
            guard.active = guard.known.first().cloned();
        }
    }
    app.save()?;
    let _ = app_handle.emit("vault://changed", ());
    vault_list(app)
}

#[tauri::command]
pub fn vault_exists(path: String) -> bool {
    vault::is_vault(&PathBuf::from(path))
}
