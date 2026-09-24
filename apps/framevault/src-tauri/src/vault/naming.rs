//! 命名：净化 / 目录名派生 / 媒体文件模板 / 撞名去重。
//!
//! **这是"磁盘上的名字从哪来"的唯一出口** —— 别处不许自己拼名字、不许自己判重名。
//! 布局是"名字就是名字"（见 `docs/PROPOSAL_storage_v2_zh-CN.md` §3）：
//! 场景目录名 = 净化后的场景名，记录目录名 = `"{创建日} {净化后的标题}"`，
//! 所以 `FolderMeta.name` / `Entry.title` 与磁盘目录名**永远相等**，不需要额外的"目录名字段"。

use super::store::Vault;
use std::collections::HashSet;
use std::path::Path;

/// 名字里不许出现的字符（Windows 与 POSIX 的并集）
const ILLEGAL: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Windows 保留设备名：叫这个的文件/目录在 Windows 上根本建不出来
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// 单个名字部分的长度上限（字符数，不是字节）。加上日期与分隔符仍在 MAX_PATH 之内。
pub const MAX_NAME: usize = 80;

/// 记录的正文文件名（**唯一真相**，不进 `entry.json`）
pub const NOTE_FILE: &str = "note.md";
/// 记录 / 场景的标记文件
pub const ENTRY_FILE: &str = "entry.json";
pub const FOLDER_FILE: &str = "folder.json";

/// 不属于任何场景的记录放这儿（根下一级、**没有 `folder.json`** 的那个容器）。
///
/// 注意：识别靠**结构**（根下没有 `folder.json` 的一级目录），不靠这个名字 ——
/// 用户把它改名成别的也照常认；这个名字只在"新建仓库"和"没地方放时"用作默认容器。
pub const UNCATEGORIZED: &str = "未归类";

/// 场景名 / 标题名净化后的兜底
const FALLBACK_SCENE: &str = "未命名场景";
const FALLBACK_ENTRY: &str = "未命名记录";

/// 核心默认的媒体命名模板（场景可以在 manifest 里声明自己的）
pub const DEFAULT_MEDIA_TEMPLATE: &str = "{date}_{scene}_{n}";

/// 净化：去掉非法字符与控制字符、规避保留名、去掉尾部空格与点、截断长度。
///
/// **净化的结果就是名字本身** —— 调用方应该把它写回 `title` / `name` 字段，
/// 这样"界面上叫 A、磁盘上叫 B"这种事不会发生。空名返回空串，由调用方决定兜底。
pub fn sanitize(raw: &str) -> String {
    sanitize_with(raw, MAX_NAME)
}

pub fn sanitize_with(raw: &str, max: usize) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        // 控制字符（含 \r \n \t）与非法字符一律换成下划线，保持长度感，不把两个字粘成一个
        if ch.is_control() || ILLEGAL.contains(&ch) {
            out.push('_');
        } else {
            out.push(ch);
        }
    }

    // 截断按**字符**来（中文一个字符 ≠ 一个字节，按字节截会切出半个字）
    if out.chars().count() > max {
        out = out.chars().take(max).collect();
    }

    let mut out = out.trim().to_string();
    // 尾部空格与点：Windows 会悄悄把它们删掉，于是"写的名字"和"读回来的名字"对不上
    while out.ends_with(' ') || out.ends_with('.') {
        out.pop();
    }

    if is_reserved(&out) {
        out.insert(0, '_');
    }
    out
}

/// 这个名字（含带扩展名的形态）是不是 Windows 保留名？
fn is_reserved(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name);
    let upper = stem.trim().to_ascii_uppercase();
    RESERVED.contains(&upper.as_str())
}

/// 场景目录名 = 净化后的场景名（空名兜底成「未命名场景」）
pub fn scene_dir_name(name: &str) -> String {
    let clean = sanitize(name);
    if clean.is_empty() {
        FALLBACK_SCENE.to_string()
    } else {
        clean
    }
}

