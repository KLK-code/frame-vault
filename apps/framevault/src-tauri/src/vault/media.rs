//! 媒体（照片 / 视频）领域。
//!
//! 布局（和记录一样**扁平**）：
//!
//! ```text
//! <vault>/media/<media-id>/
//! ├── orig.jpg     原始文件本体，导入后**不可变**（PRD FV-SYN-003）
//! └── meta.json    元数据：原始文件名、尺寸、哈希、挂在哪条记录上
//! ```
//!
//! 三条刻意的设计：
//! 1. **磁盘名用 `orig.<ext>`，不用用户的原文件名**——导入路径与存储分离（PRD §6.1），
//!    避开中文 / 空格 / 重名 / 大小写各种麻烦；原名只留在 meta 里做展示。
//! 2. **换归属 = 改 meta 里的 `entry_id`**，不移动几 GB 的文件，同步工具也只看一个文件变。
//! 3. **缩略图不进 Vault**——它是可重建缓存（PRD §9），放本机数据目录；这里只提供生成函数，
//!    存哪由命令层决定（领域层不认识应用数据目录）。

use super::model::SCHEMA_VERSION;
use super::storage::{read_json, write_json_atomic};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

pub fn media_dir(vault: &Path) -> PathBuf {
    vault.join("media")
}

pub fn media_item_dir(vault: &Path, id: &str) -> PathBuf {
    media_dir(vault).join(id)
}

pub fn media_meta_path(vault: &Path, id: &str) -> PathBuf {
    media_item_dir(vault, id).join("meta.json")
}

/// 原始文件在磁盘上的名字（与导入路径无关）
pub fn original_file_name(ext: &str) -> String {
    if ext.is_empty() {
        "orig".to_string()
    } else {
        format!("orig.{ext}")
    }
}

pub fn original_path(vault: &Path, id: &str, ext: &str) -> PathBuf {
    media_item_dir(vault, id).join(original_file_name(ext))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaMeta {
    pub schema_version: u32,
    pub id: String,
    /// 用户原本的文件名，只用于展示
    #[serde(default)]
    pub name: String,
    /// 小写扩展名（jpg / png / mp4 …），磁盘上的 `orig.<ext>` 就是它
    #[serde(default)]
    pub ext: String,
    #[serde(default)]
    pub mime: String,
    #[serde(default)]
    pub bytes: u64,
    /// 图片才有；视频先不探测（要 ffmpeg，留到 P1/P2）
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    /// EXIF 的拍摄时间（"YYYY-MM-DDTHH:MM:SS"，**本地时间、不带时区**）。
    /// 读不到就是 None —— 打卡墙、日历都该退回 added_at，绝不能瞎猜。
    #[serde(default)]
    pub taken_at: Option<String>,
    /// sha256：将来去重与同步校验用（PRD FV-MED-005）
    #[serde(default)]
    pub hash: String,
    /// 挂在哪条记录上；None = 导入了但还没整理
    #[serde(default)]
    pub entry_id: Option<String>,
    /// 导入时间（由调用方给，Rust 不引时钟依赖）
    #[serde(default)]
    pub added_at: String,
}

impl MediaMeta {
    pub fn is_image(&self) -> bool {
        self.mime.starts_with("image/")
    }
}

/// 按扩展名猜 MIME。猜不出来就 application/octet-stream，不硬凑。
pub fn guess_mime(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" | "jpe" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "heic" | "heif" => "image/heic",
        "avif" => "image/avif",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "m4v" => "video/x-m4v",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        _ => "application/octet-stream",
    }
}

/// image 这个库能解出来的格式（heic / avif 不在其中 → 尺寸留空、不生成缩略图）
pub fn is_decodable_image(ext: &str) -> bool {
    matches!(
        ext,
        "jpg" | "jpeg" | "jpe" | "png" | "webp" | "gif" | "bmp" | "tif" | "tiff"
    )
}

pub fn normalize_ext(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// 流式算 sha256：大视频也不会把内存吃爆
pub fn sha256_file(path: &Path) -> AppResult<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];

    loop {
        let read = file.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }

    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// 只读文件头拿尺寸，不解码整张图
pub fn image_size(path: &Path) -> Option<(u32, u32)> {
    image::image_dimensions(path).ok()
}

/// 读 EXIF 拍摄时间。任何一步失败都返回 None —— 照片本身没问题，只是没这个信息。
pub fn exif_taken_at(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let mut reader = std::io::BufReader::new(file);
    let exif = exif::Reader::new().read_from_container(&mut reader).ok()?;

    let field = exif
        .get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)
        .or_else(|| exif.get_field(exif::Tag::DateTime, exif::In::PRIMARY))?;

    normalize_exif_datetime(&format!("{}", field.display_value()))
}

