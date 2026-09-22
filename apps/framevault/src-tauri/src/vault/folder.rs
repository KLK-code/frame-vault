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
/// **仓库层面是平的**：场景之间没有父子关系。
/// "归类"是展示层的事——前端按主题把同类场景聚在一起显示（挑战 / 旅游 / 日记…）。
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
            name: name.to_string(),
            order,
            pinned: false,
            scene: scene.filter(|s| !s.trim().is_empty()),
            scene_config: empty_object(),
        }
    }

    /// 这个场景最终生效的主题 id（没绑定就是内置普通记录）
    pub fn effective_scene(&self) -> String {
        self.scene
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| PLAIN_SCENE.to_string())
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

/// 删除场景本身（**不碰记录**，调用方要先确认里面没有记录）
pub fn delete_folder(vault: &Path, id: &str) -> AppResult<()> {
    let dir = folder_dir(vault, id);
    if !dir.is_dir() {
        return Err(AppError::NotFound(format!("场景不存在：{id}")));
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

    fn temp_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("framevault-folder-{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn folders_roundtrip_and_sort() {
        let vault = temp_vault("roundtrip");

        let mut a = FolderMeta::new("f-travel", "旅行", 1, Some("builtin.plain".into()));
        let b = FolderMeta::new("f-diary", "日记", 0, None);
        let mut c = FolderMeta::new("f-pinned", "置顶的", 9, None);
        c.pinned = true;

        write_folder(&vault, &a).unwrap();
        write_folder(&vault, &b).unwrap();
        write_folder(&vault, &c).unwrap();

        let list = list_folders(&vault).unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].name, "置顶的", "置顶的永远排最前");
        assert_eq!(list[1].name, "日记", "其余按 order");
        assert_eq!(list[2].name, "旅行");

        a.name = "改名了".into();
        write_folder(&vault, &a).unwrap();
        assert_eq!(read_folder(&vault, &a.id).unwrap().name, "改名了");

        delete_folder(&vault, &b.id).unwrap();
        assert_eq!(list_folders(&vault).unwrap().len(), 2);
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
            "schemaVersion": 1,
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
