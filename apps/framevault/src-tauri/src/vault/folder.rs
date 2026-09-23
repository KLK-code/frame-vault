use super::model::SCHEMA_VERSION;
use super::naming::{self, FOLDER_FILE};
use super::scene::PLAIN_SCENE;
use super::storage::{folder_json_path, read_json, root_dirs, write_json_atomic};
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

fn empty_object() -> serde_json::Value {
    serde_json::json!({})
}

/// 一个**场景** = 根下一个文件夹 + 绑定的主题。
///
/// **名字就是目录名**（净化过的那份）：`name` 与磁盘上的目录名永远相等，
/// 所以不存在"界面上叫 A、磁盘上叫 B"这种事，也不需要额外的"目录名字段"。
///
/// - `order` / `pinned` 是用户数据（排序与置顶的结果），必须落盘；
/// - `scene_config` 是主题自己的配置（比如挑战的目标天数），核心不解释。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMeta {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub order: i64,
    #[serde(default)]
    pub pinned: bool,
    /// 绑定的主题；None 或空 = 内置普通记录
    #[serde(default)]
    pub scene: Option<String>,
    #[serde(default = "empty_object")]
    pub scene_config: serde_json::Value,
}

impl FolderMeta {
    pub fn new(id: &str, name: &str, order: i64, scene: Option<String>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            id: id.to_string(),
            name: naming::scene_dir_name(name),
            order,
            pinned: false,
            scene: scene.filter(|s| !s.trim().is_empty()),
            scene_config: empty_object(),
        }
    }

    /// 改名：**净化后写回**，与磁盘目录名保持一致
    pub fn set_name(&mut self, name: &str) {
        self.name = naming::scene_dir_name(name);
    }

    /// 这个场景在磁盘上的目录名
    pub fn dir_name(&self) -> String {
        naming::scene_dir_name(&self.name)
    }

    /// 这个场景最终生效的主题 id（没绑定就是内置普通记录）
    pub fn effective_scene(&self) -> String {
        self.scene
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| PLAIN_SCENE.to_string())
    }
}

// ── 路径约定（名字派生）──

pub fn folder_dir(vault: &Path, name: &str) -> PathBuf {
    vault.join(naming::scene_dir_name(name))
}

pub fn folder_path(vault: &Path, name: &str) -> PathBuf {
    folder_dir(vault, name).join(FOLDER_FILE)
}

// ── 读写 ──

/// 列出全部场景：扫根下一级带 `folder.json` 的目录。
/// **名字以磁盘为准** —— 用户在资源管理器里把场景目录改了名，扫一次就跟着认。
pub fn list_folders(vault: &Path) -> AppResult<Vec<FolderMeta>> {
    let mut out = Vec::new();

    for dir in root_dirs(vault) {
        let file = folder_json_path(&dir);
        if !file.is_file() {
            continue; // 没有 folder.json = 未归类容器，不是场景
        }
        match read_json::<FolderMeta>(&file) {
            Ok(mut folder) => {
                if let Some(name) = dir.file_name() {
                    folder.name = name.to_string_lossy().to_string();
                }
                out.push(folder);
            }
            Err(err) => eprintln!("[vault] 跳过损坏的场景 {}：{err}", file.display()),
        }
    }

    sort_folders(&mut out);
    Ok(out)
}

/// 按 id 读一个场景（**名字以磁盘目录名为准**）
pub fn read_folder(vault: &Path, id: &str) -> AppResult<FolderMeta> {
    let dir = super::storage::find_folder_dir(vault, id)?;
    let mut folder: FolderMeta = read_json(&folder_json_path(&dir))?;
    if let Some(name) = dir.file_name() {
        folder.name = name.to_string_lossy().to_string();
    }
    Ok(folder)
}

/// 新建场景：算出没被占用的目录名（撞名加 ` (2)`），建目录、写 `folder.json`。
pub fn create_folder(vault: &Path, folder: &FolderMeta) -> AppResult<PathBuf> {
    let name = naming::unique_child_name(vault, &folder.dir_name(), None);
    let dir = vault.join(name);
    fs::create_dir_all(&dir)?;
    write_json_atomic(&folder_json_path(&dir), folder)?;
    Ok(dir)
}

