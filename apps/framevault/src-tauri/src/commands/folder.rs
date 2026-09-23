//! 文件夹与**主题**命令。
//!
//! - **文件夹**：带 `folder.json` 的目录，名字就是目录名（改名会连目录一起改，
//!   除非用户自己手动改过 —— 那就永久不再自动改）；
//! - **主题**：不带 `folder.json` 的一级目录（用户自己分的组）。**它不存字段**，
//!   就是磁盘上的位置 —— 所以命令只有"建 / 改名 / 删"三个。
//!
//! 命令层是"适配器"：把前端传来的 JSON 参数翻译成领域层的调用，
//! 再把领域对象翻译成前端好用的形状。这里唯一的规则是——不写业务规则，
//! 规则都在 `crate::vault` 里。

use super::active_vault;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::vault::{
    self, create_folder_in, create_topic as vault_create_topic, delete_folder as delete_folder_meta,
    delete_topic as vault_delete_topic, find_folder_dir, is_known_scene, list_folders, new_id,
    next_order, read_folder, rename_topic as vault_rename_topic, save_folder, topic_dir, FolderMeta,
    SceneInfo,
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
    /// 用户绑定的场景（记录方式）；null = 没绑定，用内置「随心记」
    pub scene: Option<String>,
    /// 实际生效的场景 id（没绑定就是内置随心记）
    pub effective_scene: String,
    pub scene_config: serde_json::Value,
    /// 所属**主题**（外层目录名）；null = 直接摆在仓库根下，没有主题。
    /// 派生数据（磁盘位置 → 这里的名字），不进 `folder.json`
    pub topic: Option<String>,
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
            topic: f.topic,
        }
    }
}

fn to_nodes(vault_dir: &std::path::Path) -> AppResult<Vec<FolderNode>> {
    Ok(list_folders(vault_dir)?.into_iter().map(FolderNode::from).collect())
}

/// 文件夹列表（已排序：置顶 → order → 名称）。每项都带着它所在的**主题**。
#[tauri::command]
pub fn list_folder_tree(state: State<'_, AppState>) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(&state)?;
    to_nodes(&vault_dir)
}

/// 新建文件夹：起名 + 选场景 + 选放哪个主题下，一步到位。
///
/// `topic`：`Some("科研")` = 建在那个主题目录里；`None` = 直接建在仓库根下（**没有主题**）。
/// 主题不存在会报错（前端应当先 `create_topic_cmd`）—— 不悄悄替用户建目录。
#[tauri::command]
pub fn create_folder(
    state: State<'_, AppState>,
    name: String,
    scene: Option<String>,
    topic: Option<String>,
) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(&state)?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid("名称不能为空".into()));
    }
    if let Some(id) = scene.as_deref() {
        if !is_known_scene(id) {
            return Err(AppError::Invalid(format!("未知场景：{id}")));
        }
    }

    let parent = match topic.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        Some(topic_name) => topic_dir(&vault_dir, topic_name)
            .ok_or_else(|| AppError::NotFound(format!("主题不存在：{topic_name}")))?,
        None => vault_dir.clone(),
    };

    let all = list_folders(&vault_dir)?;
    let order = next_order(&all);
    let folder = FolderMeta::new(&new_id(), &name, order, scene);
    create_folder_in(&folder, &parent)?;
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
        return Err(AppError::Invalid("名称不能为空".into()));
    }

    let dir = find_folder_dir(&vault_dir, &id)?;
    let mut folder = read_folder(&vault_dir, &id)?;
    let previous_name = folder.name.clone();
    folder.set_name(&name);
    save_folder(&folder, &dir, &previous_name)?;
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

    let dir = find_folder_dir(&vault_dir, &id)?;
    let mut folder = read_folder(&vault_dir, &id)?;
    folder.scene = scene.filter(|s| !s.trim().is_empty());
    if let Some(config) = scene_config {
        folder.scene_config = config;
    }
    // 名字没变：给同一个名字，就不会触发改名
    save_folder(&folder, &dir, &folder.name)?;
    to_nodes(&vault_dir)
}

#[tauri::command]
pub fn set_folder_pinned(
    state: State<'_, AppState>,
    id: String,
    pinned: bool,
) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(&state)?;
    let dir = find_folder_dir(&vault_dir, &id)?;
    let mut folder = read_folder(&vault_dir, &id)?;
    folder.pinned = pinned;
    save_folder(&folder, &dir, &folder.name)?;
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
            let dir = find_folder_dir(&vault_dir, id)?;
            let mut updated = folder.clone();
            updated.order = index as i64;
            save_folder(&updated, &dir, &updated.name)?;
        }
    }
    to_nodes(&vault_dir)
}

/// 删除场景。**里面还有记录时会拒绝**——宁可让用户先处理，
/// 也不要出现"场景没了、记录变成孤儿"的情况。
#[tauri::command]
pub fn delete_folder(state: State<'_, AppState>, id: String) -> AppResult<Vec<FolderNode>> {
    let vault_dir = active_vault(&state)?;
    // "非空拒绝"是业务规则，在领域层；这里只转发（返回全量列表）
    delete_folder_meta(&vault_dir, &id)?;
    to_nodes(&vault_dir)
}

/// 可用的**场景**（记录方式）清单：随心记 / 认真写作 / 拍照打卡…
/// 场景是代码（决定界面与录入怎么特化），所以清单来自内置注册表。
#[tauri::command]
pub fn list_scenes() -> Vec<SceneInfo> {
    vault::builtin_scenes()
}

/// **主题**清单：根下那些不带 `folder.json` 的一级目录（用户自己分的组）。
/// 空主题（里面还没放文件夹）也要列出来，否则用户建完看不见它。
#[tauri::command]
pub fn list_topics(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let vault_dir = active_vault(&state)?;
    Ok(vault::topic_dirs(&vault_dir)
        .into_iter()
        .filter_map(|dir| dir.file_name().map(|n| n.to_string_lossy().to_string()))
        .collect())
}

/// 新建主题 = 建一个目录（**不写任何文件**：主题没有字段，位置就是它自己）
#[tauri::command]
pub fn create_topic(state: State<'_, AppState>, name: String) -> AppResult<Vec<String>> {
    let vault_dir = active_vault(&state)?;
    vault_create_topic(&vault_dir, &name)?;
    list_topics(state)
}

/// 主题改名 = 改目录名（里面的文件夹跟着换主题，因为它们的位置变了）
#[tauri::command]
pub fn rename_topic(
    state: State<'_, AppState>,
    name: String,
    new_name: String,
) -> AppResult<Vec<String>> {
    let vault_dir = active_vault(&state)?;
    vault_rename_topic(&vault_dir, &name, &new_name)?;
    list_topics(state)
}

/// 删除主题：**里面还有东西就拒绝**（跟删文件夹同一条规矩）
#[tauri::command]
pub fn delete_topic(state: State<'_, AppState>, name: String) -> AppResult<Vec<String>> {
    let vault_dir = active_vault(&state)?;
    vault_delete_topic(&vault_dir, &name)?;
    list_topics(state)
}
