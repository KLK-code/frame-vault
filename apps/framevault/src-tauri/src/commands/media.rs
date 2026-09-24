//! 媒体命令。
//!
//! 媒体**物理上住在记录目录里**（和那条记录的 `entry.json` / `note.md` 摆一起），
//! 文件名在导入那一刻按场景模板生成。领域层存的是事实（文件名、哈希、尺寸、拍摄时间），
//! 这里额外把**路径**算好交给前端——前端不该做路径拼接。
//!
//! "来源"在两端形态不同（桌面=路径、安卓=`content://`），这件事由 `MediaSource` +
//! `VaultStore` 消化掉，**这个文件里没有任何平台判断**。
//!
//! ⚠️ 还没做（S4）：安卓上的照片**显示**那条链。那边路径不是真文件系统路径，
//! WebView 加载不了 —— 要换成自定义协议 `vaultfs://`。在那之前安卓端照片是占位图。

use super::{active_vault, allow_vault_assets, thumbs_dir};
use crate::error::AppResult;
use crate::state::AppState;
use crate::vault::store::Vault;
use crate::vault::{self, MediaMeta, MediaSource, NameVars};
use serde::Serialize;
use tauri::{AppHandle, State};

/// 缩略图长边。512 够网格看，也够预览。
const THUMB_MAX: u32 = 512;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    #[serde(flatten)]
    meta: MediaMeta,
    /// 属于哪条记录。媒体住在记录里，所以这个字段现在**一定有值**
    entry_id: String,
    /// 原图 / 视频的**文件系统路径**（交给 `convertFileSrc` 变成 asset URL）。
    /// SAF 仓库上它是空的 —— 那边没有路径，S4 改用 `vaultfs://` URL。
    original_path: String,
    /// 缩略图绝对路径；没有（视频 / 不支持解码 / 生成失败）就是 null。
    /// 缩略图落在**应用数据目录**（真文件系统），所以两端都拿得到。
    thumb_path: Option<String>,
}

fn to_item(
    app: &AppHandle,
    vault: &Vault,
    entry_dir: &std::path::Path,
    entry_id: &str,
    meta: MediaMeta,
) -> MediaItem {
    let original_path = if vault.store().native_paths() {
        meta.path_in(entry_dir).display().to_string()
    } else {
        String::new()
    };
    let thumb_path = thumbs_dir(app, vault)
        .ok()
        .map(|dir| dir.join(format!("{}.jpg", meta.id)))
        .filter(|path| path.is_file())
        .map(|path| path.display().to_string());

    MediaItem {
        meta,
        entry_id: entry_id.to_string(),
        original_path,
        thumb_path,
    }
}

/// 导入一个文件（复制进**记录目录**）。
///
/// - `entry_id` **必填**：媒体物理上住在记录里，"无主媒体"不再可能存在；
/// - `source`：桌面是文件路径，安卓是系统选择器给的 `content://` 文档 URI
///   （**前端原样传回来**，不做字符串手术）；
/// - `name_template`：场景在 manifest 里声明的命名模板（纯数据），**由前端解析后传进来**——
///   第三方场景的模板写在它自己的插件包里，Rust 不该去读插件目录；
///   留空就走核心默认模板；
/// - **异步命令**：复制 + 算哈希 + 解码都是重活，绝不能占主线程（PRD §10）；
/// - 缩略图失败不算导入失败 —— 它是缓存，顶多列表里回退显示原图。
#[tauri::command(async)]
pub fn import_media(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
    entry_id: String,
    name_template: Option<String>,
    added_at: String,
) -> AppResult<MediaItem> {
    let vault = active_vault(&state, &app)?;
    let source = MediaSource::from_input(&source);

    let entry_dir = vault::find_entry_dir(&vault, &entry_id)?;
    let mut entry = vault::read_entry_from(&entry_dir)?;

    // 第一步：看一眼来源（名字 / 大小 / 拍摄时间；图片而且不大时把字节一起带上来）。
    // **来源只读一次** —— 命名模板要用拍摄时间，元数据要用字节。
    let plan = vault::plan_import(&vault, &source)?;

    // 模板变量全从这里取：日期（拍摄日优先，缺则导入日）、场景名、标题、字段、序号
    let scene_name = match entry.folder_id.as_deref() {
        Some(fid) => vault::read_folder(&vault, fid)?.name,
        None => String::new(), // 没有场景 → 场景级变量空掉，模板自动收掉多余分隔符
    };
    let vars = NameVars {
        date: vault::day_of(
            plan.taken_at
                .as_deref()
                .unwrap_or_else(|| added_at.as_str()),
        ),
        scene: scene_name,
        title: entry.title.clone(),
        fields: entry.fields.clone(),
        n: entry.media.len() + 1,
    };

    // 第二步：改名、复制进记录目录、记下事实
    let previous = entry.clone();
    let meta = vault::import_into_entry(
        &vault,
        &entry_dir,
        &source,
        &plan,
        name_template.as_deref(),
        &vars,
        &added_at,
    )?;

    // 缩略图直接用刚读上来的字节（安卓上再读一遍来源是没法接受的开销）
    if meta.is_image() {
        if let (Some(bytes), Ok(dir)) = (plan.inline.as_deref(), thumbs_dir(&app, &vault)) {
            let dest = dir.join(format!("{}.jpg", meta.id));
            if let Err(e) = vault::write_thumbnail(bytes, &dest, THUMB_MAX) {
                eprintln!("[rust] 缩略图生成失败（{}）：{e}", meta.id);
            }
        }
    }

    // 归属 = 它就在这条记录的目录里；元数据跟着记录一起落盘
    entry.media.push(meta.clone());
    vault::sort_media(&mut entry.media);
    vault::write_entry_in(&vault, &entry, &entry_dir, Some(&previous))?;

    if vault.store().native_paths() {
        allow_vault_assets(&app, vault.root());
    }
    println!(
        "[rust] import_media: {} → {}（{}）",
        source.display(),
        meta.file,
        entry.title
    );

    Ok(to_item(&app, &vault, &entry_dir, &entry_id, meta))
}

/// 列出媒体（新的在前）。给了 `entry_id` 就只看那条记录的。
///
/// 媒体元数据现在住在各条记录的 `entry.json` 里，所以这里是"把记录扫一遍再汇总"，
/// **不再有全局 `media/` 目录**，也不再有"导入了但没归属"的媒体。
#[tauri::command]
pub fn list_media(
    app: AppHandle,
    state: State<'_, AppState>,
    entry_id: Option<String>,
) -> AppResult<Vec<MediaItem>> {
    let vault = active_vault(&state, &app)?;
    if vault.store().native_paths() {
        allow_vault_assets(&app, vault.root());
    }

    let mut out = Vec::new();
    for entry in vault::list_entries(&vault)? {
        // 回收站里的记录不参与：它们已经"不在仓库里"了
        if entry.is_deleted() {
            continue;
        }
        if let Some(wanted) = entry_id.as_deref() {
            if wanted != entry.id {
                continue;
            }
        }

        let Ok(dir) = vault::find_entry_dir(&vault, &entry.id) else {
            continue;
        };
        for meta in entry.media {
            out.push(to_item(&app, &vault, &dir, &entry.id, meta));
        }
    }

    // 新的在前（没有导入时间的排最后——那是用户直接拷进来的）
    out.sort_by(|a, b| {
        b.meta
            .added_at
            .cmp(&a.meta.added_at)
            .then_with(|| a.meta.file.cmp(&b.meta.file))
    });
    Ok(out)
}