/// 把场景写回它**当前所在的目录**，并按需改名（改场景名之后）。
///
/// 手动改名的判定跟记录同一条规矩：只有"当前目录名 == 净化后的旧名字"才敢自动改名，
/// 不相等说明用户自己改过 —— 那就只写内容，永久不动目录名。
pub fn save_folder(
    folder: &FolderMeta,
    dir: &Path,
    previous_name: &str,
) -> AppResult<PathBuf> {
    write_json_atomic(&folder_json_path(dir), folder)?;

    let current = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let may_rename = current == naming::scene_dir_name(previous_name);
    let wanted = folder.dir_name();

    if may_rename && current != wanted {
        if let Some(parent) = dir.parent() {
            let target = parent.join(naming::unique_child_name(parent, &wanted, None));
            fs::rename(dir, &target)?;
            return Ok(target);
        }
    }

    Ok(dir.to_path_buf())
}

/// 删除场景本身（**不碰记录**，调用方要先确认里面没有记录）
pub fn delete_folder(vault: &Path, id: &str) -> AppResult<()> {
    let dir = super::storage::find_folder_dir(vault, id)?;
    fs::remove_dir_all(dir)?;
    Ok(())
}

// ── 排序 ──

/// 置顶优先 → order 小的在前 → 名称
pub fn sort_folders(list: &mut [FolderMeta]) {
    list.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then(a.order.cmp(&b.order))
            .then(a.name.cmp(&b.name))
    });
}

