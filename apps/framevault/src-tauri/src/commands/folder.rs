use super::active_vault;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::vault::{self, FolderMeta, SceneInfo};
use std::path::Path;
use tauri::State;

/// 传给前端的场景节点。`effectiveScene` 是**继承解析之后**真正生效的场景。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderNode {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub order: i64,
    pub pinned: bool,
    /// 自己绑定的（None = 继承父级）
    pub scene: Option<String>,
    /// 继承解析后真正生效的
    pub effective_scene: String,
}

fn to_nodes(vault_dir: &Path) -> AppResult<Vec<FolderNode>> {
    let all = vault::list_folders(vault_dir)?;

    Ok(all
        .iter()
        .map(|f| FolderNode {
            id: f.id.clone(),
            name: f.name.clone(),
            parent_id: f.parent_id.clone(),
            order: f.order,
            pinned: f.pinned,
            scene: f.scene.clone(),
            effective_scene: vault::effective_scene(&all, Some(f.id.as_str())),
        })
        .collect())
}

fn find<'a>(all: &'a [FolderMeta], id: &str) -> AppResult<&'a FolderMeta> {
    all.iter()
        .find(|f| f.id == id)
        .ok_or_else(|| AppError::NotFound(format!("文件夹不存在：{id}")))
}

#[tauri::command]
pub fn list_folders(state: State<'_, AppState>) -> AppResult<Vec<FolderNode>> {
    to_nodes(&active_vault(state.inner())?)
}

#[tauri::command]
pub fn create_folder(
    state: State<'_, AppState>,
    name: String,
    parent_id: Option<String>,
) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(state.inner())?;

    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid("文件夹名不能为空".into()));
    }

    let all = vault::list_folders(&vault_dir)?;
    if let Some(parent) = parent_id.as_deref() {
        find(&all, parent)?; // 父级必须存在
    }

    let order = vault::next_order(&all, parent_id.as_deref());
    let folder = FolderMeta::new(&vault::new_id(), &name, parent_id, order);
    vault::write_folder(&vault_dir, &folder)?;

    to_nodes(&vault_dir)
}

#[tauri::command]
pub fn rename_folder(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(state.inner())?;

    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid("文件夹名不能为空".into()));
    }

    let all = vault::list_folders(&vault_dir)?;
    let mut folder = find(&all, &id)?.clone();
    folder.name = name;
    vault::write_folder(&vault_dir, &folder)?;

    to_nodes(&vault_dir)
}

#[tauri::command]
pub fn move_folder(
    state: State<'_, AppState>,
    id: String,
    new_parent_id: Option<String>,
) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(state.inner())?;
    let all = vault::list_folders(&vault_dir)?;

    find(&all, &id)?;
    if let Some(parent) = new_parent_id.as_deref() {
        find(&all, parent)?;
    }
    if vault::creates_cycle(&all, &id, new_parent_id.as_deref()) {
        return Err(AppError::Invalid("不能把文件夹移进它自己的子文件夹".into()));
    }

    let mut folder = find(&all, &id)?.clone();
    folder.parent_id = new_parent_id.clone();
    folder.order = vault::next_order(&all, new_parent_id.as_deref());
    vault::write_folder(&vault_dir, &folder)?;

    to_nodes(&vault_dir)
}

/// 拖动排序落盘：把 ordered_ids 里的文件夹按数组下标写入 order
#[tauri::command]
pub fn reorder_folders(
    state: State<'_, AppState>,
    parent_id: Option<String>,
    ordered_ids: Vec<String>,
) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(state.inner())?;
    let all = vault::list_folders(&vault_dir)?;

    for (index, id) in ordered_ids.iter().enumerate() {
        let Some(folder) = all.iter().find(|f| &f.id == id) else {
            return Err(AppError::NotFound(format!("文件夹不存在：{id}")));
        };
        // 只动同一层的，避免误改别的分支
        if folder.parent_id != parent_id {
            continue;
        }

        let mut updated = folder.clone();
        updated.order = index as i64;
        vault::write_folder(&vault_dir, &updated)?;
    }

    to_nodes(&vault_dir)
}

#[tauri::command]
pub fn set_folder_pinned(
    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(state.inner())?;
    let all = vault::list_folders(&vault_dir)?;

    let mut folder = find(&all, &id)?.clone();
    folder.pinned = pinned;
    vault::write_folder(&vault_dir, &folder)?;

    to_nodes(&vault_dir)
}

/// 给文件夹绑定场景。scene = None / 空字符串 表示"清除绑定，回到继承"。
#[tauri::command]
pub fn bind_folder_scene(
    state: State<'_, AppState>,
    id: String,
    scene: Option<String>,
    scene_config: Option<serde_json::Value>,
) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(state.inner())?;
    let all = vault::list_folders(&vault_dir)?;

    let scene = scene.filter(|s| !s.trim().is_empty());
    if let Some(s) = scene.as_deref() {
        if !vault::is_known_scene(s) {
            return Err(AppError::Invalid(format!("未知的场景：{s}")));
        }
    }

    let mut folder = find(&all, &id)?.clone();
    folder.scene = scene;
    if let Some(config) = scene_config {
        folder.scene_config = config;
    }
    vault::write_folder(&vault_dir, &folder)?;

    to_nodes(&vault_dir)
}

/// 当前可用的场景清单（现在只有内置的普通记录）
#[tauri::command]
pub fn list_scenes() -> Vec<SceneInfo> {
    vault::builtin_scenes()
}