/// 记录目录名 = `"{创建日} {净化后的标题}"`；两个部分各自可能缺席。
///
/// `day` 是**记录自身的创建日**（本地日期，`YYYY-MM-DD`），不是"这条按哪天算"的影像日 ——
/// 后面补照片让影像日变了，目录名也不该动。
pub fn entry_dir_name(day: &str, title: &str) -> String {
    let day = day.trim();
    let title = sanitize(title);

    match (day.is_empty(), title.is_empty()) {
        (false, false) => format!("{day} {title}"),
        (false, true) => day.to_string(),
        (true, false) => title,
        (true, true) => FALLBACK_ENTRY.to_string(),
    }
}

/// 从 ISO 时间戳里取本地日期部分（`2026-09-23T08:00:00+08:00` → `2026-09-23`）。
/// 认不出来就返回空——宁可目录名只有标题，也不要编一个日期出来。
pub fn day_of(timestamp: &str) -> String {
    let text = timestamp.trim();
    let head = match text.split_once(['T', ' ']) {
        Some((date, _)) => date,
        None => text,
    };
    let mut parts = head.split('-');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(y), Some(m), Some(d))
            if y.len() == 4 && m.len() == 2 && d.len() == 2 && y.chars().all(|c| c.is_ascii_digit())
                && m.chars().all(|c| c.is_ascii_digit())
                && d.chars().all(|c| c.is_ascii_digit()) =>
        {
            format!("{y}-{m}-{d}")
        }
        _ => String::new(),
    }
}

/// 渲染媒体文件名模板时可用的变量。
///
/// **模板由前端按场景 manifest 解析后传进来，值由 Rust 从记录里取** ——
/// 这样第三方场景的模板写在自己的插件包里，Rust 不需要去读插件目录。
#[derive(Debug, Clone, Default)]
pub struct NameVars {
    /// 拍摄日（缺则导入日）
    pub date: String,
    /// 场景名（没有场景就是空）
    pub scene: String,
    /// 记录标题
    pub title: String,
    /// 场景自定义字段（用来填 `{field:<key>}`）
    pub fields: serde_json::Value,
    /// 同目录内的序号（从 1 开始）
    pub n: usize,
}