/// EXIF 的时间写法是 `2026:09:22 16:57:03`，转成 ISO 形状 `2026-09-22T16:57:03`。
/// 宽松一点：冒号或短横、空格或 T 分隔都认；认不出来就 None（不编造时间）。
pub fn normalize_exif_datetime(raw: &str) -> Option<String> {
    let text = raw.trim();
    let (date, time) = match text.split_once('T') {
        Some((d, t)) => (d, t),
        None => text.split_once(' ')?,
    };

    let date = date.trim().replace(':', "-");
    let mut parts = date.split('-');
    let (year, month, day) = (parts.next()?, parts.next()?, parts.next()?);
    if year.len() != 4 || month.is_empty() || day.is_empty() {
        return None;
    }

    let time = time.trim();
    if !time.contains(':') {
        return None;
    }

    Some(format!(
        "{year}-{:0>2}-{:0>2}T{time}",
        month.trim_start_matches('0'),
        day.trim_start_matches('0')
    ))
}

pub fn read_media(vault: &Path, id: &str) -> AppResult<MediaMeta> {
    read_json(&media_meta_path(vault, id))
}

pub fn write_media(vault: &Path, media: &MediaMeta) -> AppResult<PathBuf> {
    let path = media_meta_path(vault, &media.id);
    write_json_atomic(&path, media)?;
    Ok(path)
}

/// 导入一个文件：**复制**进 Vault（原文件不动），记下大小 / 哈希 / 尺寸。
///
/// 失败时清理掉半成品目录，不留"有目录没文件"的垃圾。
pub fn import_media(
    vault: &Path,
    id: &str,
    source: &Path,
    added_at: &str,
) -> AppResult<MediaMeta> {
    if !source.is_file() {
        return Err(AppError::Invalid(format!("不是文件：{}", source.display())));
    }

    let ext = normalize_ext(source);
    let dir = media_item_dir(vault, id);
    fs::create_dir_all(&dir)?;

    let result = (|| -> AppResult<MediaMeta> {
        let dest = original_path(vault, id, &ext);
        fs::copy(source, &dest)?;

        let bytes = fs::metadata(&dest)?.len();
        let hash = sha256_file(&dest)?;
        let size = if is_decodable_image(&ext) {
            image_size(&dest)
        } else {
            None
        };
        // 拍摄时间要单独读：EXIF 只在图片里有，而且经常压根没有
        let taken_at = if is_decodable_image(&ext) {
            exif_taken_at(&dest)
        } else {
            None
        };

        let meta = MediaMeta {
            schema_version: SCHEMA_VERSION,
            id: id.to_string(),
            name: source
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            mime: guess_mime(&ext).to_string(),
            ext,
            bytes,
            width: size.map(|(w, _)| w),
            height: size.map(|(_, h)| h),
            taken_at,
            hash,
            entry_id: None,
            added_at: added_at.to_string(),
        };

        write_media(vault, &meta)?;
        Ok(meta)
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&dir);
    }
    result
}

/// 生成缩略图到指定路径（**目标目录由调用方给**，领域层不认识应用数据目录）。
/// 长边不超过 `max`，输出 JPEG——先转 RGB，否则 JPEG 编码器会拒绝带 alpha 的 RGBA。
pub fn write_thumbnail(source: &Path, dest: &Path, max: u32) -> AppResult<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let thumb = image::open(source)
        .map_err(|e| AppError::Invalid(format!("解码失败：{e}")))?
        .thumbnail(max, max)
        .to_rgb8();
    thumb
        .save(dest)
        .map_err(|e| AppError::Invalid(format!("写缩略图失败：{e}")))?;
    Ok(())
}

