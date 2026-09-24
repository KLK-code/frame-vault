use super::allow_vault_assets;
use crate::error::{AppError, AppResult};
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

/// SAF 仓库的显示名：URI 末段（就是用户选的那个目录名）。
/// 不引依赖做百分号解码 —— 名字里常见的中文/空格在 URI 里是编码形态，
/// 等 S2 桥接好了直接从 ContentResolver 的 `DISPLAY_NAME` 拿真名（那才是权威）。
fn saf_display_name(uri: &str) -> String {
    uri.rsplit('/')
        .next()
        .and_then(|tail| tail.rsplit(':').next())
        .filter(|segment| !segment.is_empty())
        .unwrap_or("仓库")
        .to_string()
}

/// 列表逻辑抽出来，add / create / forget 复用
pub(crate) fn vault_list(app: &AppState) -> AppResult<Vec<VaultInfo>> {
    let guard = app.vaults.lock()?;

    Ok(guard
        .known
        .iter()
        .map(|reference| {
            let (name, exists) = match reference {
                VaultRef::Fs(dir) => (
                    dir.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    dir.is_dir(),
                ),
                // SAF 的存在性/名字要问系统（ContentResolver），等 S2 的桥接好了再查 ——
                // 在那之前 Saf 引用不会被生产出来（选目录的入口还没写）
                VaultRef::Saf(uri) => (saf_display_name(uri), false),
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
    let reference = VaultRef::from_input(&path);

    match &reference {
        VaultRef::Fs(dir) => {
            if !dir.is_dir() {
                return Err(AppError::Invalid(format!("不是有效目录：{path}")));
            }
            if !vault::is_vault(dir) {
                return Err(AppError::Invalid(format!(
                    "{} 不是 Vault 目录（缺少 vault.json）。\n如果想把它变成 Vault，请用「新建仓库…」。",
                    dir.display()
                )));
            }
        }
        // SAF：等桥接好了再校验（S2）；现在给出人话而不是静默失败
        VaultRef::Saf(_) => {
            return Err(AppError::Invalid(
                "安卓的外部目录还没接上（存储抽象还在做），暂时不能导入它".to_string(),
            ))
        }
    }

    {
        let mut guard = app.vaults.lock()?;
        if !guard.known.contains(&reference) {
            guard.known.push(reference.clone());
        }
        guard.active = Some(reference.clone());
    }
    app.save()?;

    if let Some(dir) = reference.as_path() {
        allow_vault_assets(&app_handle, dir);
    }
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
    let reference = VaultRef::from_input(&path);
    let dir = match &reference {
        VaultRef::Fs(dir) => dir.clone(),
        VaultRef::Saf(_) => {
            return Err(AppError::Invalid(
                "安卓的外部目录还没接上（存储抽象还在做），暂时不能在那儿建仓库".to_string(),
            ))
        }
    };

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
        if !guard.known.contains(&reference) {
            guard.known.push(reference.clone());
        }
        guard.active = Some(reference.clone());
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
    let reference = VaultRef::from_input(&path);
    {
        let mut guard = app_state.vaults.lock()?;
        guard.active = Some(reference.clone());
    }
    app_state.save()?;

    // 切仓库后必须放行新目录，否则界面里的照片全是碎图
    if let Some(dir) = reference.as_path() {
        allow_vault_assets(&app, dir);
    }
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
    vault_list(app)
}

#[tauri::command]
pub fn vault_exists(path: String) -> bool {
    match VaultRef::from_input(&path) {
        VaultRef::Fs(dir) => vault::is_vault(&dir),
        // SAF 的存在性要问 ContentResolver（S2）；在那之前一律当"不是"，
        // 免得把一个根本读不了的 URI 当成有效仓库
        VaultRef::Saf(_) => false,
    }
}
