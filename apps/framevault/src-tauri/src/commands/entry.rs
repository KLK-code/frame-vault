//! 记录命令。
//!
//! 记录住在场景目录（或「未归类」容器）下：`<场景目录>/<创建日 标题>/`，
//! 里面是 `entry.json`（元数据）+ `note.md`（正文）+ 媒体文件。
//! **归属 = 物理位置**，所以列出与定位都要扫盘（`vault::storage` 负责）。

use super::active_vault;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::vault::{self, Entry, PLAIN_SCENE};
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

/// 交给前端的记录形状。
///
/// `Entry` 自己**不带正文**（正文住在 `note.md`，写盘时也不该进 JSON），
/// 所以这里把读出来的正文另起一个字段带上 —— 前端拿到的是完整的一条记录。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryView {
    #[serde(flatten)]
    entry: Entry,
    note: String,
}

impl From<Entry> for EntryView {
    fn from(entry: Entry) -> Self {
        Self {
            note: entry.note.clone(),
            entry,
        }
    }
}

/// 新建记录时要的 id，由 Rust 统一发放（UUID v7：按时间单调递增，天然适合排序）
#[tauri::command]
pub fn new_id() -> String {
    vault::new_id()
}

/// 保存一条记录（新建或整体覆盖）。
///
/// 主题由**它所属的场景**决定：记录自己不带主题。
/// 没指定 `folderId` 就是"未归类"，落进根下那个没有 `folder.json` 的容器里。
///
/// - `day`：**创建日的本地日期**（`YYYY-MM-DD`），前端给。Rust 不带时钟，
///   没有它就算不出目录名；留空时退回从 `createdAt` 里取日期部分。
/// - `note`：正文。给了就写进 `note.md`，不给则保持原样（新建时为空）。
#[tauri::command]
pub fn save_entry(
    state: State<'_, AppState>,
    id: String,
    title: String,
    created_at: Option<String>,
    updated_at: Option<String>,
    folder_id: Option<String>,
    day: Option<String>,
    note: Option<String>,
) -> AppResult<EntryView> {
    let vault_dir = active_vault(&state)?;

    let scene = match folder_id.as_deref() {
        Some(fid) => vault::read_folder(&vault_dir, fid)?.effective_scene(),
        None => PLAIN_SCENE.to_string(),
    };

    let created = created_at.unwrap_or_default();
    let day = day.unwrap_or_default();

    let mut entry = match vault::read_entry(&vault_dir, &id) {
        Ok(existing) => existing,
        Err(_) => {
            let mut fresh = Entry::new(&id, &title, &created);
            if !day.trim().is_empty() {
                fresh.day = day.trim().to_string();
            }
            if let Some(note) = note.as_deref() {
                fresh.set_note(note);
            }
            fresh.folder_id = folder_id;
            fresh.scene = Some(scene);
            vault::create_entry(&vault_dir, &mut fresh)?;
            return Ok(fresh.into());
        }
    };

    let previous = entry.clone();
    entry.set_title(&title);
    if !day.trim().is_empty() {
        entry.day = day.trim().to_string();
    }
    if entry.created_at.is_empty() {
        entry.created_at = created.clone();
    }
    if let Some(note) = note.as_deref() {
        entry.set_note(note);
    }
    entry.folder_id = folder_id;
    entry.scene = Some(scene);
    entry.touch(updated_at.as_deref().unwrap_or(&created));

    let dir = vault::find_entry_dir(&vault_dir, &id)?;
    let mut dir = vault::write_entry(&entry, &dir, Some(&previous))?;

    // 归属变了（换了场景）→ 记录要跟着搬到那个场景目录下：归属就是物理位置
    if previous.folder_id != entry.folder_id {
        dir = vault::move_entry_to_slot(&vault_dir, &dir, entry.folder_id.as_deref())?;
    }
    let _ = dir;

    Ok(entry.into())
}

