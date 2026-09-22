//! 媒体命令。
//!
//! 领域层存的是"事实"（扩展名、哈希、尺寸、归属），
//! 这里额外把**绝对路径**算好交给前端——前端不该做路径拼接。

use super::{active_vault, allow_vault_assets, thumbs_dir};
use crate::error::AppResult;
use crate::state::AppState;
use crate::vault::{self, MediaMeta};
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, State};

/// 缩略图长边。512 够网格看，也够预览。
const THUMB_MAX: u32 = 512;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    #[serde(flatten)]
    meta: MediaMeta,
    /// 原图 / 视频的绝对路径（交给 `convertFileSrc` 变成 asset URL）
    original_path: String,
    /// 缩略图绝对路径；没有（视频 / 不支持解码 / 生成失败）就是 null
    thumb_path: Option<String>,
}

fn to_item(app: &AppHandle, vault_dir: &Path, meta: MediaMeta) -> MediaItem {
    let original_path = vault::original_path(vault_dir, &meta.id, &meta.ext)
        .display()
        .to_string();
    let thumb_path = thumbs_dir(app, vault_dir)
        .ok()
        .map(|dir| dir.join(format!("{}.jpg", meta.id)))
        .filter(|path| path.is_file())
        .map(|path| path.display().to_string());

    MediaItem {
        meta,
        original_path,
        thumb_path,
    }
}

/// 导入一个文件（复制进 Vault）。
///
/// - **异步命令**：复制 + 算哈希 + 解码都是重活，绝不能占主线程（PRD §10）；
/// - 缩略图失败不算导入失败 —— 它是缓存，顶多列表里回退显示原图。
#[tauri::command(async)]
pub fn import_media(
    app: AppHandle,
    state: State<'_, AppState>,
    source_path: String,
    entry_id: Option<String>,
    added_at: String,
) -> AppResult<MediaItem> {
    let vault_dir = active_vault(&state)?;
    let id = vault::new_id();

    let mut meta = vault::import_media(&vault_dir, &id, Path::new(&source_path), &added_at)?;

    if meta.is_image() {
        let original = vault::original_path(&vault_dir, &id, &meta.ext);
        if let Ok(dir) = thumbs_dir(&app, &vault_dir) {
            let dest = dir.join(format!("{id}.jpg"));
            if let Err(e) = vault::write_thumbnail(&original, &dest, THUMB_MAX) {
                eprintln!("[rust] 缩略图生成失败（{id}）：{e}");
            }
        }
    }

    // 归属是单独一步：媒体先落盘、再挂到记录上。
    // 这也是"把照片挪到另一条记录"要走的同一个动作（改一个字段，不搬文件）。
    meta.entry_id = entry_id;
    vault::write_media(&vault_dir, &meta)?;

    allow_vault_assets(&app, &vault_dir);
    println!(
        "[rust] import_media: {} ({} KB) → {}",
        meta.name,
        meta.bytes / 1024,
        meta.id
    );

    Ok(to_item(&app, &vault_dir, meta))
}

/// 列出媒体（新的在前）。给了 `entry_id` 就只看那条记录的。
#[tauri::command]
pub fn list_media(
    app: AppHandle,
    state: State<'_, AppState>,
    entry_id: Option<String>,
) -> AppResult<Vec<MediaItem>> {
    let vault_dir = active_vault(&state)?;
    allow_vault_assets(&app, &vault_dir);

    Ok(vault::list_media(&vault_dir, entry_id.as_deref())?
        .into_iter()
        .map(|meta| to_item(&app, &vault_dir, meta))
        .collect())
}