/// 下一个可用的 order（仓库层面是平的，所以没有"同级"一说）
pub fn next_order(all: &[FolderMeta]) -> i64 {
    all.iter().map(|f| f.order + 1).max().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{create_vault, entry_slot, UNCATEGORIZED};

    fn temp_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("framevault-folder-{name}"));
        let _ = fs::remove_dir_all(&dir);
        create_vault(&dir, "测试", "2026-01-01T00:00:00Z").unwrap();
        dir
    }

    fn add(vault: &Path, folder: FolderMeta) -> PathBuf {
        create_folder(vault, &folder).unwrap()
    }

    #[test]
    fn folders_are_directories_under_the_root() {
        let vault = temp_vault("layout");

        add(&vault, FolderMeta::new("f-travel", "旅行", 1, Some("builtin.plain".into())));
        add(&vault, FolderMeta::new("f-diary", "日记", 0, None));
        let mut pinned = FolderMeta::new("f-pinned", "置顶的", 9, None);
        pinned.pinned = true;
        add(&vault, pinned);

        assert!(vault.join("旅行").join("folder.json").is_file());
        assert!(!vault.join("folders").exists(), "v1 的 folders/ 不再出现");

        let list = list_folders(&vault).unwrap();
        assert_eq!(list.len(), 3, "未归类容器不带 folder.json，不算场景");
        assert_eq!(list[0].name, "置顶的", "置顶的永远排最前");
        assert_eq!(list[1].name, "日记", "其余按 order");
        assert_eq!(list[2].name, "旅行");
    }

    #[test]
    fn creating_two_scenes_with_the_same_name_never_overwrites() {
        let vault = temp_vault("dedupe");
        add(&vault, FolderMeta::new("f-1", "晨跑打卡", 0, None));
        add(&vault, FolderMeta::new("f-2", "晨跑打卡", 1, None));

        assert!(vault.join("晨跑打卡").is_dir());
        assert!(vault.join("晨跑打卡 (2)").is_dir());
        assert_eq!(list_folders(&vault).unwrap().len(), 2, "两个场景都得在");
    }

    #[test]
    fn scene_name_is_sanitized() {
        let vault = temp_vault("sanitize");
        add(&vault, FolderMeta::new("f-1", "跑/步:打卡", 0, None));
        assert!(vault.join("跑_步_打卡").is_dir());

        let folder = &list_folders(&vault).unwrap()[0];
        assert_eq!(folder.name, "跑_步_打卡", "名字与目录名相等");

        // 空名字兜底，不至于建出一个没有名字的目录
        add(&vault, FolderMeta::new("f-2", "   ", 1, None));
        assert!(vault.join("未命名场景").is_dir());
    }

    #[test]
    fn rename_moves_the_directory() {
        let vault = temp_vault("rename");
        let dir = add(&vault, FolderMeta::new("f-1", "旧名字", 0, None));

        let mut folder = list_folders(&vault).unwrap().remove(0);
        folder.set_name("新名字");
        let moved = save_folder(&folder, &dir, "旧名字").unwrap();

        assert_eq!(moved.file_name().unwrap().to_string_lossy(), "新名字");
        assert!(!vault.join("旧名字").exists());
        assert!(vault.join("新名字").join("folder.json").is_file());
    }

    /// 用户手动把场景目录改了名：**应用认磁盘上那个名字**，不会把它改回去。
    /// 场景名只会由用户自己改，所以"永久保留"在这里就是"以磁盘为准"。
    #[test]
    fn manual_rename_of_a_scene_is_adopted() {
        let vault = temp_vault("manual");
        let dir = add(&vault, FolderMeta::new("f-1", "早先的名字", 0, None));

        let manual = vault.join("我自己改的");
        fs::rename(&dir, &manual).unwrap();

        assert_eq!(list_folders(&vault).unwrap()[0].name, "我自己改的");

        // 只改别的字段（名字传原样）→ 目录名一个字都不动
        let mut folder = list_folders(&vault).unwrap().remove(0);
        folder.pinned = true;
        let moved = save_folder(&folder, &manual, &folder.name).unwrap();
        assert_eq!(moved, manual);

        // 用户在应用里又改名字 → 这次是真改名，跟着走
        folder.set_name("应用里改的");
        let renamed = save_folder(&folder, &manual, "我自己改的").unwrap();
        assert_eq!(renamed.file_name().unwrap().to_string_lossy(), "应用里改的");
    }

    #[test]
    fn deleting_a_scene_removes_its_directory() {
        let vault = temp_vault("delete");
        add(&vault, FolderMeta::new("f-1", "日记", 0, None));
        add(&vault, FolderMeta::new("f-2", "旅行", 1, None));

        delete_folder(&vault, "f-1").unwrap();
        assert!(!vault.join("日记").exists());
        assert_eq!(list_folders(&vault).unwrap().len(), 1);

        assert!(delete_folder(&vault, "没有这个").is_err());
    }

    #[test]
    fn uncategorized_is_not_a_scene() {
        let vault = temp_vault("uncat");
        add(&vault, FolderMeta::new("f-1", "日记", 0, None));

        assert!(vault.join(UNCATEGORIZED).is_dir());
        assert_eq!(
            list_folders(&vault).unwrap().len(),
            1,
            "未归类容器不该出现在场景列表里"
        );
        assert_eq!(
            entry_slot(&vault, None).unwrap(),
            vault.join(UNCATEGORIZED)
        );
    }

    #[test]
    fn effective_scene_falls_back_to_plain() {
        let bound = FolderMeta::new("a", "挑战", 0, Some("builtin.challenge".into()));
        assert_eq!(bound.effective_scene(), "builtin.challenge");

        let unbound = FolderMeta::new("b", "随手记", 0, None);
        assert_eq!(unbound.effective_scene(), PLAIN_SCENE);

        // 空字符串或纯空格也算"没绑定"
        let blank = FolderMeta::new("c", "空白", 0, Some("   ".into()));
        assert_eq!(blank.effective_scene(), PLAIN_SCENE);
    }

    #[test]
    fn next_order_appends_at_the_end() {
        let a = FolderMeta::new("a", "a", 0, None);
        let b = FolderMeta::new("b", "b", 5, None);
        assert_eq!(next_order(&[a, b]), 6);
        assert_eq!(next_order(&[]), 0);
    }

    /// 老文件里如果有已废弃的字段（比如 parentId），必须还能读出来
    #[test]
    fn old_folder_with_removed_fields_still_loads() {
        let old = r#"{
            "schemaVersion": 2,
            "id": "old-1",
            "name": "老场景",
            "parentId": "some-parent",
            "order": 2,
            "pinned": false,
            "scene": null
        }"#;

        let folder: FolderMeta = serde_json::from_str(old).unwrap();
        assert_eq!(folder.name, "老场景");
        assert_eq!(folder.order, 2);
        assert_eq!(folder.effective_scene(), PLAIN_SCENE);
    }
}
