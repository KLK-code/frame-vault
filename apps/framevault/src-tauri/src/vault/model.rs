use serde::{Deserialize, Serialize};

/// Vault 数据格式版本。改结构就要动它，并且要写迁移。
pub const SCHEMA_VERSION: u32 = 1;

/// 这个版本号支持吗？——将来 v2 出现时，老程序读到就**明确报错**，而不是把数据改坏。
pub fn is_supported(version: u32) -> bool {
    version == SCHEMA_VERSION
}

/// 一条记录
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
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
        }
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
        assert!(!json.contains("schema_version"));
    }

    #[test]
    fn rejects_unknown_schema_version() {
        assert!(is_supported(1));
        assert!(!is_supported(99));
    }
}
