//! 媒体（照片 / 视频）领域。
//!
//! 布局（v2「人可读层级」）：**媒体物理上住在记录目录里**，和那条记录的
//! `entry.json` / `note.md` 摆在一起：
//!
//! ```text
//! <场景目录>/<记录目录>/
//! ├── entry.json                       元数据（含 media[]，这张照片的事实就在里面）
//! ├── note.md                          正文
//! └── 2026-09-23_晨跑打卡_01.jpg        媒体本体：导入时按场景的模板命名
//! ```
//!
//! 三条刻意的设计：
//! 1. **文件名在导入那一刻定一次**，之后永不自动改 —— 用户手动改名天然被尊重（"系统不覆盖"）；
//!    真实文件名记在 `MediaMeta.file` 里，改名不影响任何索引（缩略图按媒体 id 存）。
//! 2. **归属 = 物理位置**：媒体住哪条记录的目录里就是哪条记录的，不再有 `entry_id` 字段，
//!    也不再有全局 `media/` 目录。
//! 3. **缩略图不进 Vault** —— 它是可重建缓存，放本机数据目录；这里只提供生成函数。

use super::id::new_id;
use super::model::SCHEMA_VERSION;
use super::naming::{self, NameVars};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// 认作"媒体"的扩展名（对账时用它区分"用户顺手放进来的照片"和"别的文件"）
const MEDIA_EXTS: &[&str] = &[
    "jpg", "jpeg", "jpe", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif", "avif", "mp4",
    "mov", "m4v", "webm", "avi", "mkv",
];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaMeta {
    pub schema_version: u32,
    pub id: String,
    /// **这个文件现在叫什么**：磁盘上的实际文件名（住在记录目录里，导入时按模板生成，
    /// 之后跟着改名走）。界面显示、路径拼接、排序都用它。
    #[serde(default)]
    pub file: String,
    /// 导入那一刻的原始文件名 —— **只作来历**（"这张原本叫什么"），
    /// 它不是文件现在的名字（导入时已经按模板改名了）。
    /// alias 是为了读得懂早期写成 `name` 的老文件。
    #[serde(default, alias = "name")]
    pub original_name: String,
    /// 小写扩展名（jpg / png / mp4 …）
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
    /// sha256：将来去重与同步校验用（PRD FV-MED-005）。
    /// 用户直接拷进来的文件（对账时收养的）算不出这个值，留空。
    #[serde(default)]
    pub hash: String,
    /// 导入时间（由调用方给，Rust 不引时钟依赖）
    #[serde(default)]
    pub added_at: String,
}

impl MediaMeta {
    pub fn is_image(&self) -> bool {
        self.mime.starts_with("image/")
    }

