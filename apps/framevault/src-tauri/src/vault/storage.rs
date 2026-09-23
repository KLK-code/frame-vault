//! 存储：Vault 长什么样、路径怎么算、扫描怎么扫、写盘怎么保证原子。
//!
//! **磁盘布局（v2「人可读层级」）** —— 见 `docs/PROPOSAL_storage_v2_zh-CN.md`：
//!
//! ```text
//! <用户选的目录>/
//! ├── vault.json                      身份文件（有它才算 Vault）
//! ├── .framevault/trash/<原目录名>/    删掉的记录挪这儿（撤销 = 挪回去）
//! ├── 科研/                            **主题**：一级目录且**没有 folder.json**（用户自己分的组）
//! │   └── <文件夹>/                    主题里面才是文件夹（带 folder.json）
//! │       └── 2026-09-22 早跑 3km/     再里面是记录
//! │           ├── entry.json
//! │           ├── note.md
//! │           └── 2026-09-23_晨跑打卡_01.jpg
//! ├── <文件夹>/                        也可以直接摆在根下 = **没有主题**
//! └── 未归类/                          没有文件夹的记录（默认容器）
//! ```
//!
//! **认目录只有一条规则**：一级目录带 `folder.json` = 文件夹；不带 = **容器**（主题）。
//! 容器里既可以放文件夹（"这个主题下的文件夹"），也可以直接放记录（「未归类」就是这种）。
//! 根下直接摆文件夹 = 没有主题 —— 分类是用户自己的事，App 不要求他分主题。
//!
//! 三条规矩：
//! 1. **磁盘为准**：归属从物理位置派生 —— 记录在哪个场景目录里就是哪个场景的；
//!    用户在资源管理器里挪动 / 改名，扫一次就跟着认。
//! 2. **没有 id → 路径缓存**：一律按扫描定位。少一类"缓存过期"的 bug，而且"磁盘为准"本来就要重扫。
//! 3. **宽容条款**：不认识的目录与文件一律不动、不删、不报错，只记日志。

use super::folder::FolderMeta;
use super::id::new_id;
use super::media::{adopt_loose_files, drop_missing_files, sort_media};
use super::model::{is_supported, Entry, VaultMeta, SCHEMA_VERSION};
use super::naming::{self, ENTRY_FILE, FOLDER_FILE, NOTE_FILE, UNCATEGORIZED};
use crate::error::{AppError, AppResult};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

// ── 路径约定（Vault 长什么样，只有这里说了算）──

pub fn vault_meta_path(vault: &Path) -> PathBuf {
    vault.join("vault.json")
}

/// 应用自己的东西（回收站、将来的索引缓存）都在这里，不和用户的记录混在一起
pub fn internal_dir(vault: &Path) -> PathBuf {
    vault.join(".framevault")
}

pub fn trash_dir(vault: &Path) -> PathBuf {
    internal_dir(vault).join("trash")
}

/// 回收站里的一条记录：**保留它原来的目录名**（撤销时原样挪回去，手动改的名字也不丢）
pub fn trash_entry_path(vault: &Path, dir_name: &str) -> PathBuf {
    trash_dir(vault).join(dir_name)
}

/// 这个目录是不是在回收站里？
fn in_trash(vault: &Path, dir: &Path) -> bool {
    dir.parent() == Some(trash_dir(vault).as_path())
}

pub fn entry_json_path(entry_dir: &Path) -> PathBuf {
    entry_dir.join(ENTRY_FILE)
}

pub fn note_path(entry_dir: &Path) -> PathBuf {
    entry_dir.join(NOTE_FILE)
}

pub fn folder_json_path(dir: &Path) -> PathBuf {
    dir.join(FOLDER_FILE)
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(".tmp"); // entry.json → entry.json.tmp
    PathBuf::from(s)
}

/// Vault 根下的一级子目录（跳过 `.framevault` 与其它点开头的内部目录）
pub fn root_dirs(vault: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(items) = fs::read_dir(vault) else {
        return out;
    };
    for item in items.flatten() {
        let path = item.path();
        if !path.is_dir() {
            continue;
        }
        let name = item.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue; // .framevault 以及用户自己的隐藏目录
        }
        out.push(path);
    }
    out.sort();
    out
}

// ── 原子写入 ──

/// 原子写入：先写 «文件».tmp，再 rename 覆盖。
/// 同一文件系统内 rename 是原子操作，所以崩溃/断电不会留下"半个文件"。
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let json = serde_json::to_string_pretty(value)?;
    write_atomic(path, json.as_bytes())
}

/// 文本的原子写入（给 `note.md`）—— 跟 JSON 同一条路子，tmp + rename
pub fn write_text_atomic(path: &Path, text: &str) -> AppResult<()> {
    // 正文统一 LF：CRLF 会让"文件没变但 git 说全变了"，也让同步白传一遍
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    write_atomic(path, normalized.as_bytes())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let tmp = tmp_path(path);
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

pub(crate) fn read_json<T: DeserializeOwned>(path: &Path) -> AppResult<T> {
    let text = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&text)?)
}

