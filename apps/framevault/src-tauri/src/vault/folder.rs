use super::model::SCHEMA_VERSION;
use super::scene::PLAIN_SCENE;
use super::storage::{read_json, write_json_atomic};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

fn empty_object() -> serde_json::Value {
    serde_json::json!({})
}

/// 一个**场景** = 一个文件夹 + 绑定的主题。
///
/// - `scene` 为 None 表示"继承父文件夹的场景"；
/// - `order` / `pinned` 是**用户数据**（拖拽排序与置顶的结果），必须落盘；
/// - `scene_config` 是主题自己的配置（比如挑战的目标天数），核心不解释。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMeta {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub order: i64,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub scene: Option<String>,
    #[serde(default = "empty_object")]
    pub scene_config: serde_json::Value,
}

impl FolderMeta {
    pub fn new(id: &str, name: &str, parent_id: Option<String>, order: i64) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            id: id.to_string(),
            name: name.to_string(),
            parent_id,
            order,
            pinned: false,
            scene: None,
            scene_config: empty_object(),
        }
    }
}

// ── 路径约定 ──

pub fn folders_dir(vault: &Path) -> PathBuf {
    vault.join("folders")
}

pub fn folder_dir(vault: &Path, id: &str) -> PathBuf {
    folders_dir(vault).join(id)
}

pub fn folder_path(vault: &Path, id: &str) -> PathBuf {
    folder_dir(vault, id).join("folder.json")
}

// ── 读写 ──

pub fn write_folder(vault: &Path, folder: &FolderMeta) -> AppResult<PathBuf> {
    let path = folder_path(vault, &folder.id);
    write_json_atomic(&path, folder)?;
    Ok(path)
}

pub fn read_folder(vault: &Path, id: &str) -> AppResult<FolderMeta> {
    read_json(&folder_path(vault, id))
}

/// 列出全部场景（已排序：置顶优先 → order → 名称）
pub fn list_folders(vault: &Path) -> AppResult<Vec<FolderMeta>> {
    let dir = folders_dir(vault);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for item in fs::read_dir(&dir)? {
        let path = item?.path();
        if !path.is_dir() {
            continue;
        }
        let file = path.join("folder.json");
        if !file.is_file() {
            continue;
        }
        match read_json::<FolderMeta>(&file) {
            Ok(folder) => out.push(folder),
            Err(err) => eprintln!("[vault] 跳过损坏的 folder {}：{err}", file.display()),
        }
    }

    sort_folders(&mut out);
    Ok(out)
}

/// 删除文件夹本身（里面的记录不动，由上层决定怎么处理）
pub fn delete_folder(vault: &Path, id: &str) -> AppResult<()> {
    let dir = folder_dir(vault, id);
    if !dir.is_dir() {
        return Err(AppError::NotFound(format!("文件夹不存在：{id}")));
    }
    fs::remove_dir_all(dir)?;
    Ok(())
}

// ── 排序与继承 ──

/// 置顶优先 → order 小的在前 → 名称
pub fn sort_folders(list: &mut [FolderMeta]) {
    list.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then(a.order.cmp(&b.order))
            .then(a.name.cmp(&b.name))
    });
}

/// 同级里下一个可用的 order
pub fn next_order(all: &[FolderMeta], parent_id: Option<&str>) -> i64 {
    all.iter()
        .filter(|f| f.parent_id.as_deref() == parent_id)
        .map(|f| f.order + 1)
        .max()
        .unwrap_or(0)
}

/// 解析某个文件夹**生效的场景**：自己绑定的 → 最近的祖先绑定的 → 内置普通记录。
/// 找不到文件夹（比如 None = 根）也回落到内置普通记录。
pub fn effective_scene(all: &[FolderMeta], id: Option<&str>) -> String {
    let mut current = id;
    let mut hops = 0;

    while let Some(folder_id) = current {
        // 防环：正常情况下不可能超过几十层
        hops += 1;
        if hops > 64 {
            break;
        }

        let Some(folder) = all.iter().find(|f| f.id == folder_id) else {
            break;
        };

        if let Some(scene) = &folder.scene {
            if !scene.trim().is_empty() {
                return scene.clone();
            }
        }
        current = folder.parent_id.as_deref();
    }

    PLAIN_SCENE.to_string()
}