/// 编辑一条已有的记录：只给到的部分会被改，归属与创建时间不动。
///
/// `fields` 是**整体替换**（不是深合并）：主题自己负责把旧值一起传上来。
/// `note` 给了就写 `note.md`，没给就不动它。
#[tauri::command]
pub fn update_entry(
    state: State<'_, AppState>,
    id: String,
    title: Option<String>,
    fields: Option<serde_json::Value>,
    note: Option<String>,
    updated_at: Option<String>,
) -> AppResult<EntryView> {
    let vault_dir = active_vault(&state)?;

    let dir = vault::find_entry_dir(&vault_dir, &id)?;
    let mut entry = vault::read_entry_from(&dir)?;
    let previous = entry.clone();

    entry.apply_update(title.as_deref(), fields, updated_at.as_deref().unwrap_or(""));
    if let Some(note) = note.as_deref() {
        entry.set_note(note);
    }

    vault::write_entry(&entry, &dir, Some(&previous))?;
    Ok(entry.into())
}

/// 删除一条记录：**把整个记录目录挪进回收站**，同时写墓碑。
///
/// 撤销就是把目录挪回来（`restore_entry`）—— 内容、媒体、字段一个都不丢。
#[tauri::command(async)]
pub fn delete_entry(
    state: State<'_, AppState>,
    id: String,
    deleted_at: String,
) -> AppResult<EntryView> {
    if deleted_at.trim().is_empty() {
        return Err(AppError::Invalid("缺少删除时间".into()));
    }

    let vault_dir = active_vault(&state)?;
    vault::trash_entry(&vault_dir, &id, &deleted_at)?;
    let entry = vault::read_entry(&vault_dir, &id)?;
    println!("[rust] delete_entry: {} 挪进回收站", entry.title);
    Ok(entry.into())
}

/// 撤销删除：把目录挪回原场景（原场景没了就回「未归类」），清掉墓碑
#[tauri::command]
pub fn restore_entry(state: State<'_, AppState>, id: String, now: String) -> AppResult<EntryView> {
    let vault_dir = active_vault(&state)?;
    vault::restore_entry(&vault_dir, &id, &now)?;
    Ok(vault::read_entry(&vault_dir, &id)?.into())
}

#[tauri::command]
pub fn load_entry(state: State<'_, AppState>, id: String) -> AppResult<EntryView> {
    let vault_dir = active_vault(&state)?;
    Ok(vault::read_entry(&vault_dir, &id)?.into())
}

/// 列出记录。`folder_id` 给 `None` = 全部；给字符串 = 只列这个场景里的。
///
/// **墓碑默认不出现**（它们是"已删除"，躺在回收站里），要看得显式传 `include_deleted`。
#[tauri::command]
pub fn list_entries(
    state: State<'_, AppState>,
    folder_id: Option<String>,
    include_deleted: Option<bool>,
) -> AppResult<Vec<EntryView>> {
    let vault_dir = active_vault(&state)?;
    let keep_deleted = include_deleted.unwrap_or(false);

    Ok(vault::list_entries(&vault_dir)?
        .into_iter()
        .filter(|e| keep_deleted || !e.is_deleted())
        .filter(|e| match folder_id.as_deref() {
            Some(fid) => e.folder_id.as_deref() == Some(fid),
            None => true,
        })
        .map(EntryView::from)
        .collect())
}

/// 手动排序：前端把当前场景的记录 id 按**新顺序**整表发来。
/// 只认活着的记录；没发到的保持原样。返回该场景的全量记录（对齐「关系型改动返回全量」）。
#[tauri::command]
pub fn reorder_entries(
    state: State<'_, AppState>,
    ordered_ids: Vec<String>,
) -> AppResult<Vec<EntryView>> {
    let vault_dir = active_vault(&state)?;
    let entries = vault::reorder_entries(&vault_dir, &ordered_ids)?;

    // 返回哪一桶：第一条给定记录所属的场景（前端本来就只对一个场景排）
    let folder_id = ordered_ids
        .first()
        .and_then(|id| entries.iter().find(|e| &e.id == id))
        .and_then(|e| e.folder_id.clone());

    Ok(entries
        .into_iter()
        .filter(|e| !e.is_deleted() && e.folder_id == folder_id)
        .map(EntryView::from)
        .collect())
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