/// 读文本；文件不在就返回空串（正文可以为空，缺文件与空文件是一回事）
pub fn read_text(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

// ── Vault 身份 ──

/// 这个目录是 Vault 根吗？判断依据只有一条：**有没有 vault.json**。
/// 这样就不会再把 «.../未归类» 这种子目录误当成 Vault（之前踩过）。
pub fn is_vault(dir: &Path) -> bool {
    vault_meta_path(dir).is_file()
}

/// 在 dir 里创建一个新 Vault：建目录结构 + 写身份文件。
///
/// 预建的就两样：`未归类/`（不属于任何场景的记录要有地方去）与 `.framevault/trash/`。
pub fn create_vault(dir: &Path, name: &str, created_at: &str) -> AppResult<VaultMeta> {
    if is_vault(dir) {
        return Err(AppError::Invalid(format!(
            "{} 已经是一个 Vault 了",
            dir.display()
        )));
    }

    fs::create_dir_all(dir.join(UNCATEGORIZED))?;
    fs::create_dir_all(trash_dir(dir))?;

    let meta = VaultMeta {
        schema_version: SCHEMA_VERSION,
        layout: SCHEMA_VERSION,
        vault_id: new_id(),
        name: name.to_string(),
        created_at: created_at.to_string(),
    };
    write_json_atomic(&vault_meta_path(dir), &meta)?;

    Ok(meta)
}

pub fn read_vault_meta(dir: &Path) -> AppResult<VaultMeta> {
    let path = vault_meta_path(dir);
    if !path.is_file() {
        return Err(AppError::NotFound(format!(
            "{} 不是 Vault（缺少 vault.json）",
            dir.display()
        )));
    }

    let meta: VaultMeta = read_json(&path)?;
    if !is_supported(meta.schema_version) || meta.layout != SCHEMA_VERSION {
        return Err(AppError::Invalid(format!(
            "这个仓库是旧版布局（v{}，现在是 v{}），本程序已不再支持它。\n\
             请用「新建仓库…」建一个新的 —— 旧仓库不动它，原样保留在磁盘上。",
            meta.schema_version, SCHEMA_VERSION
        )));
    }
    Ok(meta)
}

// ── 场景目录 ──

/// 根下**没有** `folder.json` 的一级目录 = **主题容器**（「未归类」也是其中之一）
pub fn topic_dirs(vault: &Path) -> Vec<PathBuf> {
    root_dirs(vault)
        .into_iter()
        .filter(|dir| !folder_json_path(dir).is_file())
        .collect()
}

/// 所有文件夹：`(目录, 它在哪个主题下)`。根下直接摆的文件夹没有主题（`None`）。
///
/// 这是"主题 = 磁盘上的位置"这条规矩的唯一落点：**不存字段，只认目录**。
pub fn folder_dirs(vault: &Path) -> Vec<(PathBuf, Option<String>)> {
    let mut out = Vec::new();

    for dir in root_dirs(vault) {
        if folder_json_path(&dir).is_file() {
            out.push((dir, None)); // 根下直接摆 = 没有主题
            continue;
        }
        let topic = dir.file_name().map(|n| n.to_string_lossy().to_string());
        for child in child_dirs(&dir) {
            if folder_json_path(&child).is_file() {
                out.push((child, topic.clone()));
            }
        }
    }

    out
}

/// 按名字找主题容器
pub fn topic_dir(vault: &Path, name: &str) -> Option<PathBuf> {
    let wanted = naming::sanitize(name);
    topic_dirs(vault)
        .into_iter()
        .find(|dir| dir.file_name().map(|n| n.to_string_lossy().to_string()) == Some(wanted.clone()))
}

/// 新建主题：一个没有 `folder.json` 的目录（撞名加 ` (2)`）
pub fn create_topic(vault: &Path, name: &str) -> AppResult<PathBuf> {
    let name = naming::sanitize(name);
    if name.is_empty() {
        return Err(AppError::Invalid("主题名不能为空".into()));
    }
    let dir = vault.join(naming::unique_child_name(vault, &name, None));
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// 主题改名：就是改目录名（里面的文件夹跟着换主题 —— 因为它们的位置变了）
pub fn rename_topic(vault: &Path, name: &str, new_name: &str) -> AppResult<PathBuf> {
    let dir =
        topic_dir(vault, name).ok_or_else(|| AppError::NotFound(format!("主题不存在：{name}")))?;
    let new_name = naming::sanitize(new_name);
    if new_name.is_empty() {
        return Err(AppError::Invalid("主题名不能为空".into()));
    }

    let current = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if current == new_name {
        return Ok(dir);
    }

    let target = vault.join(naming::unique_child_name(vault, &new_name, None));
    fs::rename(&dir, &target)?;
    Ok(target)
}

/// 删除主题：**里面还有东西就拒绝**（跟删文件夹同一条规矩 —— 宁可让用户先处理）
pub fn delete_topic(vault: &Path, name: &str) -> AppResult<()> {
    let dir =
        topic_dir(vault, name).ok_or_else(|| AppError::NotFound(format!("主题不存在：{name}")))?;

    let inside: Vec<PathBuf> = child_dirs(&dir)
        .into_iter()
        .filter(|child| folder_json_path(child).is_file() || entry_json_path(child).is_file())
        .collect();
    if !inside.is_empty() {
        return Err(AppError::Invalid(format!(
            "「{name}」里还有 {} 项内容，请先把它们挪走或删掉",
            inside.len()
        )));
    }

    fs::remove_dir_all(&dir)?;
    Ok(())
}

/// 拿「未归类」容器（**按名字**）：没有就建一个。
///
/// 为什么这里按名字、扫描却按结构：**扫描**是"磁盘上有什么就是什么"（任何容器都能装记录），
/// 而**写路径**得有个说得准的落点 —— "没有文件夹的记录放哪儿"必须有确定答案，
/// 不能随仓库里恰好有几个主题而变。
pub fn ensure_uncategorized(vault: &Path) -> AppResult<PathBuf> {
    let dir = topic_dir(vault, UNCATEGORIZED).unwrap_or_else(|| vault.join(UNCATEGORIZED));
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// 按 id 找文件夹目录（根下 + 每个主题容器下的一级）
pub fn find_folder_dir(vault: &Path, id: &str) -> AppResult<PathBuf> {
    for (dir, _) in folder_dirs(vault) {
        if let Ok(folder) = read_json::<FolderMeta>(&folder_json_path(&dir)) {
            if folder.id == id {
                return Ok(dir);
            }
        }
    }
    Err(AppError::NotFound(format!("文件夹不存在：{id}")))
}

// ── 记录 ──

/// 某个目录下的直接子目录里，哪些是记录目录（带 `entry.json`）。
/// 删场景前的"非空判定"靠它 —— 判据是**物理位置**，不管 `entry.json` 里的归属字段写了谁。
pub fn entry_dirs_in(parent: &Path) -> Vec<PathBuf> {
    child_entry_dirs(parent)
}

fn child_dirs(parent: &Path) -> Vec<PathBuf> {
    let Ok(items) = fs::read_dir(parent) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = items
        .flatten()
        .map(|item| item.path())
        .filter(|path| path.is_dir())
        .collect();
    out.sort();
    out
}

fn child_entry_dirs(parent: &Path) -> Vec<PathBuf> {
    let Ok(items) = fs::read_dir(parent) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in items.flatten() {
        let path = item.path();
        if path.is_dir() && entry_json_path(&path).is_file() {
            out.push(path);
        }
    }
    out
}

/// 仓库里**活着的**记录目录，这四种位置都算：
/// ① 根下文件夹里的记录；② 主题容器 → 文件夹 → 记录；③ 容器里直接摆的记录（未归类）；
/// ④ 根下直接摆的记录（没有文件夹、也没有主题）。
pub fn list_entry_dirs(vault: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();

    for dir in root_dirs(vault) {
        if folder_json_path(&dir).is_file() {
            out.extend(child_entry_dirs(&dir)); // ① 根下的文件夹
            continue;
        }

        // 容器（主题），或"未归类"
        if entry_json_path(&dir).is_file() {
            out.push(dir.clone()); // ④ 直接摆在根下的一条记录
        }
        for child in child_dirs(&dir) {
            if folder_json_path(&child).is_file() {
                out.extend(child_entry_dirs(&child)); // ② 主题下的文件夹
            } else if entry_json_path(&child).is_file() {
                out.push(child); // ③ 容器里直接摆的记录
            }
        }
    }

    out
}

/// 回收站里的记录目录
pub fn list_trash_dirs(vault: &Path) -> Vec<PathBuf> {
    let dir = trash_dir(vault);
    if !dir.is_dir() {
        return Vec::new();
    }
    child_entry_dirs(&dir)
}

/// 按 id 找记录目录（**活着的与回收站里的都找**）
pub fn find_entry_dir(vault: &Path, id: &str) -> AppResult<PathBuf> {
    let candidates = list_entry_dirs(vault)
        .into_iter()
        .chain(list_trash_dirs(vault));

    for dir in candidates {
        if let Ok(entry) = read_json::<Entry>(&entry_json_path(&dir)) {
            if entry.id == id {
                return Ok(dir);
            }
        }
    }
    Err(AppError::NotFound(format!("记录不存在：{id}")))
}

/// 一条记录该放哪个目录下：有场景 → 那个场景目录；没有 → 「未归类」
pub fn entry_slot(vault: &Path, folder_id: Option<&str>) -> AppResult<PathBuf> {
    match folder_id {
        Some(id) => find_folder_dir(vault, id),
        None => ensure_uncategorized(vault),
    }
}

/// 读一条记录：`entry.json` + `note.md`（正文的唯一真相），顺带做一次媒体对账。
///
/// 对账就是"磁盘为准"：用户往记录目录里丢的照片被收养进 `media[]`，
/// 被删掉的照片从 `media[]` 里剔除。两件事都不摧毁任何文件。
fn load_entry_dir(dir: &Path) -> Option<Entry> {
    let file = entry_json_path(dir);
    if !file.is_file() {
        return None;
    }

    let mut entry = match read_json::<Entry>(&file) {
        Ok(entry) => entry,
        Err(err) => {
            eprintln!("[vault] 跳过损坏的记录 {}：{err}", file.display());
            return None;
        }
    };

    entry.note = read_text(&note_path(dir));

    let mut media = std::mem::take(&mut entry.media);
    let adopted = adopt_loose_files(dir, &mut media);
    let dropped = drop_missing_files(dir, &mut media);
    if !adopted.is_empty() || dropped > 0 {
        sort_media(&mut media);
        if !adopted.is_empty() {
            eprintln!(
                "[vault] 收养 {} 个媒体文件（{}）",
                adopted.len(),
                dir.display()
            );
        }
        entry.media = media;
        if let Err(err) = write_json_atomic(&file, &entry) {
            eprintln!("[vault] 对账结果写不回去（{}）：{err}", file.display());
        }
    } else {
        entry.media = media;
    }

    Some(entry)
}

pub fn read_entry_from(dir: &Path) -> AppResult<Entry> {
    load_entry_dir(dir).ok_or_else(|| {
        AppError::NotFound(format!("记录目录不完整（缺 entry.json）：{}", dir.display()))
    })
}

pub fn read_entry(vault: &Path, id: &str) -> AppResult<Entry> {
    read_entry_from(&find_entry_dir(vault, id)?)
}

/// 新建一条记录：按「创建日 + 标题」算出目录名（撞名加后缀），建目录、写正文、写元数据。
pub fn create_entry(vault: &Path, entry: &mut Entry) -> AppResult<PathBuf> {
    if !is_supported(entry.schema_version) {
        return Err(AppError::Invalid(format!(
            "不支持的 schemaVersion: {}",
            entry.schema_version
        )));
    }

    let parent = entry_slot(vault, entry.folder_id.as_deref())?;
    let desired = naming::entry_dir_name(&entry.day, &entry.title);
    let dir_name = naming::unique_child_name(&parent, &desired, None);
    let dir = parent.join(dir_name);
    fs::create_dir_all(&dir)?;

    write_text_atomic(&note_path(&dir), &entry.note)?;
    write_json_atomic(&entry_json_path(&dir), entry)?;
    Ok(dir)
}

/// 把一条记录写回它**当前所在的目录**，并按需把目录改名（改标题 / 改日期之后）。
///
/// 手动改名的判定（§3.5）：只有"当前目录名 == `"{day} {净化(原标题)}"`"才敢自动改名；
/// 不相等说明用户在资源管理器里改过它 —— 那就只写内容，**永久不动目录名**。
///
/// 顺序（§6）：先写 `note.md`、再写 `entry.json`、最后才 `rename` 目录。
/// 最坏情况是"内容更新了、目录名还是旧的"，下次保存自动收敛；绝不会出现名字新、内容半截。
pub fn write_entry(entry: &Entry, dir: &Path, previous: Option<&Entry>) -> AppResult<PathBuf> {
    if !is_supported(entry.schema_version) {
        return Err(AppError::Invalid(format!(
            "不支持的 schemaVersion: {}",
            entry.schema_version
        )));
    }

    write_text_atomic(&note_path(dir), &entry.note)?;
    write_json_atomic(&entry_json_path(dir), entry)?;

    let current = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let wanted = naming::entry_dir_name(&entry.day, &entry.title);
    let may_rename = match previous {
        None => true,
        Some(prev) => current == naming::entry_dir_name(&prev.day, &prev.title),
    };

    if may_rename && current != wanted {
        if let Some(parent) = dir.parent() {
            let target = parent.join(naming::unique_child_name(parent, &wanted, None));
            fs::rename(dir, &target)?;
            return Ok(target);
        }
    }

    // 路径一律由调用方给（它已经按扫描定位过一次），这里不再二次推导
    Ok(dir.to_path_buf())
}

/// 换场景：把记录目录挪到新场景下（**归属就是物理位置**，改字段必须配一次真实的移动）。
/// 已经在目的地下就什么都不做。
pub fn move_entry_to_slot(vault: &Path, dir: &Path, folder_id: Option<&str>) -> AppResult<PathBuf> {
    let parent = entry_slot(vault, folder_id)?;
    if dir.parent() == Some(parent.as_path()) {
        return Ok(dir.to_path_buf());
    }

    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let target = parent.join(naming::unique_child_name(&parent, &name, None));
    fs::rename(dir, &target)?;
    Ok(target)
}

/// 删除：把整个记录目录挪进回收站（撤销 = 挪回来）。
///
/// 先把 `deletedAt` 写进去再挪 —— 这样回收站里的记录自己就知道"我是被删的"。
/// 目录名在回收站里保持不变，所以撤销能把用户手动改过的名字原样还回去。
pub fn trash_entry(vault: &Path, id: &str, deleted_at: &str) -> AppResult<PathBuf> {
    let dir = find_entry_dir(vault, id)?;
    let mut entry = read_entry_from(&dir)?;
    entry.mark_deleted(deleted_at);
    write_json_atomic(&entry_json_path(&dir), &entry)?;

    if in_trash(vault, &dir) {
        return Ok(dir); // 已经在回收站里了（重复删一次不该再挪）
    }

    let trash = trash_dir(vault);
    fs::create_dir_all(&trash)?;
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| entry.id.clone());
    let target = trash.join(naming::unique_child_name(&trash, &name, None));
    fs::rename(&dir, &target)?;
    Ok(target)
}

/// 撤销删除：把目录挪回原场景（原场景没了就回「未归类」），清掉 `deletedAt`。
///
/// **名字保持它在回收站里的样子** —— 用户手动改过的目录名不会因为删了再撤销就丢掉。
pub fn restore_entry(vault: &Path, id: &str, now: &str) -> AppResult<PathBuf> {
    let dir = find_entry_dir(vault, id)?;
    let mut entry = read_entry_from(&dir)?;
    entry.restore(now);

    if !in_trash(vault, &dir) {
        write_json_atomic(&entry_json_path(&dir), &entry)?;
        return Ok(dir);
    }

    let parent = match entry.folder_id.as_deref() {
        Some(folder_id) => {
            entry_slot(vault, Some(folder_id)).unwrap_or(ensure_uncategorized(vault)?)
        }
        None => ensure_uncategorized(vault)?,
    };

    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| naming::entry_dir_name(&entry.day, &entry.title));
    let target = parent.join(naming::unique_child_name(&parent, &name, None));

    fs::rename(&dir, &target)?;
    write_json_atomic(&entry_json_path(&target), &entry)?;
    Ok(target)
}

/// 扫描 Vault 下所有记录（含回收站里的 —— 它们的 `deletedAt` 有值）。
/// 原则：**一条坏数据不该毁掉整次扫描** —— 单独跳过并打日志。
pub fn list_entries(vault: &Path) -> AppResult<Vec<Entry>> {
    let mut out: Vec<Entry> = list_entry_dirs(vault)
        .into_iter()
        .filter_map(|dir| load_entry_dir(&dir))
        .collect();

    // 回收站里的也读出来：撤销 / 回收站视图都要用（命令层按 deletedAt 过滤）
    for dir in list_trash_dirs(vault) {
        if let Some(entry) = load_entry_dir(&dir) {
            out.push(entry);
        }
    }

    out.sort_by(|a, b| b.created_at.cmp(&a.created_at)); // 新的在前
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{FolderMeta, MediaMeta};

    fn temp_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("framevault-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    /// 建一个干净的 v2 仓库 + 一个场景，返回 (vault, 场景 id, 场景目录)
    fn vault_with_scene(name: &str, scene_name: &str) -> (PathBuf, String, PathBuf) {
        let vault = temp_vault(name);
        create_vault(&vault, "测试", "2026-01-01T00:00:00Z").unwrap();

        let folder = FolderMeta::new("f-1", scene_name, 0, Some("builtin.plain".into()));
        let scene_dir = vault.join(naming::scene_dir_name(scene_name));
        fs::create_dir_all(&scene_dir).unwrap();
        write_json_atomic(&folder_json_path(&scene_dir), &folder).unwrap();

        (vault, folder.id, scene_dir)
    }

    fn entry_in(dir: &Path, id: &str, day: &str, title: &str, note: &str) -> PathBuf {
        let mut entry = Entry::new(id, title, &format!("{day}T10:00:00+08:00"));
        entry.day = day.to_string();
        entry.set_note(note);
        entry.folder_id = Some("f-1".into());
        fs::create_dir_all(dir).unwrap();
        write_text_atomic(&note_path(dir), &entry.note).unwrap();
        write_json_atomic(&entry_json_path(dir), &entry).unwrap();
        dir.to_path_buf()
    }

    #[test]
    fn create_vault_lays_out_the_new_structure() {
        let dir = temp_vault("create");
        assert!(!is_vault(&dir));

        let meta = create_vault(&dir, "我的日记", "2026-01-01T00:00:00Z").unwrap();

        assert!(is_vault(&dir));
        assert!(dir.join(UNCATEGORIZED).is_dir(), "未归类容器要预建");
        assert!(trash_dir(&dir).is_dir());
        assert!(!dir.join("entries").exists(), "v1 的 entries/ 不再出现");
        assert!(!dir.join("folders").exists());
        assert!(!dir.join(".framevault/tombstones").exists(), "墓碑目录已废");
        assert_eq!(meta.name, "我的日记");
        assert_eq!(meta.layout, SCHEMA_VERSION);
        assert_eq!(meta.vault_id.len(), 36); // UUIDv7

        // 再建一次应该被拒绝，而不是覆盖掉已有身份
        assert!(create_vault(&dir, "重复", "2026-01-01T00:00:00Z").is_err());

        // 读回来一致
        let back = read_vault_meta(&dir).unwrap();
        assert_eq!(back.vault_id, meta.vault_id);
    }

    #[test]
    fn v1_vault_is_rejected_with_a_chinese_error() {
        let dir = temp_vault("old-vault");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            vault_meta_path(&dir),
            r#"{"schemaVersion":1,"vaultId":"x","name":"老仓库","createdAt":"2026-01-01T00:00:00Z"}"#,
        )
        .unwrap();

        let err = read_vault_meta(&dir).unwrap_err().to_string();
        assert!(err.contains("旧版布局"), "错误要说人话：{err}");
    }

    #[test]
    fn entry_roundtrip_keeps_note_in_md_only() {
        let (vault, _, scene_dir) = vault_with_scene("roundtrip", "晨跑打卡");
        let dir = entry_in(
            &scene_dir.join("2026-09-22 早跑 3km"),
            "e-1",
            "2026-09-22",
            "早跑 3km",
            "# 今天\n跑了五公里",
        );

        let back = read_entry(&vault, "e-1").unwrap();
        assert_eq!(back.title, "早跑 3km");
        assert_eq!(back.note, "# 今天\n跑了五公里");
        assert_eq!(back.day, "2026-09-22");

        let raw = fs::read_to_string(entry_json_path(&dir)).unwrap();
        assert!(!raw.contains("跑了五公里"), "正文只该在 note.md 里");

        assert!(!dir.join("note.md.tmp").exists());
    }

    #[test]
    fn note_write_normalizes_crlf() {
        let dir = temp_vault("crlf");
        fs::create_dir_all(&dir).unwrap();
        write_text_atomic(&note_path(&dir), "第一行\r\n第二行\r第三行").unwrap();
        assert_eq!(read_text(&note_path(&dir)), "第一行\n第二行\n第三行");
    }

    #[test]
    fn missing_note_reads_as_empty() {
        let dir = temp_vault("nonote");
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(read_text(&note_path(&dir)), "");
    }

    #[test]
    fn create_entry_names_the_dir_and_dedupes() {
        let (vault, folder_id, scene_dir) = vault_with_scene("naming", "晨跑打卡");

        let mut first = Entry::new("e-1", "早跑 3km", "2026-09-22T08:00:00+08:00");
        first.folder_id = Some(folder_id.clone());
        create_entry(&vault, &mut first).unwrap();

        let mut second = Entry::new("e-2", "早跑 3km", "2026-09-22T09:00:00+08:00");
        second.folder_id = Some(folder_id.clone());
        create_entry(&vault, &mut second).unwrap();

        assert!(scene_dir.join("2026-09-22 早跑 3km").is_dir());
        assert!(
            scene_dir.join("2026-09-22 早跑 3km (2)").is_dir(),
            "同一天同一个标题：加后缀，绝不覆盖"
        );
        assert_eq!(list_entries(&vault).unwrap().len(), 2);
    }

    #[test]
    fn create_entry_without_folder_goes_to_uncategorized() {
        let dir = temp_vault("uncat");
        create_vault(&dir, "测试", "2026-01-01T00:00:00Z").unwrap();

        let mut entry = Entry::new("e-1", "随记", "2026-09-22T08:00:00+08:00");
        create_entry(&dir, &mut entry).unwrap();

        assert!(dir.join(UNCATEGORIZED).join("2026-09-22 随记").is_dir());
        let back = read_entry(&dir, "e-1").unwrap();
        assert!(back.folder_id.is_none());
    }

    #[test]
    fn title_change_renames_the_dir() {
        let (vault, folder_id, scene_dir) = vault_with_scene("rename", "晨跑打卡");

        let mut entry = Entry::new("e-1", "旧标题", "2026-09-22T08:00:00+08:00");
        entry.folder_id = Some(folder_id);
        let dir = create_entry(&vault, &mut entry).unwrap();
        assert!(scene_dir.join("2026-09-22 旧标题").is_dir());

        let previous = entry.clone();
        entry.apply_update(Some("新标题"), None, "2026-09-23T08:00:00+08:00");
        let moved = write_entry(&entry, &dir, Some(&previous)).unwrap();

        assert_eq!(
            moved.file_name().unwrap().to_string_lossy(),
            "2026-09-22 新标题"
        );
        assert!(!scene_dir.join("2026-09-22 旧标题").exists());
        assert_eq!(read_entry(&vault, "e-1").unwrap().title, "新标题");
    }

    #[test]
    fn manual_rename_is_kept_forever() {
        let (vault, folder_id, scene_dir) = vault_with_scene("manual", "晨跑打卡");

        let mut entry = Entry::new("e-1", "早跑", "2026-09-22T08:00:00+08:00");
        entry.folder_id = Some(folder_id);
        create_entry(&vault, &mut entry).unwrap();

        // 用户在资源管理器里把它改成了自己的名字
        let manual = scene_dir.join("我自己起的名字");
        fs::rename(scene_dir.join("2026-09-22 早跑"), &manual).unwrap();

        // 应用内再改标题：目录名一个字都不许动
        let previous = entry.clone();
        entry.apply_update(Some("又改了个标题"), None, "2026-09-23T08:00:00+08:00");
        let moved = write_entry(&entry, &manual, Some(&previous)).unwrap();

        assert_eq!(moved, manual, "手动改过名的记录从此不再自动改名");
        assert_eq!(read_entry(&vault, "e-1").unwrap().title, "又改了个标题");
    }

    #[test]
    fn scan_follows_the_disk() {
        let (vault, _, scene_dir) = vault_with_scene("scan", "晨跑打卡");

        // 用户在场景目录下自己建了一条记录（我们完全不知道它）
        entry_in(
            &scene_dir.join("2026-08-01 手工建的"),
            "e-manual",
            "2026-08-01",
            "手工建的",
            "",
        );
        // 根下直接摆一条记录（没放进任何容器）
        entry_in(&vault.join("2026-07-01 摆在根下"), "e-root", "2026-07-01", "摆在根下", "");
        // 缺 entry.json 的目录：不是记录，忽略
        fs::create_dir_all(scene_dir.join("随便一个文件夹")).unwrap();
        // 坏 JSON：跳过而不是毁掉整次扫描
        let broken = scene_dir.join("坏掉的");
        fs::create_dir_all(&broken).unwrap();
        fs::write(entry_json_path(&broken), "{ 这不是 JSON").unwrap();

        let list = list_entries(&vault).unwrap();
        let ids: Vec<_> = list.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids.len(), 2, "只有两条真记录：{ids:?}");
        assert!(ids.contains(&"e-manual"));
        assert!(ids.contains(&"e-root"));
    }

    /// 「未归类」是**按名字**认的（写路径要一个说得准的落点）；
    /// 而扫描是**按结构**（任何容器里的记录都算数）—— 两件事刻意分开。
    #[test]
    fn uncategorized_is_found_by_name_but_scanning_follows_structure() {
        let dir = temp_vault("uncat-rename");
        create_vault(&dir, "测试", "2026-01-01T00:00:00Z").unwrap();

        // 用户把「未归类」改成了自己的名字：扫描照样认里面的记录
        let renamed = dir.join("随便记记");
        fs::rename(dir.join(UNCATEGORIZED), &renamed).unwrap();
        let mut loose = Entry::new("e-1", "随记", "2026-09-01T08:00:00+08:00");
        loose.day = "2026-09-01".into();
        create_entry(&dir, &mut loose).unwrap();
        fs::create_dir_all(&renamed).unwrap();
        fs::rename(dir.join(UNCATEGORIZED).join("2026-09-01 随记"), renamed.join("2026-09-01 随记"))
            .unwrap();
        assert_eq!(list_entries(&dir).unwrap().len(), 1, "容器改了名也认得出里面的记录");

        // 写路径仍然回到「未归类」（没有就补建一个）—— 落点必须确定
        let slot = ensure_uncategorized(&dir).unwrap();
        assert_eq!(slot, dir.join(UNCATEGORIZED));
        assert!(slot.is_dir());
    }

    #[test]
    fn loose_files_are_adopted_and_unknown_ones_left_alone() {
        let (vault, _, scene_dir) = vault_with_scene("adopt", "晨跑打卡");
        let dir = entry_in(&scene_dir.join("2026-09-22 早跑"), "e-1", "2026-09-22", "早跑", "");

        fs::write(dir.join("IMG_0001.JPG"), b"photo").unwrap();
        fs::write(dir.join("别人的笔记.txt"), b"hi").unwrap();

        let entry = read_entry(&vault, "e-1").unwrap();
        assert_eq!(entry.media.len(), 1);
        assert_eq!(entry.media[0].file, "IMG_0001.JPG");
        assert!(dir.join("别人的笔记.txt").is_file(), "不认识的文件不许动");

        // 对账结果落了盘：再读一次不会重复收养
        let again = read_entry(&vault, "e-1").unwrap();
        assert_eq!(again.media.len(), 1);

        // 文件被用户删了 → media[] 里也剔除
        fs::remove_file(dir.join("IMG_0001.JPG")).unwrap();
        assert!(read_entry(&vault, "e-1").unwrap().media.is_empty());
    }

    #[test]
    fn delete_moves_to_trash_and_restore_brings_it_back() {
        let (vault, folder_id, scene_dir) = vault_with_scene("trash", "晨跑打卡");

        let mut entry = Entry::new("e-1", "早跑", "2026-09-22T08:00:00+08:00");
        entry.folder_id = Some(folder_id.clone());
        create_entry(&vault, &mut entry).unwrap();

        trash_entry(&vault, "e-1", "2026-09-23T09:00:00+08:00").unwrap();
        assert!(!scene_dir.join("2026-09-22 早跑").exists());
        assert!(trash_entry_path(&vault, "2026-09-22 早跑").is_dir(), "回收站里保留原名");

        let listed = list_entries(&vault).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].is_deleted(), "回收站里的记录带着墓碑");
        assert_eq!(listed[0].note, "", "内容还在，读出来照样有");

        restore_entry(&vault, "e-1", "2026-09-24T09:00:00+08:00").unwrap();
        let back = read_entry(&vault, "e-1").unwrap();
        assert!(!back.is_deleted());
        assert_eq!(back.folder_id.as_deref(), Some(folder_id.as_str()));
        assert!(scene_dir.join("2026-09-22 早跑").is_dir(), "挪回原场景");
    }

    #[test]
    fn moving_between_scenes_moves_the_directory() {
        let (vault, folder_id, scene_dir) = vault_with_scene("move", "晨跑打卡");

        let mut entry = Entry::new("e-1", "早跑", "2026-09-22T08:00:00+08:00");
        entry.folder_id = None;
        let dir = create_entry(&vault, &mut entry).unwrap();
        assert!(dir.starts_with(vault.join(UNCATEGORIZED)));

        let moved = move_entry_to_slot(&vault, &dir, Some(&folder_id)).unwrap();
        assert_eq!(moved.parent(), Some(scene_dir.as_path()));
        assert!(!dir.exists(), "旧位置不该留下空目录");

        // 已经在目的地下：原地不动（重复调用是安全的）
        assert_eq!(move_entry_to_slot(&vault, &moved, Some(&folder_id)).unwrap(), moved);
    }

    #[test]
    fn restore_falls_back_to_uncategorized_when_scene_is_gone() {
        let (vault, folder_id, _) = vault_with_scene("restore-orphan", "晨跑打卡");

        let mut entry = Entry::new("e-1", "早跑", "2026-09-22T08:00:00+08:00");
        entry.folder_id = Some(folder_id);
        create_entry(&vault, &mut entry).unwrap();
        trash_entry(&vault, "e-1", "2026-09-23T09:00:00+08:00").unwrap();

        // 场景目录整个没了（用户自己删的）
        fs::remove_dir_all(vault.join("晨跑打卡")).unwrap();

        restore_entry(&vault, "e-1", "2026-09-24T09:00:00+08:00").unwrap();
        assert!(vault
            .join(UNCATEGORIZED)
            .join("2026-09-22 早跑")
            .is_dir());
    }

    #[test]
    fn media_roundtrip_through_entry_json() {
        let (vault, _, scene_dir) = vault_with_scene("media", "晨跑打卡");
        let dir = entry_in(&scene_dir.join("2026-09-22 早跑"), "e-1", "2026-09-22", "早跑", "正文");

        let meta = MediaMeta {
            schema_version: SCHEMA_VERSION,
            id: "m-1".into(),
            file: "2026-09-22_晨跑打卡_01.jpg".into(),
            name: "IMG_0001.JPG".into(),
            ext: "jpg".into(),
            mime: "image/jpeg".into(),
            bytes: 3,
            hash: "abc".into(),
            added_at: "2026-09-22T10:00:00+08:00".into(),
            ..Default::default()
        };
        fs::write(dir.join(&meta.file), b"img").unwrap();

        // 直接写 entry.json，不经过 read —— read 会把"陌生的媒体文件"收养进来，
        // 那是另一条测试的事；这里只验"media[] 能原样往返"
        let mut entry = Entry::new("e-1", "早跑", "2026-09-22T10:00:00+08:00");
        entry.day = "2026-09-22".into();
        entry.set_note("正文");
        entry.folder_id = Some("f-1".into());
        entry.media.push(meta.clone());
        write_json_atomic(&entry_json_path(&dir), &entry).unwrap();

        let back = read_entry(&vault, "e-1").unwrap();
        assert_eq!(back.media.len(), 1);
        assert_eq!(back.media[0].id, "m-1");
        assert_eq!(back.media[0].path_in(&dir), dir.join(&meta.file));
    }

    #[test]
    fn list_sorts_newest_first() {
        let (vault, _, scene_dir) = vault_with_scene("sort", "晨跑打卡");
        entry_in(&scene_dir.join("2026-01-01 旧"), "a", "2026-01-01", "旧", "");
        entry_in(&scene_dir.join("2026-03-01 新"), "b", "2026-03-01", "新", "");
        let list = list_entries(&vault).unwrap();
        assert_eq!(list[0].title, "新");
        assert_eq!(list[1].title, "旧");
    }

    #[test]
    fn tmp_files_never_survive_a_write() {
        let dir = temp_vault("tmp");
        fs::create_dir_all(&dir).unwrap();
        write_json_atomic(&dir.join("entry.json"), &serde_json::json!({"a":1})).unwrap();
        assert!(!dir.join("entry.json.tmp").exists());
    }
}