/// 列出媒体（新的在前）。给了 `entry_id` 就只看那条记录的。
pub fn list_media(vault: &Path, entry_id: Option<&str>) -> AppResult<Vec<MediaMeta>> {
    let dir = media_dir(vault);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for item in fs::read_dir(&dir)? {
        let path = item?.path();
        if !path.is_dir() {
            continue;
        }
        let file = path.join("meta.json");
        if !file.is_file() {
            continue;
        }
        match read_json::<MediaMeta>(&file) {
            Ok(media) => {
                if entry_id.is_none() || media.entry_id.as_deref() == entry_id {
                    out.push(media);
                }
            }
            Err(err) => eprintln!("[vault] 跳过损坏的 media {}：{err}", file.display()),
        }
    }

    out.sort_by(|a, b| b.added_at.cmp(&a.added_at).then(a.id.cmp(&b.id)));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("framevault-media-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn import_copies_probes_and_hashes() {
        let vault = temp_vault("import");
        let source = vault.join("我的照片 01.png");
        image::RgbImage::new(4, 3).save(&source).unwrap();
        let source_bytes = fs::metadata(&source).unwrap().len();

        let meta = import_media(&vault, "m-1", &source, "2026-04-01T10:00:00Z").unwrap();

        assert_eq!(meta.name, "我的照片 01.png");
        assert_eq!(meta.ext, "png");
        assert_eq!(meta.mime, "image/png");
        assert_eq!(meta.bytes, source_bytes);
        assert_eq!((meta.width, meta.height), (Some(4), Some(3)));
        assert_eq!(meta.hash.len(), 64, "sha256 的十六进制是 64 个字符");
        assert!(meta.entry_id.is_none());
        assert!(meta.is_image());

        // 磁盘名与导入路径分离，原文件还在
        assert!(original_path(&vault, "m-1", "png").is_file());
        assert!(source.is_file(), "导入是复制，不动原文件");
        assert_eq!(read_media(&vault, "m-1").unwrap().hash, meta.hash);
    }

    #[test]
    fn same_content_has_same_hash_and_list_sorts_newest_first() {
        let vault = temp_vault("hash");
        let source = vault.join("a.png");
        image::RgbImage::new(2, 2).save(&source).unwrap();

        let first = import_media(&vault, "m-1", &source, "2026-04-01T10:00:00Z").unwrap();
        let second = import_media(&vault, "m-2", &source, "2026-04-02T10:00:00Z").unwrap();
        assert_eq!(
            first.hash, second.hash,
            "同样内容必须同样哈希，将来靠它去重"
        );

        let list = list_media(&vault, None).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "m-2", "新的在前");
    }

    #[test]
    fn list_filters_by_entry() {
        let vault = temp_vault("filter");
        let source = vault.join("a.png");
        image::RgbImage::new(2, 2).save(&source).unwrap();

        import_media(&vault, "m-1", &source, "2026-04-01T10:00:00Z").unwrap();
        let mut attached = import_media(&vault, "m-2", &source, "2026-04-01T11:00:00Z").unwrap();
        attached.entry_id = Some("e-1".into());
        write_media(&vault, &attached).unwrap();

        assert_eq!(list_media(&vault, Some("e-1")).unwrap().len(), 1);
        assert_eq!(list_media(&vault, Some("e-9")).unwrap().len(), 0);
        assert_eq!(list_media(&vault, None).unwrap().len(), 2);
    }

    #[test]
    fn thumbnail_is_written_and_never_larger_than_max() {
        let vault = temp_vault("thumb");
        let source = vault.join("big.png");
        image::RgbImage::new(800, 400).save(&source).unwrap();

        let dest = vault.join("cache").join("m-1.jpg");
        write_thumbnail(&source, &dest, 200).unwrap();

        let (w, h) = image::image_dimensions(&dest).unwrap();
        assert_eq!((w, h), (200, 100), "等比缩放");

        // 认不出的格式不该 panic，只返回错误
        let weird = vault.join("x.heic");
        fs::write(&weird, b"not really a heic").unwrap();
        assert!(write_thumbnail(&weird, &vault.join("cache").join("x.jpg"), 64).is_err());
    }

    #[test]
    fn exif_datetime_is_normalized() {
        assert_eq!(
            normalize_exif_datetime("2026:09:22 16:57:03").as_deref(),
            Some("2026-09-22T16:57:03")
        );
        assert_eq!(
            normalize_exif_datetime("2026-09-22 16:57:03").as_deref(),
            Some("2026-09-22T16:57:03"),
            "exif 库自己格式化过的也认"
        );
        assert_eq!(
            normalize_exif_datetime("2026:09:22T08:05:00").as_deref(),
            Some("2026-09-22T08:05:00")
        );
        assert_eq!(
            normalize_exif_datetime("2026:1:2 3:04:05").as_deref(),
            Some("2026-01-02T3:04:05"),
            "月日补零；时间按原样（EXIF 一直是 HH:MM:SS）"
        );

        // 认不出来就 None：宁可不显示，也不要编一个时间
        assert!(normalize_exif_datetime("").is_none());
        assert!(normalize_exif_datetime("2026:09:22").is_none());
        assert!(normalize_exif_datetime("not a date").is_none());
        assert!(normalize_exif_datetime("2026:09:22").is_none(), "只有日期没有时间");
    }

    #[test]
    fn png_without_exif_has_no_taken_at() {
        let vault = temp_vault("noexif");
        let source = vault.join("a.png");
        image::RgbImage::new(2, 2).save(&source).unwrap();

        let meta = import_media(&vault, "m-1", &source, "2026-04-01T10:00:00Z").unwrap();
        assert!(
            meta.taken_at.is_none(),
            "没有 EXIF 就必须留空，让上层退回 added_at"
        );
    }

    #[test]
    fn video_is_stored_without_probing_size() {
        let vault = temp_vault("video");
        let source = vault.join("clip.MP4");
        fs::write(&source, vec![0u8; 1024]).unwrap();

        let meta = import_media(&vault, "m-1", &source, "2026-04-01T10:00:00Z").unwrap();
        assert_eq!(meta.ext, "mp4", "扩展名统一小写");
        assert_eq!(meta.mime, "video/mp4");
        assert_eq!((meta.width, meta.height), (None, None));
        assert!(!meta.is_image());
    }

    #[test]
    fn failed_import_leaves_no_half_built_dir() {
        let vault = temp_vault("missing");
        let result = import_media(&vault, "m-x", &vault.join("nope.png"), "now");
        assert!(result.is_err());
        assert!(!media_item_dir(&vault, "m-x").exists());
    }
}