    /// 媒体本体在记录目录里的完整路径
    pub fn path_in(&self, entry_dir: &Path) -> PathBuf {
        entry_dir.join(&self.file)
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

/// 这个扩展名算不算媒体？（对账时用）
pub fn is_media_ext(ext: &str) -> bool {
    MEDIA_EXTS.contains(&ext)
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

/// 导入一个文件：**复制**进记录目录（原文件不动），**按模板改名**，记下大小 / 哈希 / 尺寸。
///
/// 名字这件事只有一套规矩：**`file` 是它现在的名字**（磁盘上那个），
/// 导入前的原名进 `original_name` 存个来历 —— 界面显示的、写进 JSON 的都是 `file`。
///
/// 失败时清掉已经拷进去的那半个文件，不留"有条目没文件"的垃圾。
pub fn import_into_entry(
    entry_dir: &Path,
    source: &Path,
    template: Option<&str>,
    vars: &NameVars,
    added_at: &str,
) -> AppResult<MediaMeta> {
    if !source.is_file() {
        return Err(AppError::Invalid(format!("不是文件：{}", source.display())));
    }
    if !entry_dir.is_dir() {
        return Err(AppError::NotFound(format!(
            "记录目录不存在：{}",
            entry_dir.display()
        )));
    }

    let ext = normalize_ext(source);
    let stem = naming::media_file_stem(template, vars);
    let file = naming::unique_child_name(entry_dir, &stem, Some(&ext));
    let dest = entry_dir.join(&file);

    let result = (|| -> AppResult<MediaMeta> {
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

        Ok(MediaMeta {
            schema_version: SCHEMA_VERSION,
            id: new_id(),
            // 磁盘上的真名（模板生成 + 撞名去重）—— 它才是"这个文件叫什么"
            file,
            original_name: source
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
            added_at: added_at.to_string(),
        })
    })();

    if result.is_err() {
        let _ = fs::remove_file(&dest);
    }
    result
}

/// 对账（§5）：记录目录里**多出来的**媒体文件 → 收养进 `media[]`。
///
/// 只记我们真知道的事实（文件名 / 大小 / 扩展名 / MIME）—— **不算哈希、不解码尺寸**：
/// 用户在资源管理器里丢进来的照片，扫描时不该让我们去读一遍几百兆的视频。
/// 返回新收养的文件名（给调用方判断要不要写盘）。
pub fn adopt_loose_files(entry_dir: &Path, media: &mut Vec<MediaMeta>) -> Vec<String> {
    let known: Vec<String> = media.iter().map(|m| m.file.clone()).collect();
    let mut adopted = Vec::new();

    let Ok(items) = fs::read_dir(entry_dir) else {
        return adopted;
    };

    for item in items.flatten() {
        let path = item.path();
        if !path.is_file() {
            continue;
        }
        let file = match path.file_name() {
            Some(name) => name.to_string_lossy().to_string(),
            None => continue,
        };
        // 标记文件与正文不算媒体；已经收过的跳过
        if file == naming::ENTRY_FILE
            || file == naming::NOTE_FILE
            || file.ends_with(".tmp")
            || known.contains(&file)
        {
            continue;
        }

        let ext = normalize_ext(&path);
        if !is_media_ext(&ext) {
            continue; // 别的文件一律不动（宽容条款）
        }

        media.push(MediaMeta {
            schema_version: SCHEMA_VERSION,
            id: new_id(),
            file: file.clone(),
            // 用户直接拷进来的：我们只知道它现在叫什么，原名就当同一个
            original_name: file.clone(),
            ext: ext.clone(),
            mime: guess_mime(&ext).to_string(),
            bytes: fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
            width: None,
            height: None,
            taken_at: None,
            hash: String::new(),
            added_at: String::new(),
        });
        adopted.push(file);
    }

    adopted
}

/// 对账的另一半：`media[]` 里有、磁盘上却没有的 → 剔除（返回被剔除的个数）
pub fn drop_missing_files(entry_dir: &Path, media: &mut Vec<MediaMeta>) -> usize {
    let before = media.len();
    media.retain(|m| !m.file.is_empty() && entry_dir.join(&m.file).is_file());
    before - media.len()
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

/// 整体排序：新的在前（没有导入时间的排最后 —— 那是收养进来的、我们不知道时间）
pub fn sort_media(list: &mut [MediaMeta]) {
    list.sort_by(|a, b| {
        b.added_at
            .cmp(&a.added_at)
            .then_with(|| a.file.cmp(&b.file))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("framevault-media-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn vars() -> NameVars {
        NameVars {
            date: "2026-04-01".into(),
            scene: "晨跑打卡".into(),
            title: "早跑 3km".into(),
            n: 1,
            ..Default::default()
        }
    }

    #[test]
    fn import_copies_probes_hashes_and_names_from_template() {
        let entry_dir = temp_dir("import");
        let source = entry_dir.join("我的照片 01.png");
        image::RgbImage::new(4, 3).save(&source).unwrap();
        let source_bytes = fs::metadata(&source).unwrap().len();

        let meta =
            import_into_entry(&entry_dir, &source, None, &vars(), "2026-04-01T10:00:00Z").unwrap();

        assert_eq!(meta.original_name, "我的照片 01.png", "原名只作来历");
        assert_eq!(meta.file, "2026-04-01_晨跑打卡_01.png", "磁盘名按模板生成");
        assert_eq!(meta.ext, "png");
        assert_eq!(meta.mime, "image/png");
        assert_eq!(meta.bytes, source_bytes);
        assert_eq!((meta.width, meta.height), (Some(4), Some(3)));
        assert_eq!(meta.hash.len(), 64, "sha256 的十六进制是 64 个字符");
        assert!(meta.is_image());
        assert_eq!(meta.id.len(), 36, "媒体 id 由 Rust 发");

        // 媒体就住在记录目录里，原文件还在
        assert!(meta.path_in(&entry_dir).is_file());
        assert!(source.is_file(), "导入是复制，不动原文件");
    }

    #[test]
    fn second_import_gets_seq_02_and_never_overwrites() {
        let entry_dir = temp_dir("seq");
        let source = entry_dir.join("a.png");
        image::RgbImage::new(2, 2).save(&source).unwrap();

        let mut v = vars();
        let first = import_into_entry(&entry_dir, &source, None, &v, "now").unwrap();
        v.n = 2;
        let second = import_into_entry(&entry_dir, &source, None, &v, "now").unwrap();

        assert_eq!(first.file, "2026-04-01_晨跑打卡_01.png");
        assert_eq!(second.file, "2026-04-01_晨跑打卡_02.png");
        assert_eq!(first.hash, second.hash, "同样内容必须同样哈希，将来靠它去重");
    }

    #[test]
    fn same_template_twice_appends_dedupe_suffix() {
        let entry_dir = temp_dir("dedupe");
        let source = entry_dir.join("a.png");
        image::RgbImage::new(2, 2).save(&source).unwrap();

        // 同一个序号导入两次（用户手快点了两下）：第二个加 (2)，绝不覆盖
        let first = import_into_entry(&entry_dir, &source, None, &vars(), "now").unwrap();
        let second = import_into_entry(&entry_dir, &source, None, &vars(), "now").unwrap();

        assert_eq!(first.file, "2026-04-01_晨跑打卡_01.png");
        assert_eq!(second.file, "2026-04-01_晨跑打卡_01 (2).png");
        assert_eq!(fs::read_dir(&entry_dir).unwrap().count(), 3, "两个媒体 + 原图");
    }

    #[test]
    fn template_from_the_scene_is_used() {
        let entry_dir = temp_dir("template");
        let source = entry_dir.join("a.png");
        image::RgbImage::new(2, 2).save(&source).unwrap();

        let mut v = vars();
        v.fields = serde_json::json!({ "builtin.challenge": { "distance": 5 } });
        let meta = import_into_entry(
            &entry_dir,
            &source,
            Some("{date}_{title}_{field:distance}_{n}"),
            &v,
            "now",
        )
        .unwrap();

        assert_eq!(meta.file, "2026-04-01_早跑 3km_5_01.png");
    }

    /// 早期文件里那个 `name` 字段要还读得出来（现在叫 originalName）——
    /// 按既有政策不做跨大版本兼容，但**同一版内的字段改名**必须能读老文件
    #[test]
    fn old_media_json_with_name_still_loads() {
        let old = r#"{
            "schemaVersion": 2,
            "id": "m1",
            "file": "2026-09-22_晨跑_01.jpg",
            "name": "IMG_0001.JPG",
            "ext": "jpg",
            "mime": "image/jpeg",
            "bytes": 1024,
            "hash": "abc",
            "addedAt": "2026-09-22T07:35:00+08:00"
        }"#;

        let meta: MediaMeta = serde_json::from_str(old).unwrap();
        assert_eq!(meta.file, "2026-09-22_晨跑_01.jpg", "磁盘名照旧");
        assert_eq!(meta.original_name, "IMG_0001.JPG", "老的 name 读进 originalName");
    }

    #[test]
    fn adopt_picks_up_loose_media_but_leaves_other_files() {
        let entry_dir = temp_dir("adopt");
        fs::write(entry_dir.join("entry.json"), "{}").unwrap();
        fs::write(entry_dir.join("note.md"), "正文").unwrap();
        fs::write(entry_dir.join("随手丢进来的照片.JPG"), b"x").unwrap();
        fs::write(entry_dir.join("读书笔记.txt"), "别人的笔记").unwrap();

        let mut media = Vec::new();
        let adopted = adopt_loose_files(&entry_dir, &mut media);

        assert_eq!(adopted, vec!["随手丢进来的照片.JPG".to_string()]);
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].file, "随手丢进来的照片.JPG");
        assert_eq!(media[0].mime, "image/jpeg", "扩展名大小写不影响判 MIME");
        assert!(media[0].hash.is_empty(), "收养不假装算过哈希");
        assert_eq!(media[0].original_name, media[0].file);

        // 再扫一次不该重复收养
        let again = adopt_loose_files(&entry_dir, &mut media);
        assert!(again.is_empty());
        assert_eq!(media.len(), 1);
    }

    #[test]
    fn drop_missing_removes_deleted_files() {
        let entry_dir = temp_dir("missing");
        fs::write(entry_dir.join("gone.jpg"), b"x").unwrap();

        let mut media = vec![MediaMeta {
            schema_version: SCHEMA_VERSION,
            id: "m1".into(),
            file: "gone.jpg".into(),
            ext: "jpg".into(),
            mime: "image/jpeg".into(),
            ..Default::default()
        }];
        assert_eq!(drop_missing_files(&entry_dir, &mut media), 0);

        fs::remove_file(entry_dir.join("gone.jpg")).unwrap();
        assert_eq!(drop_missing_files(&entry_dir, &mut media), 1);
        assert!(media.is_empty());
    }

    #[test]
    fn sort_puts_newest_first_and_dateless_last() {
        let mut list = vec![
            MediaMeta {
                added_at: "2026-04-01T10:00:00Z".into(),
                file: "a.jpg".into(),
                ..Default::default()
            },
            MediaMeta {
                added_at: String::new(),
                file: "b.jpg".into(),
                ..Default::default()
            },
            MediaMeta {
                added_at: "2026-04-02T10:00:00Z".into(),
                file: "c.jpg".into(),
                ..Default::default()
            },
        ];
        sort_media(&mut list);
        assert_eq!(
            list.iter().map(|m| m.file.as_str()).collect::<Vec<_>>(),
            vec!["c.jpg", "a.jpg", "b.jpg"]
        );
    }

    #[test]
    fn thumbnail_is_written_and_never_larger_than_max() {
        let vault = temp_dir("thumb");
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
    }

    #[test]
    fn png_without_exif_has_no_taken_at() {
        let entry_dir = temp_dir("noexif");
        let source = entry_dir.join("a.png");
        image::RgbImage::new(2, 2).save(&source).unwrap();

        let meta = import_into_entry(&entry_dir, &source, None, &vars(), "now").unwrap();
        assert!(
            meta.taken_at.is_none(),
            "没有 EXIF 就必须留空，让上层退回 added_at"
        );
    }

    #[test]
    fn video_is_stored_without_probing_size() {
        let entry_dir = temp_dir("video");
        let source = entry_dir.join("clip.MP4");
        fs::write(&source, vec![0u8; 1024]).unwrap();

        let meta = import_into_entry(&entry_dir, &source, None, &vars(), "now").unwrap();
        assert_eq!(meta.ext, "mp4", "扩展名统一小写");
        assert_eq!(meta.mime, "video/mp4");
        assert_eq!(meta.file, "2026-04-01_晨跑打卡_01.mp4");
        assert_eq!((meta.width, meta.height), (None, None));
        assert!(!meta.is_image());
    }

    #[test]
    fn failed_import_leaves_nothing_behind() {
        let entry_dir = temp_dir("failed");
        let before = fs::read_dir(&entry_dir).unwrap().count();

        let result = import_into_entry(
            &entry_dir,
            &entry_dir.join("nope.png"),
            None,
            &vars(),
            "now",
        );
        assert!(result.is_err());
        assert_eq!(fs::read_dir(&entry_dir).unwrap().count(), before, "不留半成品");

        // 记录目录不存在时也要明确报错，而不是建出一个孤儿目录
        let ghost = entry_dir.join("没有这个记录");
        assert!(import_into_entry(&ghost, &entry_dir.join("nope.png"), None, &vars(), "now")
            .is_err());
        assert!(!ghost.exists());
    }
}
