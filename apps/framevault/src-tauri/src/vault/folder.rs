use super::model::SCHEMA_VERSION;
use super::naming::{self, FOLDER_FILE};
use super::storage;
use super::scene::PLAIN_SCENE;
use super::storage::{folder_dirs, folder_json_path, read_json, write_json_atomic};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

fn empty_object() -> serde_json::Value {
    serde_json::json!({})
}

/// 一个**文件夹** = 一堆记录 + 绑定的**场景**（记录方式）。
///
/// **名字就是目录名**（净化过的那份）：`name` 与磁盘上的目录名永远相等，
/// 所以不存在"界面上叫 A、磁盘上叫 B"这种事，也不需要额外的"目录名字段"。
///
/// - `order` / `pinned` 是用户数据（排序与置顶的结果），必须落盘；
/// - `scene_config` 是场景自己的配置（比如打卡的目标天数），核心不解释；
/// - `topic`（所属**主题**）**不落盘**：它就是"这个文件夹住在哪个目录下"，
///   由扫描时从父目录名填进来 —— 磁盘为准，跟记录的归属同一套规矩。
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

    /// 所属主题（= 上一层目录的名字）。`None` = 直接摆在仓库根下，没有主题。
    /// `#[serde(skip)]`：**不写进 folder.json**，它是从磁盘位置派生出来的事实。
    #[serde(skip)]
    pub topic: Option<String>,
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
            topic: None,
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

/// 列出全部文件夹：根下直接摆的 + 每个主题容器下的一级。
///
/// **名字与主题都以磁盘为准** —— 用户在资源管理器里改了目录名、或者把文件夹拖到别的主题下，
/// 扫一次就跟着认（这就是"主题不存字段、只认位置"换来的）。
pub fn list_folders(vault: &Path) -> AppResult<Vec<FolderMeta>> {
    let mut out = Vec::new();

    for (dir, topic) in folder_dirs(vault) {
        let file = folder_json_path(&dir);
        match read_json::<FolderMeta>(&file) {
            Ok(mut folder) => {
                if let Some(name) = dir.file_name() {
                    folder.name = name.to_string_lossy().to_string();
                }
                folder.topic = topic;
                out.push(folder);
            }
            Err(err) => eprintln!("[vault] 跳过损坏的文件夹 {}：{err}", file.display()),
        }
    }

    sort_folders(&mut out);
    Ok(out)
}

/// 按 id 读一个文件夹（**名字与主题都以磁盘位置为准**）
pub fn read_folder(vault: &Path, id: &str) -> AppResult<FolderMeta> {
    for (dir, topic) in folder_dirs(vault) {
        let Ok(mut folder) = read_json::<FolderMeta>(&folder_json_path(&dir)) else {
            continue;
        };
        if folder.id != id {
            continue;
        }
        if let Some(name) = dir.file_name() {
            folder.name = name.to_string_lossy().to_string();
        }
        folder.topic = topic;
        return Ok(folder);
    }

    Err(AppError::NotFound(format!("文件夹不存在：{id}")))
}

/// 新建文件夹：算出没被占用的目录名（撞名加 ` (2)`），在 `parent` 下建目录、写 `folder.json`。
///
/// `parent` 由调用方给：主题目录（`<Vault>/科研`）、或仓库根目录（= 没有主题）。
pub fn create_folder_in(folder: &FolderMeta, parent: &Path) -> AppResult<PathBuf> {
    let name = naming::unique_child_name(parent, &folder.dir_name(), None);
    let dir = parent.join(name);
    fs::create_dir_all(&dir)?;
    write_json_atomic(&folder_json_path(&dir), folder)?;
    Ok(dir)
}

/// 把文件夹写回它**当前所在的目录**，并按需改名（改名字之后）。
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

