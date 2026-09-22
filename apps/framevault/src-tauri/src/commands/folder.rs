//! 场景（文件夹）命令。
//!
//! 命令层是"适配器"：把前端传来的 JSON 参数翻译成领域层的调用，
//! 再把领域对象翻译成前端好用的形状。这里唯一的规则是——不写业务规则，
//! 规则都在 `crate::vault` 里。

use super::active_vault;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::vault::{
    self, delete_folder as delete_folder_meta, is_known_scene, list_folders, new_id, next_order,
    read_folder, write_folder, FolderMeta, SceneInfo,
};
use serde::Serialize;
use tauri::State;

/// 前端要的形状。字段名用 camelCase（`rename_all` 自动转），
/// 所以 TS 侧写 `node.effectiveScene` 而不是 `effective_scene`。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderNode {
    pub id: String,
    pub name: String,
    pub order: i64,
    pub pinned: bool,
    /// 用户绑定的主题（可能为空 = 没绑定）
    pub scene: Option<String>,
    /// 实际生效的主题（没绑定就是 builtin.plain）
    pub effective_scene: String,
    pub scene_config: serde_json::Value,
}

impl From<FolderMeta> for FolderNode {
    fn from(f: FolderMeta) -> Self {
        Self {
            effective_scene: f.effective_scene(),
            scene_config: f.scene_config.clone(),
            id: f.id,
            name: f.name,
            order: f.order,
            pinned: f.pinned,
            scene: f.scene,
        }
    }
}

fn to_nodes(vault_dir: &std::path::Path) -> AppResult<Vec<FolderNode>> {
    Ok(list_folders(vault_dir)?.into_iter().map(FolderNode::from).collect())
}

/// 场景列表（已排序：置顶 → order → 名称）。
/// **前端按 `effectiveScene` 分组显示**，这就是"归类"的全部来源。
#[tauri::command]
pub fn list_folder_tree(state: State<'_, AppState>) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(&state)?;
    to_nodes(&vault_dir)
}

/// 新建场景：起名 + 选主题，一步到位。
#[tauri::command]
pub fn create_folder(
    state: State<'_, AppState>,
    name: String,
    scene: Option<String>,
) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(&state)?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid("场景名称不能为空".into()));
    }
    if let Some(id) = scene.as_deref() {
        if !is_known_scene(id) {
            return Err(AppError::Invalid(format!("未知主题：{id}")));
        }
    }

    let all = list_folders(&vault_dir)?;
    let order = next_order(&all);
    let folder = FolderMeta::new(&new_id(), &name, order, scene);
    write_folder(&vault_dir, &folder)?;
    to_nodes(&vault_dir)
}

#[tauri::command]
pub fn rename_folder(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(&state)?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid("场景名称不能为空".into()));
    }

    let mut folder = read_folder(&vault_dir, &id)?;
    folder.name = name;
    write_folder(&vault_dir, &folder)?;
    to_nodes(&vault_dir)
}

/// 给场景换主题（`None` = 退回内置普通记录）
#[tauri::command]
pub fn bind_folder_scene(
    state: State<'_, AppState>,
    id: String,
    scene: Option<String>,
    scene_config: Option<serde_json::Value>,
) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(&state)?;
    if let Some(sid) = scene.as_deref() {
        if !is_known_scene(sid) {
            return Err(AppError::Invalid(format!("未知主题：{sid}")));
        }
    }

    let mut folder = read_folder(&vault_dir, &id)?;
    folder.scene = scene.filter(|s| !s.trim().is_empty());
    if let Some(config) = scene_config {
        folder.scene_config = config;
    }
    write_folder(&vault_dir, &folder)?;
    to_nodes(&vault_dir)
}

#[tauri::command]
pub fn set_folder_pinned(
    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(&state)?;
    let mut folder = read_folder(&vault_dir, &id)?;
    folder.pinned = pinned;
    write_folder(&vault_dir, &folder)?;
    to_nodes(&vault_dir)
}

/// 按前端给的顺序重排（写回 `order`）。
/// 只认仓库里真实存在的 id，顺序外的场景保持原位。
#[tauri::command]
pub fn reorder_folders(
    state: State<'_, AppState>,
    ordered_ids: Vec<String>,
) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(&state)?;
    let all = list_folders(&vault_dir)?;

    for (index, id) in ordered_ids.iter().enumerate() {
        if let Some(folder) = all.iter().find(|f| &f.id == id) {
            let mut updated = folder.clone();
            updated.order = index as i64;
            write_folder(&vault_dir, &updated)?;
        }
    }
    to_nodes(&vault_dir)
}

/// 删除场景。**里面还有记录时会拒绝**——宁可让用户先处理，
/// 也不要出现"场景没了、记录变成孤儿"的情况。
#[tauri::command]
pub fn delete_folder(state: State<'_, AppState>, id: String) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(&state)?;
    let folder = read_folder(&vault_dir, &id)?;

    // 只数"活着"的记录：墓碑不算还有东西（它们只等恢复或清理）
    let count = vault::list_entries(&vault_dir)?
        .iter()
        .filter(|e| !e.is_deleted() && e.folder_id.as_deref() == Some(id.as_str()))
        .count();
    if count > 0 {
        return Err(AppError::Invalid(format!(
            "「{}」里还有 {count} 条记录，请先删除或移走它们",
            folder.name
        )));
    }

    delete_folder_meta(&vault_dir, &id)?;
    to_nodes(&vault_dir)
}

/// 已安装的主题列表（现在只有内置的普通记录）
#[tauri::command]
pub fn list_scenes() -> Vec<SceneInfo> {
    vault::builtin_scenes()
}