/// 把 `moving` 移到 `new_parent` 下会不会形成环？
/// （不能把父文件夹移进它自己的子文件夹里）
pub fn creates_cycle(all: &[FolderMeta], moving: &str, new_parent: Option<&str>) -> bool {
    let mut current = new_parent;
    let mut hops = 0;

    while let Some(id) = current {
        if id == moving {
            return true;
        }
        hops += 1;
        if hops > 64 {
            return true; // 数据已经坏了，保守地拒绝
        }
        current = all
            .iter()
            .find(|f| f.id == id)
            .and_then(|f| f.parent_id.as_deref());
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("framevault-folder-{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn folders_roundtrip_and_sort() {
        let vault = temp_vault("roundtrip");

        let mut a = FolderMeta::new("f-travel", "旅行", None, 1);
        let b = FolderMeta::new("f-diary", "日记", None, 0);
        let mut c = FolderMeta::new("f-pinned", "置顶的", None, 9);
        c.pinned = true;

        write_folder(&vault, &a).unwrap();
        write_folder(&vault, &b).unwrap();
        write_folder(&vault, &c).unwrap();

        let list = list_folders(&vault).unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].name, "置顶的", "置顶的永远排最前");
        assert_eq!(list[1].name, "日记", "其余按 order");
        assert_eq!(list[2].name, "旅行");

        // 读回来一致
        a.name = "改名了".into();
        write_folder(&vault, &a).unwrap();
        assert_eq!(read_folder(&vault, &a.id).unwrap().name, "改名了");

        // 删掉一个
        delete_folder(&vault, &b.id).unwrap();
        assert_eq!(list_folders(&vault).unwrap().len(), 2);
    }

    #[test]
    fn scene_inherits_from_nearest_ancestor_then_falls_back() {
        let root = FolderMeta::new("root", "根", None, 0); // 没绑场景
        let mut travel = FolderMeta::new("travel", "旅行", Some("root".into()), 0);
        travel.scene = Some("builtin.travel".into());
        let sub = FolderMeta::new("sub", "日本", Some("travel".into()), 0); // 没绑，应继承

        let all = vec![root, travel, sub];

        assert_eq!(effective_scene(&all, Some("travel")), "builtin.travel");
        assert_eq!(
            effective_scene(&all, Some("sub")),
            "builtin.travel",
            "子文件夹应当继承最近祖先的场景"
        );
        assert_eq!(
            effective_scene(&all, Some("root")),
            PLAIN_SCENE,
            "都没绑定就回落到内置普通记录"
        );
        assert_eq!(effective_scene(&all, None), PLAIN_SCENE);
        assert_eq!(
            effective_scene(&all, Some("不存在的 id")),
            PLAIN_SCENE,
            "找不到也不能崩"
        );
    }

    #[test]
    fn refuses_to_move_a_folder_into_its_own_child() {
        let root = FolderMeta::new("root", "根", None, 0);
        let child = FolderMeta::new("child", "子", Some("root".into()), 0);
        let grandchild = FolderMeta::new("grand", "孙", Some("child".into()), 0);
        let other = FolderMeta::new("other", "别的", None, 1);

        let all = vec![root, child, grandchild, other];

        assert!(creates_cycle(&all, "root", Some("child")), "移进自己的子级");
        assert!(creates_cycle(&all, "root", Some("grand")), "移进自己的孙级");
        assert!(!creates_cycle(&all, "child", Some("other")), "移到无关分支没问题");
        assert!(!creates_cycle(&all, "child", None), "移到根没问题");
    }

    #[test]
    fn next_order_counts_siblings_only() {
        let a = FolderMeta::new("a", "a", None, 0);
        let b = FolderMeta::new("b", "b", None, 1);
        let child = FolderMeta::new("c", "c", Some("a".into()), 7);

        let all = vec![a, b, child];
        assert_eq!(next_order(&all, None), 2);
        assert_eq!(next_order(&all, Some("a")), 8);
    }
}
