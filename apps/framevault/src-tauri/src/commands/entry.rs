//! 记录命令。
//!
//! 记录是**扁平**存放的：`entries/<id>/entry.json`，
//! 归属靠 `folderId` 字段。仓库层面不嵌套，展示层才分组。

use super::active_vault;
use crate::error::AppResult;
use crate::state::AppState;
use crate::vault::{self, list_entries as read_entries, read_folder, write_entry, Entry};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMetaInfo {
    pub schema_version: u32,
    pub vault_id: String,
    pub name: String,
    pub created_at: String,
}

/// 新建记录时要的 id，由 Rust 统一发放（UUID v7：按时间单调递增，天然适合排序）
#[tauri::command]
pub fn new_id() -> String {
    vault::new_id()
}

/// 保存一条记录。
///
/// 主题由**它所属的场景**决定：记录自己不带主题。
/// 没指定 folderId 就是"未归类"，用内置普通记录渲染。
#[tauri::command]
pub fn save_entry(
    state: State<'_, AppState>,
    id: String,
    title: String,
    created_at: Option<String>,
    updated_at: Option<String>,
    folder_id: Option<String>,
) -> AppResult<Entry> {
    let vault_dir = active_vault(&state)?;

    let scene = match folder_id.as_deref() {
        Some(fid) => read_folder(&vault_dir, fid)?.effective_scene(),
        None => vault::PLAIN_SCENE.to_string(),
    };

    let created = created_at.unwrap_or_default();
    let mut entry = match vault::read_entry(&vault_dir, &id) {
        Ok(existing) => existing,
        Err(_) => Entry::new(&id, &title, &created),
    };
    entry.title = title;
    if entry.created_at.is_empty() {
        entry.created_at = created.clone();
    }
    entry.folder_id = folder_id;
    entry.scene = Some(scene);
    entry.touch(updated_at.as_deref().unwrap_or(&created));

    write_entry(&vault_dir, &entry)?;
    Ok(entry)
}

/// 编辑一条已有的记录：只给到的部分会被改，归属与创建时间不动。
///
/// `fields` 是**整体替换**（不是深合并）：主题自己负责把旧值一起传上来。
#[tauri::command]
pub fn update_entry(
    state: State<'_, AppState>,
    id: String,
    title: Option<String>,
    fields: Option<serde_json::Value>,
    updated_at: Option<String>,
) -> AppResult<Entry> {
    let vault_dir = active_vault(&state)?;

    let mut entry = vault::read_entry(&vault_dir, &id)?;
    entry.apply_update(
        title.as_deref(),
        fields,
        updated_at.as_deref().unwrap_or(""),
    );
    write_entry(&vault_dir, &entry)?;
    Ok(entry)
}

#[tauri::command]
pub fn load_entry(state: State<'_, AppState>, id: String) -> AppResult<Entry> {
    let vault_dir = active_vault(&state)?;
    vault::read_entry(&vault_dir, &id)
}

/// 列出记录。`folder_id` 给 `None` = 全部；给字符串 = 只列这个场景里的。
#[tauri::command]
pub fn list_entries(
    state: State<'_, AppState>,
    folder_id: Option<String>,
) -> AppResult<Vec<Entry>> {
    let vault_dir = active_vault(&state)?;
    let all = read_entries(&vault_dir)?;
    Ok(match folder_id.as_deref() {
        Some(fid) => all
            .into_iter()
            .filter(|e| e.folder_id.as_deref() == Some(fid))
            .collect(),
        None => all,
    })
}

#[tauri::command]
pub fn read_vault_meta(state: State<'_, AppState>) -> AppResult<VaultMetaInfo> {
    let vault_dir = active_vault(&state)?;
    let meta = vault::read_vault_meta(&vault_dir)?;
    Ok(VaultMetaInfo {
        schema_version: meta.schema_version,
        vault_id: meta.vault_id,
        name: meta.name,
        created_at: meta.created_at,
    })
}