/// 渲染模板字符串（不净化的原始产物，交给 `media_file_stem` 收尾）。
pub fn render_template(template: &str, vars: &NameVars) -> String {
    let mut out = String::new();
    let mut rest = template;

    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('}') {
            Some(end) => {
                out.push_str(&resolve_token(&after[..end], vars));
                rest = &after[end + 1..];
            }
            None => {
                // 没闭合的花括号：原样留在名字里，不要静默吞掉半截
                out.push_str(&rest[start..]);
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

fn resolve_token(token: &str, vars: &NameVars) -> String {
    let token = token.trim();
    match token {
        "date" => vars.date.clone(),
        "scene" => vars.scene.clone(),
        "title" => vars.title.clone(),
        "n" => format!("{:02}", vars.n.max(1)),
        other => match other.strip_prefix("field:") {
            Some(key) => field_value(&vars.fields, key.trim()),
            None => String::new(), // 认不出的 token 丢掉：名字里留个 {xxx} 更难看
        },
    }
}

/// 取字段值当名字。字段按**主题 id 命名空间**存放，早期数据直接写在顶层——
/// 这里把两种都认了（跟前端 `readField` 的兼容读法是同一套规矩）。
fn field_value(fields: &serde_json::Value, key: &str) -> String {
    let direct = fields.get(key).and_then(scalar_text);
    if let Some(text) = direct {
        return text;
    }
    let Some(obj) = fields.as_object() else {
        return String::new();
    };
    for value in obj.values() {
        if let Some(text) = value.get(key).and_then(scalar_text) {
            return text;
        }
    }
    String::new()
}

fn scalar_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s.trim().to_string()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

/// 媒体文件名的词干（不含扩展名）：渲染模板 → 净化 → 收拾掉空变量留下的多余分隔符。
///
/// 回退链（VISION §3.5）：模板里取不到的变量自己消失；整条渲染出来为空时，
/// 退到「日期_序号」，再退到「媒体」——**名字始终可读，绝不空**。
pub fn media_file_stem(template: Option<&str>, vars: &NameVars) -> String {
    let template = template
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .unwrap_or(DEFAULT_MEDIA_TEMPLATE);

    let rendered = render_template(template, vars);
    let cleaned = tidy_separators(&sanitize_with(&rendered, MAX_NAME));
    if !cleaned.is_empty() {
        return cleaned;
    }

    let fallback = tidy_separators(&sanitize(&format!(
        "{}_{:02}",
        vars.date,
        vars.n.max(1)
    )));
    if !fallback.is_empty() {
        return fallback;
    }
    "媒体".to_string()
}

/// 把空变量留下的 `2026-09-23__01` 收成 `2026-09-23_01`，并去掉首尾分隔符。
fn tidy_separators(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut last_sep = false;
    for ch in raw.chars() {
        let is_sep = ch == '_' || ch == '-' || ch == ' ';
        if is_sep && last_sep {
            continue;
        }
        last_sep = is_sep;
        out.push(ch);
    }
    out.trim_matches(|c| c == '_' || c == '-' || c == ' ').to_string()
}

/// 在 `dir` 里给 `stem`(+`ext`) 找一个没被占用的名字：撞名就加 ` (2)`、` (3)`…
///
/// **绝不覆盖已有文件** —— 场景、记录、媒体共用这一条规则。
///
/// 实现上**只列一次目录**，拿一份"已占用的名字"集合来查。原来是一个候选一次 `exists()`，
/// 上限一万次 —— 在 SAF（安卓用户选的目录）上那就是一次次 ContentResolver 往返，慢到不可用；
/// 列一次目录在两种后端上都更省，语义不变。
///
/// 判重**按大小写不敏感**（拿小写当键）：Windows / macOS 的文件系统本来就不敏感，这样两端行为
/// 与今天一致；同时让 Linux 与 FAT/exFAT（手机 SD 卡）也跟上 —— 三端一条规则。
/// 方向是"宁可多让一个名字"：判重严格顶多名字不漂亮，判重宽松就会**覆盖别人的文件**。
pub fn unique_child_name_in(vault: &Vault, dir: &Path, stem: &str, ext: Option<&str>) -> String {
    // **列一次目录**（SAF 上没有"逐个 exists 探测"这条路；桌面上也省掉上百次 syscall）。
    // 拿不到目录（不存在 / 读不了）就按空目录处理 —— 与旧实现"`exists()` 全 false"的结果一致。
    let taken: HashSet<String> = vault
        .list_dir(dir)
        .map(|items| {
            items
                .into_iter()
                .map(|item| item.name.to_lowercase())
                .collect()
        })
        .unwrap_or_default();
    pick_unique(&taken, stem, ext)
}

/// 过渡壳（只跑桌面）：拿裸路径的调用方走这儿，域内调用点正在往 `unique_child_name_in` 迁。
pub fn unique_child_name(dir: &Path, stem: &str, ext: Option<&str>) -> String {
    let mut taken: HashSet<String> = HashSet::new();
    if let Ok(items) = std::fs::read_dir(dir) {
        for item in items.flatten() {
            // `to_string_lossy`：非 UTF-8 的名字也占位（宁可多让一个，也别撞上）
            taken.insert(item.file_name().to_string_lossy().to_lowercase());
        }
    }
    pick_unique(&taken, stem, ext)
}

/// 挑一个没被占用的名字：`名字.ext` → `名字 (2).ext` → `名字 (3).ext` ……（大小写不敏感）
fn pick_unique(taken: &HashSet<String>, stem: &str, ext: Option<&str>) -> String {
    let stem = if stem.trim().is_empty() {
        FALLBACK_ENTRY.to_string()
    } else {
        stem.to_string()
    };
    let suffix = match ext {
        Some(e) if !e.is_empty() => format!(".{e}"),
        _ => String::new(),
    };

    let candidate = format!("{stem}{suffix}");
    if !taken.contains(&candidate.to_lowercase()) {
        return candidate;
    }

    for index in 2..10_000 {
        let candidate = format!("{stem} ({index}){suffix}");
        if !taken.contains(&candidate.to_lowercase()) {
            return candidate;
        }
    }
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_removes_illegal_and_control_chars() {
        assert_eq!(sanitize("a/b\\c:d*e?f\"g<h>i|j"), "a_b_c_d_e_f_g_h_i_j");
        assert_eq!(sanitize("一\t二\n三"), "一_二_三", "控制字符也换掉，不粘成一坨");
        assert_eq!(sanitize("正常的中文名字"), "正常的中文名字");
    }

    #[test]
    fn sanitize_avoids_windows_reserved_names() {
        assert_eq!(sanitize("CON"), "_CON");
        assert_eq!(sanitize("nul"), "_nul");
        assert_eq!(sanitize("COM1.txt"), "_COM1.txt", "带扩展名的形态也躲开");
        assert_eq!(sanitize("CONSOLE"), "CONSOLE", "只是前缀相同不算保留名");
    }

    #[test]
    fn sanitize_strips_trailing_space_and_dot() {
        assert_eq!(sanitize("尾巴 "), "尾巴");
        assert_eq!(sanitize("结尾的点..."), "结尾的点");
        assert_eq!(sanitize("  两边空白  "), "两边空白");
    }

    #[test]
    fn sanitize_truncates_by_chars_not_bytes() {
        let long = "很".repeat(200);
        let out = sanitize(&long);
        assert_eq!(out.chars().count(), MAX_NAME, "截断按字符数，中文才不会被切坏");
    }

    #[test]
    fn sanitize_keeps_empty_as_empty() {
        assert_eq!(sanitize("   "), "", "空名交给调用方兜底");
        assert_eq!(sanitize("..."), "", "只剩点也等于没有");
    }

    #[test]
    fn scene_dir_name_falls_back() {
        assert_eq!(scene_dir_name("晨跑打卡"), "晨跑打卡");
        assert_eq!(scene_dir_name("a/b"), "a_b");
        assert_eq!(scene_dir_name("   "), FALLBACK_SCENE);
    }

    #[test]
    fn entry_dir_name_is_day_plus_title() {
        assert_eq!(entry_dir_name("2026-09-22", "早跑 3km"), "2026-09-22 早跑 3km");
        assert_eq!(entry_dir_name("2026-09-22", ""), "2026-09-22", "标题空就只留日期");
        assert_eq!(entry_dir_name("", "随记"), "随记");
        assert_eq!(entry_dir_name("", "  "), FALLBACK_ENTRY);
        assert_eq!(
            entry_dir_name("2026-09-22", "3/4 配速"),
            "2026-09-22 3_4 配速",
            "标题里的斜杠当场变下划线（与 Obsidian 同款）"
        );
    }

    #[test]
    fn day_of_reads_the_local_date() {
        assert_eq!(day_of("2026-09-23T08:30:00+08:00"), "2026-09-23");
        assert_eq!(day_of("2026-09-23T08:30:00Z"), "2026-09-23");
        assert_eq!(day_of("2026-09-23 08:30:00"), "2026-09-23");
        assert_eq!(day_of("2026-09-23"), "2026-09-23");
        for bad in ["", "昨天", "2026-9-3", "2026/09/23", "2026-09"] {
            assert_eq!(day_of(bad), "", "认不出来就留空：{bad}");
        }
    }

    fn vars() -> NameVars {
        NameVars {
            date: "2026-09-23".into(),
            scene: "晨跑打卡".into(),
            title: "早跑 3km".into(),
            fields: serde_json::json!({ "builtin.challenge": { "distance": 5 } }),
            n: 1,
        }
    }

    #[test]
    fn template_renders_all_variables() {
        assert_eq!(
            media_file_stem(Some("{date}_{scene}_{title}_{field:distance}_{n}"), &vars()),
            "2026-09-23_晨跑打卡_早跑 3km_5_01"
        );
        assert_eq!(
            media_file_stem(None, &vars()),
            "2026-09-23_晨跑打卡_01",
            "没给模板就走核心默认模板"
        );
    }

    #[test]
    fn template_drops_missing_variables_cleanly() {
        let mut v = vars();
        v.scene = String::new();
        assert_eq!(
            media_file_stem(Some("{date}_{scene}_{n}"), &v),
            "2026-09-23_01",
            "变量空掉之后不留多余的下划线"
        );

        let mut no_date = vars();
        no_date.date = String::new();
        assert_eq!(media_file_stem(Some("{date}_{scene}"), &no_date), "晨跑打卡");

        let empty = NameVars::default();
        assert_eq!(
            media_file_stem(Some("{date}_{scene}"), &empty),
            "01",
            "全空也不能是空名字"
        );
        assert_eq!(media_file_stem(Some("{没这个变量}"), &empty), "01");
    }

    #[test]
    fn template_reads_top_level_fields_too() {
        let mut v = vars();
        v.fields = serde_json::json!({ "location": "西湖" });
        assert_eq!(
            media_file_stem(Some("{field:location}"), &v),
            "西湖",
            "早期数据把字段写在顶层，也要认"
        );
    }

    #[test]
    fn template_unknown_tokens_disappear() {
        assert_eq!(
            media_file_stem(Some("{date}_{who}_{n}"), &vars()),
            "2026-09-23_01"
        );
        assert_eq!(
            media_file_stem(Some("{date"), &vars()),
            "{date",
            "没闭合的花括号原样留着，不吞掉后面半截（花括号在文件名里是合法字符）"
        );
    }

    #[test]
    fn unique_child_name_appends_suffix() {
        let dir = std::env::temp_dir().join("framevault-naming-unique");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        assert_eq!(unique_child_name(&dir, "照片", Some("jpg")), "照片.jpg");

        std::fs::write(dir.join("照片.jpg"), b"x").unwrap();
        assert_eq!(unique_child_name(&dir, "照片", Some("jpg")), "照片 (2).jpg");

        std::fs::write(dir.join("照片 (2).jpg"), b"x").unwrap();
        assert_eq!(unique_child_name(&dir, "照片", Some("jpg")), "照片 (3).jpg");

        // 目录也一样（不带扩展名）
        std::fs::create_dir_all(dir.join("2026-09-23 早跑")).unwrap();
        assert_eq!(
            unique_child_name(&dir, "2026-09-23 早跑", None),
            "2026-09-23 早跑 (2)"
        );
    }

    #[test]
    fn unique_child_name_handles_empty_stem() {
        let dir = std::env::temp_dir().join("framevault-naming-empty");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_child_name(&dir, "  ", None), FALLBACK_ENTRY);
    }

    /// 判重**按大小写不敏感**：Windows / macOS 的盘本来就不敏感（`Foo` 与 `foo` 是同一个文件），
    /// 手机上常见 SD 卡是 FAT/exFAT 也一样。严格判重顶多名字不漂亮；宽松判重会**覆盖别人的文件**。
    #[test]
    fn unique_child_name_is_case_insensitive() {
        let dir = std::env::temp_dir().join("framevault-naming-case");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        std::fs::write(dir.join("Photo.JPG"), b"x").unwrap();
        assert_eq!(
            unique_child_name(&dir, "photo", Some("jpg")),
            "photo (2).jpg",
            "大小写不同也算撞名"
        );
        assert_eq!(
            unique_child_name(&dir, "PHOTO", Some("JPG")),
            "PHOTO (2).JPG"
        );

        // 目录同理
        std::fs::create_dir_all(dir.join("Run")).unwrap();
        assert_eq!(unique_child_name(&dir, "run", None), "run (2)");
    }

    /// 列一次目录就够了：候选很多个时也不该逐个探盘。
    /// 这里用一个"已经占到第 500 号"的目录来确认它仍然只挑第一个空位（而不是探 500 次才回来）。
    #[test]
    fn unique_child_name_scans_once_and_still_finds_the_first_free_slot() {
        let dir = std::env::temp_dir().join("framevault-naming-many");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        std::fs::write(dir.join("图.jpg"), b"x").unwrap();
        for index in 2..=500 {
            std::fs::write(dir.join(format!("图 ({index}).jpg")), b"x").unwrap();
        }

        assert_eq!(unique_child_name(&dir, "图", Some("jpg")), "图 (501).jpg");
    }
}
