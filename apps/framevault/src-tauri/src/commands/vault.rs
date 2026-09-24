use super::{allow_vault_assets, vault_for_ref};
use crate::error::{AppError, AppResult};
use crate::saf;
use crate::state::{AppState, VaultRef};
use crate::vault;
use tauri::Emitter;
use tauri::State;

#[derive(serde::Serialize)]
pub struct VaultInfo {
    /// 这个仓库的**标识**：桌面是路径，安卓是 SAF 的 `content://` 树 URI。
    /// 前端把它原样传回来（切换 / 移除），不做任何字符串手术。
    pub path: String,
    pub name: String,
    pub active: bool,
    pub exists: bool,
}

/// SAF 仓库的显示名：**问系统要**（`DISPLAY_NAME` 才是权威 —— URI 里是百分号编码，
/// 中文和空格都不是人看的样子）。问不到就退回 URI 末段，总比空着强。
fn saf_display_name(app: &tauri::AppHandle, uri: &str) -> String {
    let from_system = saf::tree_name(app, uri).unwrap_or_default();
    if !from_system.trim().is_empty() {
        return from_system;
    }
    uri.rsplit('/')
        .next()
        .and_then(|tail| tail.rsplit(':').next())
        .filter(|segment| !segment.is_empty())
        .unwrap_or("仓库")
        .to_string()
}

/// 列表逻辑抽出来，add / create / forget 复用
pub(crate) fn vault_list(state: &AppState, app: &tauri::AppHandle) -> AppResult<Vec<VaultInfo>> {
    let guard = state.vaults.lock()?;

    Ok(guard
        .known
        .iter()
        .map(|reference| {
            let (name, exists) = match reference {
                VaultRef::Fs(dir) => (
                    dir.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    // "还在不在"用 store 问（同一套判据，别在命令层自己拼路径）
                    vault_for_ref(app, reference)
                        .map(|v| v.is_dir(v.root()))
                        .unwrap_or(false),
                ),
                // SAF：名字与存在性都要问系统（ContentResolver）。
                // `exists` 的含义是"里面还有 vault.json" —— 用户删了目录、撤销了授权，都算不存在。
                VaultRef::Saf(uri) => (
                    saf_display_name(app, uri),
                    saf::has_vault_file(app, uri).unwrap_or(false),
                ),
            };
            VaultInfo {
                path: reference.display(),
                name,
                active: guard.active.as_ref() == Some(reference),
                exists,
            }
        })
        .collect())
}

#[tauri::command(async)]
pub fn list_vaults(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Vec<VaultInfo>> {
    vault_list(state.inner(), &app)
}

/// 弹系统的目录选择器（**安卓专用**）：返回选中的目录 + 持久授权。
/// 用户取消返回 `null`（取消是正常操作，不是错误）。
#[tauri::command(async)]
pub fn pick_saf_tree(app: tauri::AppHandle) -> AppResult<Option<saf::PickedTree>> {
    saf::pick_tree(&app)
}

/// 导入一个**已经存在**的 Vault 目录：必须有 vault.json
#[tauri::command(async)]
pub fn add_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<Vec<VaultInfo>> {
    let app_handle = app;
    let state = state.inner();
    let reference = VaultRef::from_input(&path);

    // 两端**同一条判据**：里面有 vault.json 才算仓库（跨端一致性硬线 ——
    // 桌面打的包传到手机、在 SAF 里选中，走的必须是这条判断）。
    let handle = vault_for_ref(&app_handle, &reference)?;
    if !handle.is_file(&handle.join("vault.json")) {
        return Err(AppError::Invalid(format!(
            "{} 里没有 vault.json，不能当作仓库。\n如果想把它变成仓库，请用「新建仓库…」。",
            reference.display()
        )));
    }

    {
        let mut guard = state.vaults.lock()?;
        if !guard.known.contains(&reference) {
            guard.known.push(reference.clone());
        }
        guard.active = Some(reference.clone());
    }
    state.save()?;

    if let Ok(vault) = vault_for_ref(&app_handle, &reference) {
        allow_vault_assets(&app_handle, &vault);
    }
    let _ = app_handle.emit("vault://changed", ());
    vault_list(state, &app_handle)
}

/// 在指定目录里创建一个新 Vault（会预建「未归类」容器与回收站目录）
#[tauri::command(async)]
pub fn create_vault(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
    name: String,
    created_at: String,
) -> AppResult<Vec<VaultInfo>> {
    let state = state.inner();
    let reference = VaultRef::from_input(&path);
    let handle = vault_for_ref(&app_handle, &reference)?;

    // 名字留空就取目录自己的名字：路径解析属于 Rust 的活，前端不做字符串手术
    let display_name = if name.trim().is_empty() {
        match &reference {
            VaultRef::Fs(dir) => dir
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "新仓库".to_string()),
            // SAF：目录名照样问系统要
            VaultRef::Saf(uri) => saf_display_name(&app_handle, uri),
        }
    } else {
        name
    };

    let meta = vault::create_vault(&handle, &display_name, &created_at)?;
    println!(
        "[rust] create_vault: {} = {}",
        meta.name,
        reference.display()
    );

    {
        let mut guard = state.vaults.lock()?;
        if !guard.known.contains(&reference) {
            guard.known.push(reference.clone());
        }
        guard.active = Some(reference.clone());
    }
    state.save()?;

    if let Ok(vault) = vault_for_ref(&app_handle, &reference) {
        allow_vault_assets(&app_handle, &vault);
    }
    let _ = app_handle.emit("vault://changed", ());
    vault_list(state, &app_handle)
}

#[tauri::command(async)]
pub fn switch_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<()> {
    let app_state = state.inner();
    let reference = VaultRef::from_input(&path);
    {
        let mut guard = app_state.vaults.lock()?;
        guard.active = Some(reference.clone());
    }
    app_state.save()?;

    // 切仓库后必须放行新目录，否则界面里的照片全是碎图
    // （SAF 仓库放行的是它的缩略图缓存；原图走 vaultfs://）
    if let Ok(vault) = vault_for_ref(&app, &reference) {
        allow_vault_assets(&app, &vault);
    }
    let _ = app.emit("vault://changed", ());
    Ok(())
}

#[tauri::command(async)]
pub fn forget_vault(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<Vec<VaultInfo>> {
    let app = state.inner();
    let reference = VaultRef::from_input(&path);
    {
        let mut guard = app.vaults.lock()?;
        guard.known.retain(|k| k != &reference);
        if guard.active.as_ref() == Some(&reference) {
            guard.active = guard.known.first().cloned();
        }
    }
    app.save()?;
    let _ = app_handle.emit("vault://changed", ());
    vault_list(app, &app_handle)
}

#[tauri::command(async)]
pub fn vault_exists(app: tauri::AppHandle, path: String) -> bool {
    // 两端同一条判据：里面有没有 vault.json
    let reference = VaultRef::from_input(&path);
    match vault_for_ref(&app, &reference) {
        Ok(handle) => handle.is_file(&handle.join("vault.json")),
        Err(_) => false,
    }
}
