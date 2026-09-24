//! 存储规范 v2 的**端到端**验收：走一遍用户真实会做的事，每一步都看磁盘。
//!
//! 领域层的单测在 `src/vault/*.rs` 里（净化、模板、去重、对账…）；
//! 这个文件只做一件事：**把整个生命周期连起来跑，并断言磁盘上真的长成那样**。

use framevault_lib::vault::{
    create_entry, create_folder_in, create_topic, create_vault, delete_topic, entry_json_path,
    import_into_entry, list_entries, list_folders, media_file_stem, move_entry_to_slot, read_entry,
    read_folder, rename_topic, restore_entry, save_folder, trash_entry, write_entry,
    write_json_atomic, Entry, FolderMeta, NameVars, SCHEMA_VERSION, UNCATEGORIZED,
};
use std::fs;
use std::path::{Path, PathBuf};

fn temp_vault(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("framevault-e2e-{name}"));
    let _ = fs::remove_dir_all(&dir);
    dir
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("读不到 {}：{e}", path.display()))
}

fn names(dir: &Path) -> Vec<String> {
    let mut out: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|item| item.file_name().to_string_lossy().to_string())
        .collect();
    out.sort();
    out
}

#[test]
fn full_lifecycle_produces_the_readable_layout() {
    let vault = temp_vault("lifecycle");

    // ── 1. 新建仓库：预建「未归类」与回收站，身份文件里写明布局版本 ──
    let meta = create_vault(&vault, "我的日记", "2026-09-22T10:00:00+08:00").unwrap();
    assert_eq!(meta.schema_version, SCHEMA_VERSION);
    assert_eq!(meta.layout, SCHEMA_VERSION);
    assert_eq!(
        names(&vault),
        vec![".framevault".to_string(), "vault.json".to_string(), UNCATEGORIZED.to_string()]
    );
    assert!(vault.join(".framevault/trash").is_dir());
    assert!(!vault.join("entries").exists());
    assert!(!vault.join("folders").exists());
    assert!(!vault.join(".framevault/tombstones").exists());

    // ── 2. 新建场景：一个目录 + folder.json ──
    let folder = FolderMeta::new("f-run", "晨跑/打卡", 0, Some("builtin.challenge".into()));
    let scene_dir = create_folder_in(&vault, &folder, &vault).unwrap();
    assert_eq!(
        scene_dir.file_name().unwrap().to_string_lossy(),
        "晨跑_打卡",
        "场景名净化后就是目录名"
    );
    assert!(scene_dir.join("folder.json").is_file());

    // ── 3. 新建记录：目录名 = 创建日 + 标题，正文落 note.md ──
    let mut entry = Entry::new("e-1", "早跑 3km", "2026-09-22T07:30:00+08:00");
    entry.day = "2026-09-22".into();
    entry.folder_id = Some("f-run".into());
    entry.scene = Some("builtin.challenge".into());
    entry.set_note("# 今天\n\n跑了五公里，配速 6'00\"。");
    let entry_dir = create_entry(&vault, &mut entry).unwrap();

    assert_eq!(
        entry_dir.file_name().unwrap().to_string_lossy(),
        "2026-09-22 早跑 3km"
    );
    assert_eq!(names(&entry_dir), vec!["entry.json".to_string(), "note.md".to_string()]);

    let raw = read(&entry_dir.join("entry.json"));
    assert!(raw.contains("\"schemaVersion\": 2"));
    assert!(!raw.contains("跑了五公里"), "正文不许在 entry.json 里出现第二次");
    assert!(read(&entry_dir.join("note.md")).starts_with("# 今天"), "正文在 note.md 里");

    // ── 4. 导入照片：按模板命名，本体就住在记录目录里 ──
    let source = vault.join("IMG_0001.JPG");
    fs::write(&source, vec![0u8; 64]).unwrap();
    let vars = NameVars {
        date: "2026-09-22".into(),
        scene: "晨跑_打卡".into(),
        title: "早跑 3km".into(),
        n: 1,
        ..Default::default()
    };
    let media = import_into_entry(
        &entry_dir,
        &source,
        Some("{date}_{scene}_{n}"),
        &vars,
        "2026-09-22T07:35:00+08:00",
    )
    .unwrap();

    assert_eq!(media.file, "2026-09-22_晨跑_打卡_01.jpg");
    assert!(entry_dir.join(&media.file).is_file());
    assert_eq!(media.file, "2026-09-22_晨跑_打卡_01.jpg", "JSON 记的是导入后的名字");

    // 媒体元数据跟着记录走（命令层就是这么做的：push 完写回 entry.json）
    let mut stored = Entry::new("e-1", "早跑 3km", "2026-09-22T07:30:00+08:00");
    stored.day = "2026-09-22".into();
    stored.folder_id = Some("f-run".into());
    stored.set_note("# 今天

跑了五公里，配速 6'00\"。");
    stored.media.push(media.clone());
    write_json_atomic(&entry_json_path(&entry_dir), &stored).unwrap();

    let back = read_entry(&vault, "e-1").unwrap();
    assert_eq!(back.media.len(), 1);
    assert_eq!(back.media[0].file, "2026-09-22_晨跑_打卡_01.jpg");

    // ── 5. 改标题 → 目录跟着改名 ──
    let previous = back.clone();
    let mut edited = back.clone();
    edited.set_title("早跑 3.2km");
    let moved = write_entry(&edited, &entry_dir, Some(&previous)).unwrap();
    assert_eq!(
        moved.file_name().unwrap().to_string_lossy(),
        "2026-09-22 早跑 3.2km"
    );
    assert!(!entry_dir.exists(), "旧目录名不该留着");
    assert!(moved.join(&media.file).is_file(), "改名不动里面的文件");
    assert_eq!(
        names(scene_dir.as_path()),
        vec!["2026-09-22 早跑 3.2km".to_string(), "folder.json".to_string()],
        "场景目录里只有它自己的 folder.json 和这条记录"
    );

    // ── 6. 用户手动改名 → 之后再改标题也不动目录名 ──
    let manual = scene_dir.join("我自己起的名字");
    fs::rename(&moved, &manual).unwrap();
    let previous = read_entry(&vault, "e-1").unwrap();
    let mut edited = previous.clone();
    edited.set_title("再改一次标题");
    let kept = write_entry(&edited, &manual, Some(&previous)).unwrap();
    assert_eq!(kept, manual, "手动改过名的记录永久保留那个名字");

    // ── 7. 换场景 = 真的搬家 ──
    let travel_parent = vault.join("旅行");
    fs::create_dir_all(&travel_parent).unwrap();
    let travel = create_folder_in(
        &vault,
        &FolderMeta::new("f-travel", "旅行", 1, None),
        &travel_parent,
    )
    .unwrap();
    let landing = move_entry_to_slot(&vault, &kept, Some("f-travel")).unwrap();
    assert_eq!(landing.parent(), Some(travel.as_path()));
    // 命令层就是这么做的：换场景 = 移动目录 + 改 entry.json 里的归属
    let mut relocated = read_entry(&vault, "e-1").unwrap();
    relocated.folder_id = Some("f-travel".into());
    write_entry(&relocated, &landing, Some(&relocated)).unwrap();
    assert_eq!(
        names(&travel),
        vec!["folder.json".to_string(), "我自己起的名字".to_string()]
    );

    // ── 8. 没归属的记录住「未归类」 ──
    let mut loose = Entry::new("e-2", "随手记", "2026-09-23T21:00:00+08:00");
    loose.day = "2026-09-23".into();
    let loose_dir = create_entry(&vault, &mut loose).unwrap();
    assert_eq!(loose_dir.parent(), Some(vault.join(UNCATEGORIZED).as_path()));

    // ── 9. 删除 = 挪进回收站；撤销 = 挪回原场景 ──
    trash_entry(&vault, "e-1", "2026-09-24T09:00:00+08:00").unwrap();
    assert!(
        vault.join(".framevault/trash/我自己起的名字").is_dir(),
        "回收站里保留原来的目录名 —— 撤销才能把它原样还回去"
    );
    assert_eq!(names(&travel), vec!["folder.json".to_string()], "场景里已经没有它了");
    let listed = list_entries(&vault).unwrap();
    assert_eq!(listed.len(), 2, "回收站里的那条也要能被读到（撤销要用）");
    assert!(listed.iter().any(|e| e.id == "e-1" && e.is_deleted()));

    restore_entry(&vault, "e-1", "2026-09-24T09:05:00+08:00").unwrap();
    assert!(travel.join("我自己起的名字").is_dir(), "挪回原场景，名字照旧");
    assert!(!vault.join(".framevault/trash/我自己起的名字").exists());
    let restored = read_entry(&vault, "e-1").unwrap();
    assert!(!restored.is_deleted());
    assert!(restored.note.starts_with("# 今天"), "正文一个字都没丢");

    // ── 10. 磁盘上一眼看得到的东西 ──
    println!("--- {}", vault.display());
    println!("{}", fs::read_to_string(vault.join("vault.json")).unwrap());
    for scene in [&scene_dir, &travel] {
        println!("{} → {:?}", scene.display(), names(scene));
    }
    println!("未归类 → {:?}", names(&vault.join(UNCATEGORIZED)));

    // 场景列表：两个场景，名字都来自磁盘目录名
    let folders = list_folders(&vault).unwrap();
    assert_eq!(folders.len(), 2);
    assert!(folders.iter().any(|f| f.name == "晨跑_打卡"));
    assert!(folders.iter().any(|f| f.name == "旅行"));
    assert_eq!(read_folder(&vault, "f-run").unwrap().name, "晨跑_打卡");
}

/// 主题层：外层一个目录（不带 folder.json），里面才是文件夹 —— 磁盘只多这一层，
/// `folder.json` 一个字段都不加（主题由位置派生）。
#[test]
fn topic_layer_is_just_a_directory() {
    let vault = temp_vault("topics");
    create_vault(&vault, "测试", "2026-09-23T10:00:00+08:00").unwrap();

    // 建两个主题、一个根下的文件夹（没有主题）
    let lab = create_topic(&vault, "科研").unwrap();
    create_topic(&vault, "打卡").unwrap();
    let at_root = create_folder_in(&vault, &FolderMeta::new("f-root", "随手记", 0, None), &vault).unwrap();
    let under = create_folder_in(
        &vault,
        &FolderMeta::new("f-lab", "论文笔记", 1, None),
        &lab,
    )
    .unwrap();

    assert!(!lab.join("folder.json").exists(), "主题不写标记文件");
    assert!(under.join("folder.json").is_file());

    // 记录照旧住在文件夹里
    let mut entry = Entry::new("e-1", "第一篇", "2026-09-23T21:00:00+08:00");
    entry.day = "2026-09-23".into();
    entry.folder_id = Some("f-lab".into());
    entry.set_note("# 第一次消融实验");
    create_entry(&vault, &mut entry).unwrap();
    assert!(under.join("2026-09-23 第一篇").join("note.md").is_file());

    // 列表：谁在哪个主题下，一眼看得出来
    let folders = list_folders(&vault).unwrap();
    let topic_of = |id: &str| folders.iter().find(|f| f.id == id).unwrap().topic.clone();
    assert_eq!(topic_of("f-lab"), Some("科研".to_string()));
    assert_eq!(topic_of("f-root"), None, "根下的文件夹没有主题");

    // 主题改名 = 改目录名；里面的文件夹跟着换主题（位置变了）
    rename_topic(&vault, "科研", "实验室").unwrap();
    assert!(!vault.join("科研").exists());
    assert!(vault.join("实验室").join("论文笔记").join("folder.json").is_file());
    assert_eq!(
        list_folders(&vault).unwrap().iter().find(|f| f.id == "f-lab").unwrap().topic,
        Some("实验室".to_string())
    );

    // 空主题能删；有内容的主题删不掉
    delete_topic(&vault, "打卡").unwrap();
    let err = delete_topic(&vault, "实验室").unwrap_err().to_string();
    assert!(err.contains("还有 1 项内容"), "{err}");

    // 在资源管理器里把文件夹拖到根下 = 它没有主题了（磁盘为准）
    fs::rename(
        vault.join("实验室").join("论文笔记"),
        vault.join("论文笔记"),
    )
    .unwrap();
    assert_eq!(
        list_folders(&vault).unwrap().iter().find(|f| f.id == "f-lab").unwrap().topic,
        None
    );

    println!("--- {}", vault.display());
    for dir in [&vault, &vault.join("实验室"), &at_root] {
        println!("{} → {:?}", dir.display(), names(dir));
    }
}

#[test]
fn scene_rename_follows_the_user() {
    let vault = temp_vault("scene-rename");
    create_vault(&vault, "测试", "2026-09-22T10:00:00+08:00").unwrap();

    let folder = FolderMeta::new("f-1", "晨跑打卡", 0, None);
    let dir = create_folder_in(&vault, &folder, &vault).unwrap();

    // 应用内改名 → 目录跟着走
    let mut renamed = read_folder(&vault, "f-1").unwrap();
    let previous_name = renamed.name.clone();
    renamed.set_name("晨间跑步");
    let moved = save_folder(&vault, &renamed, &dir, &previous_name).unwrap();
    assert_eq!(moved.file_name().unwrap().to_string_lossy(), "晨间跑步");

    // 资源管理器里手动改名 → 应用认磁盘上那个名字，不会改回去
    let manual = vault.join("我自己的分类");
    fs::rename(&moved, &manual).unwrap();
    assert_eq!(list_folders(&vault).unwrap()[0].name, "我自己的分类");

    // 只改别的字段（名字原样传）→ 目录名一个字都不动
    let mut pinned = list_folders(&vault).unwrap().remove(0);
    pinned.pinned = true;
    assert_eq!(save_folder(&vault, &pinned, &manual, &pinned.name).unwrap(), manual);
}

#[test]
fn media_naming_template_falls_back_when_variables_are_missing() {
    let vault = temp_vault("media-template");
    create_vault(&vault, "测试", "2026-09-22T10:00:00+08:00").unwrap();

    let mut entry = Entry::new("e-1", "", "2026-09-22T07:30:00+08:00");
    entry.day = "2026-09-22".into();
    let dir = create_entry(&vault, &mut entry).unwrap();

    let source = vault.join("a.jpg");
    fs::write(&source, vec![0u8; 32]).unwrap();

    // 旅行主题的模板：取不到地点 → 那个变量自己消失，名字仍可读
    let vars = NameVars {
        date: "2026-09-22".into(),
        scene: "旅行".into(),
        title: String::new(),
        n: 1,
        ..Default::default()
    };
    let missing = import_into_entry(
        &dir,
        &source,
        Some("{date}_{field:location}_{n}"),
        &vars,
        "2026-09-22T08:00:00+08:00",
    )
    .unwrap();
    assert_eq!(missing.file, "2026-09-22_01.jpg");
    assert_eq!(media_file_stem(Some("{date}_{field:location}_{n}"), &vars), "2026-09-22_01");

    // 有地点时按地点命名
    let mut with_location = vars.clone();
    with_location.fields = serde_json::json!({ "builtin.travel": { "location": "西湖" } });
    let named = import_into_entry(
        &dir,
        &source,
        Some("{date}_{field:location}_{n}"),
        &with_location,
        "2026-09-22T08:01:00+08:00",
    )
    .unwrap();
    assert_eq!(named.file, "2026-09-22_西湖_01.jpg");

    // 同一天同一模板再来一张：序号 +1（模板里的 {n} 由调用方给）
    let mut second = with_location.clone();
    second.n = 2;
    assert_eq!(
        media_file_stem(Some("{date}_{field:location}_{n}"), &second),
        "2026-09-22_西湖_02"
    );
}
