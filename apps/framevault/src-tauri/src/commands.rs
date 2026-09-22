use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::vault::{self, Entry};
use std::path::PathBuf;
use tauri::{Manager, State};

/// 所有命令共用的取路径逻辑
fn active_vault(state: &AppState) -> AppResult<PathBuf> {
    let guard = state.vaults.lock()?;
    guard.active.clone().ok_or(AppError::NotSelected)
}

#[derive(serde::Serialize)]
pub struct VaultInfo {
    pub path: String,
    pub name: String,
    pub active: bool,
    pub exists: bool,
}

/// 列表逻辑抽出来，add / forget / create 复用
fn vault_list(app: &AppState) -> AppResult<Vec<VaultInfo>> {
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
pub fn add_vault(state: State<'_, AppState>, path: String) -> AppResult<Vec<VaultInfo>> {
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
        guard.active = Some(dir);
    }
    app.save()?;

    vault_list(app)
}

/// 在指定目录里创建一个新 Vault（可以"收养"已经有 entries/ 的目录）
#[tauri::command]
pub fn create_vault(
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
        guard.active = Some(dir);
    }
    app.save()?;

    vault_list(app)
}

#[tauri::command]
pub fn switch_vault(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let app = state.inner();
    {
        let mut guard = app.vaults.lock()?;
        guard.active = Some(PathBuf::from(&path));
    }
    app.save()?;
    Ok(())
}

#[tauri::command]
pub fn forget_vault(state: State<'_, AppState>, path: String) -> AppResult<Vec<VaultInfo>> {
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
    vault_list(app)
}

#[tauri::command]
pub fn save_entry(
    state: State<'_, AppState>,
    id: String,
    title: String,
    created_at: String,
) -> AppResult<String> {
    let vault_dir = active_vault(state.inner())?;
    println!("[rust] save_entry: {id} -> {}", vault_dir.display());

    let entry = Entry::new(&id, &title, &created_at);
    let path = vault::write_entry(&vault_dir, &entry)?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn load_entry(state: State<'_, AppState>, id: String) -> AppResult<Entry> {
    let vault_dir = active_vault(state.inner())?;
    Ok(vault::read_entry(&vault_dir, &id)?)
}

/// 列出当前仓库里的所有记录（时间线用）
#[tauri::command]
pub fn list_entries(state: State<'_, AppState>) -> AppResult<Vec<Entry>> {
    let vault_dir = active_vault(state.inner())?;
    Ok(vault::list_entries(&vault_dir)?)
}

/// 读当前仓库的身份信息（vault.json）
#[tauri::command]
pub fn read_vault_meta(state: State<'_, AppState>) -> AppResult<vault::VaultMeta> {
    let vault_dir = active_vault(state.inner())?;
    Ok(vault::read_vault_meta(&vault_dir)?)
}

// ── 窗口 ──
// 注意 #[tauri::command(async)]：没有 async 关键字的命令在主线程执行，
// 在主线程里建窗口会把消息循环搞坏（窗口建出来但关不掉）。

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
