use serde::{Deserialize, Serialize};

/// Vault 数据格式版本。改结构就要动它，并且要写迁移。
pub const SCHEMA_VERSION: u32 = 1;

/// 这个版本号支持吗？——将来 v2 出现时，老程序读到就**明确报错**，而不是把数据改坏。
pub fn is_supported(version: u32) -> bool {
    version == SCHEMA_VERSION
}

fn empty_object() -> serde_json::Value {
    serde_json::json!({})
}

/// 一条记录。
///
/// **核心只负责"属于哪个场景、标题是什么、什么时候写的"；
/// 场景专属的字段一律塞进 `fields`** —— 这样加新场景不用改核心结构，
/// 第三方也才有可能自己扩。字段用 `#[serde(default)]` 保证**老文件仍能读**。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,

    /// 属于哪个文件夹（= 哪个场景）。None = 仓库根
    #[serde(default)]
    pub folder_id: Option<String>,

    /// 写入时生效的场景 id（快照：将来场景改了，这条老记录仍能按当时的规则解释）
    #[serde(default)]
    pub scene: Option<String>,

    /// 场景自定义字段的开放区（核心不解释它的内容）
    #[serde(default = "empty_object")]
    pub fields: serde_json::Value,
}

impl Entry {
    pub fn new(id: &str, title: &str, created_at: &str) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            id: id.to_string(),
            title: title.to_string(),
            tags: Vec::new(),
            created_at: created_at.to_string(),
            updated_at: created_at.to_string(),
            folder_id: None,
            scene: None,
            fields: empty_object(),
        }
    }

    /// 挂到某个场景（文件夹）下
    pub fn in_folder(mut self, folder_id: Option<String>, scene: String) -> Self {
        self.folder_id = folder_id;
        self.scene = Some(scene);
        self
    }
}

/// Vault 的身份文件（vault.json）—— **有它才算 Vault 根目录**
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMeta {
    pub schema_version: u32,
    pub vault_id: String,
    pub name: String,
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_fields_are_camel_case() {
        let entry = Entry::new("id-1", "t", "2026-01-01T00:00:00Z");
        let json = serde_json::to_string(&entry).unwrap();

        assert!(json.contains("\"schemaVersion\""));
        assert!(json.contains("\"createdAt\""));
        assert!(json.contains("\"folderId\""));
        assert!(!json.contains("schema_version"));
    }

    #[test]
    fn rejects_unknown_schema_version() {
        assert!(is_supported(1));
        assert!(!is_supported(99));
    }

    /// 老版本的 entry.json（没有 folderId / scene / fields）必须还能读出来
    #[test]
    fn old_entry_without_new_fields_still_loads() {
        let old = r#"{
            "schemaVersion": 1,
            "id": "old-1",
            "title": "老记录",
            "tags": [],
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z"
        }"#;

        let entry: Entry = serde_json::from_str(old).unwrap();
        assert_eq!(entry.title, "老记录");
        assert!(entry.folder_id.is_none());
        assert!(entry.scene.is_none());
        assert_eq!(entry.fields, serde_json::json!({}));
    }
}