/// 删除文件夹。**里面还有记录时拒绝** —— 宁可让用户先处理，也不要出现"文件夹没了、记录跟着没了"。
///
/// 判据是**物理位置**（这个目录下有没有记录目录），不是 `entry.json` 里的归属字段：
/// 用户可能把记录目录手动拖进来了，那时字段还写着别的场景 —— 按字段数会漏，漏掉就是删数据。
pub fn delete_folder(vault: &Path, id: &str) -> AppResult<()> {
    let dir = storage::find_folder_dir(vault, id)?;
    let inside = super::storage::entry_dirs_in(&dir);
    if !inside.is_empty() {
        let name = dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| id.to_string());
        return Err(AppError::Invalid(format!(
            "「{name}」里还有 {} 条记录，请先把它们删掉或挪走",
            inside.len()
        )));
    }
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
        create_folder_in(&folder, vault).unwrap()
    }

    /// 放一个文件夹到某个主题下（主题目录要先在）
    fn add_in_topic(vault: &Path, topic: &str, folder: FolderMeta) -> PathBuf {
        let parent = vault.join(topic);
        fs::create_dir_all(&parent).unwrap();
        create_folder_in(&folder, &parent).unwrap()
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
    fn deleting_a_scene_with_records_inside_is_refused() {
        let vault = temp_vault("delete-nonempty");
        let dir = add(&vault, FolderMeta::new("f-1", "晨跑打卡", 0, None));

        // 目录里有一条记录 —— 而且它的 entry.json 里写的是**别的场景**（用户手动拖进来的那种）
        let record = dir.join("2026-09-22 早跑");
        fs::create_dir_all(&record).unwrap();
        fs::write(
            record.join("entry.json"),
            r#"{"schemaVersion":2,"id":"e-1","title":"早跑","day":"2026-09-22","tags":[],
                "createdAt":"2026-09-22T07:00:00+08:00","updatedAt":"2026-09-22T07:00:00+08:00",
                "folderId":"别的场景","fields":{}}"#,
        )
        .unwrap();

        let err = delete_folder(&vault, "f-1").unwrap_err().to_string();
        assert!(err.contains("还有 1 条记录"), "要说人话：{err}");
        assert!(dir.is_dir(), "拒绝之后目录必须原样还在");

        // 记录挪走之后才允许删
        fs::remove_dir_all(&record).unwrap();
        delete_folder(&vault, "f-1").unwrap();
        assert!(!dir.exists());
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
    fn topic_comes_from_the_parent_directory() {
        let vault = temp_vault("topic");
        add(&vault, FolderMeta::new("f-root", "根下的", 0, None));
        add_in_topic(&vault, "科研", FolderMeta::new("f-lab", "论文笔记", 1, None));
        add_in_topic(&vault, "打卡", FolderMeta::new("f-run", "跑步打卡", 2, None));

        let list = list_folders(&vault).unwrap();
        let of = |id: &str| list.iter().find(|f| f.id == id).unwrap().topic.clone();

        assert_eq!(of("f-root"), None, "根下直接摆的文件夹没有主题");
        assert_eq!(of("f-lab"), Some("科研".to_string()));
        assert_eq!(of("f-run"), Some("打卡".to_string()));

        // 主题不写进 folder.json —— 它是位置派生的事实
        let raw = fs::read_to_string(vault.join("科研").join("论文笔记").join("folder.json")).unwrap();
        assert!(!raw.contains("topic"), "folder.json 里不该出现 topic：{raw}");
    }

    #[test]
    fn moving_a_folder_on_disk_changes_its_topic() {
        let vault = temp_vault("topic-move");
        let dir = add_in_topic(&vault, "科研", FolderMeta::new("f-1", "论文笔记", 0, None));
        assert_eq!(list_folders(&vault).unwrap()[0].topic.as_deref(), Some("科研"));

        // 用户在资源管理器里把它拖到另一个主题下 —— 那就是"换了主题"
        fs::create_dir_all(vault.join("打卡")).unwrap();
        fs::rename(&dir, vault.join("打卡").join("论文笔记")).unwrap();
        assert_eq!(list_folders(&vault).unwrap()[0].topic.as_deref(), Some("打卡"));

        // 再拖到根下 —— 没有主题了
        fs::rename(vault.join("打卡").join("论文笔记"), vault.join("论文笔记")).unwrap();
        assert_eq!(list_folders(&vault).unwrap()[0].topic, None);
    }

    #[test]
    fn topic_lifecycle_create_rename_delete() {
        let vault = temp_vault("topic-lifecycle");

        crate::vault::create_topic(&vault, "科研").unwrap();
        assert!(vault.join("科研").is_dir());
        assert!(!vault.join("科研").join("folder.json").exists(), "主题不写标记文件");

        // 空主题可以改名字
        crate::vault::rename_topic(&vault, "科研", "实验室").unwrap();
        assert!(vault.join("实验室").is_dir());
        assert!(!vault.join("科研").exists());

        // 空主题可以删
        crate::vault::delete_topic(&vault, "实验室").unwrap();
        assert!(!vault.join("实验室").exists());

        // 里面有东西就删不掉
        add_in_topic(&vault, "科研", FolderMeta::new("f-1", "论文笔记", 0, None));
        let err = crate::vault::delete_topic(&vault, "科研").unwrap_err().to_string();
        assert!(err.contains("还有 1 项内容"), "要说人话：{err}");
        assert!(vault.join("科研").is_dir(), "拒绝之后必须原样还在");

        // 不存在的主题要明确报错
        assert!(crate::vault::rename_topic(&vault, "没有这个", "x").is_err());
        assert!(crate::vault::delete_topic(&vault, "没有这个").is_err());
    }

    #[test]
    fn same_topic_name_twice_gets_a_suffix() {
        let vault = temp_vault("topic-dedupe");
        crate::vault::create_topic(&vault, "科研").unwrap();
        crate::vault::create_topic(&vault, "科研").unwrap();
        assert!(vault.join("科研").is_dir());
        assert!(vault.join("科研 (2)").is_dir());
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
