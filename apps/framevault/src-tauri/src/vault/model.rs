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

    /// 墓碑：删除时间。**不是真删文件**——
    /// 同步时别的设备靠它知道"这条被删了"，用户也能反悔（PRD：删除要能传播）
    #[serde(default)]
    pub deleted_at: Option<String>,
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
            deleted_at: None,
        }
    }

    /// 挂到某个场景（文件夹）下
    pub fn in_folder(mut self, folder_id: Option<String>, scene: String) -> Self {
        self.folder_id = folder_id;
        self.scene = Some(scene);
        self
    }

    /// 标记为"刚改过"。时间由调用方给（Rust 层不引入时钟依赖，测试才好写）
    pub fn touch(&mut self, now: &str) {
        if !now.trim().is_empty() {
            self.updated_at = now.to_string();
        }
    }

    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }

    /// 逻辑删除：写墓碑。文件、媒体、字段全都留着——用户能后悔比省那点磁盘重要
    pub fn mark_deleted(&mut self, now: &str) {
        self.deleted_at = Some(now.to_string());
        self.touch(now);
    }

    /// 从墓碑里恢复
    pub fn restore(&mut self, now: &str) {
        self.deleted_at = None;
        self.touch(now);
    }

    /// 局部更新：**只改给到的部分**。
    ///
    /// 归属（`folder_id` / `scene`）与 `created_at` 一律不动——"改文字"不该顺带把
    /// 记录搬到别处，也不该改掉它的出生日期。`fields` 是整体替换，不做深合并：
    /// 深合并在两边都只改一半时最容易产生"我明明删了怎么还在"的怪事。
    pub fn apply_update(
        &mut self,
        title: Option<&str>,
        fields: Option<serde_json::Value>,
        now: &str,
    ) {
        if let Some(title) = title {
            self.title = title.to_string();
        }
        if let Some(fields) = fields {
            self.fields = fields;
        }
        self.touch(now);
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
    fn tombstone_marks_and_restores() {
        let mut entry = Entry::new("e1", "标题", "2026-01-01T00:00:00Z");
        assert!(!entry.is_deleted());

        entry.mark_deleted("2026-03-03T09:00:00Z");
        assert!(entry.is_deleted());
        assert_eq!(entry.deleted_at.as_deref(), Some("2026-03-03T09:00:00Z"));
        assert_eq!(entry.updated_at, "2026-03-03T09:00:00Z", "删除也是一次修改");
        assert_eq!(entry.created_at, "2026-01-01T00:00:00Z");

        entry.restore("2026-03-04T09:00:00Z");
        assert!(!entry.is_deleted());
        assert!(entry.deleted_at.is_none());
        assert_eq!(entry.updated_at, "2026-03-04T09:00:00Z");
    }

    #[test]
    fn old_entry_json_without_tombstone_still_loads() {
        let old = r#"{
            "schemaVersion": 1,
            "id": "e1",
            "title": "老记录",
            "tags": [],
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z"
        }"#;

        let entry: Entry = serde_json::from_str(old).unwrap();
        assert_eq!(entry.title, "老记录");
        assert!(entry.deleted_at.is_none(), "老文件没有墓碑 = 活着");
        assert!(!entry.is_deleted());
    }

    #[test]
    fn update_keeps_ownership_and_created_at() {
        let mut entry = Entry::new("e1", "旧标题", "2026-01-01T00:00:00Z")
            .in_folder(Some("f1".into()), "builtin.plain".into());

        entry.apply_update(
            Some("新标题"),
            Some(serde_json::json!({ "text": "今天跑了 5 公里" })),
            "2026-02-02T08:00:00Z",
        );

        assert_eq!(entry.title, "新标题");
        assert_eq!(entry.fields["text"], "今天跑了 5 公里");
        assert_eq!(entry.folder_id.as_deref(), Some("f1"), "改文字不许把记录搬走");
        assert_eq!(entry.scene.as_deref(), Some("builtin.plain"));
        assert_eq!(entry.created_at, "2026-01-01T00:00:00Z", "出生日期不许改");
        assert_eq!(entry.updated_at, "2026-02-02T08:00:00Z");
    }

    #[test]
    fn update_with_missing_parts_leaves_them_alone() {
        let mut entry = Entry::new("e1", "标题", "2026-01-01T00:00:00Z");
        entry.fields = serde_json::json!({ "text": "正文" });

        // 只改标题，fields 必须原样保留
        entry.apply_update(Some("改过的标题"), None, "2026-02-02T08:00:00Z");
        assert_eq!(entry.fields["text"], "正文");

        // 空时间戳不许把 updated_at 抹成空字符串
        entry.apply_update(None, None, "");
        assert_eq!(entry.updated_at, "2026-02-02T08:00:00Z");
    }

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
