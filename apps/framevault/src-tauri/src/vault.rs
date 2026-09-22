use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const SCHEMA_VERSION: u32 = 1;

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

pub fn is_supported_schema_version(version: u32) -> bool {
    version == SCHEMA_VERSION
}

pub fn entry_dir(vault: &Path, id: &str) -> PathBuf {
    vault.join("entries").join(id)
}

pub fn entry_path(vault: &Path, id: &str) -> PathBuf {
    entry_dir(vault, id).join("entry.json")
}

fn json_err(e: serde_json::Error) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, e)
}

pub fn write_entry(vault: &Path, entry: &Entry) -> std::io::Result<PathBuf> {
    if !is_supported_schema_version(entry.schema_version) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("unsupported schemaVersion: {}", entry.schema_version),
        ));
    }
    let target = entry_path(vault, &entry.id);
    write_json_atomic(&target, entry)?;
    Ok(target)
}

pub fn read_entry(vault: &Path, id: &str) -> std::io::Result<Entry> {
    let text = fs::read_to_string(entry_path(vault, id))?;
    serde_json::from_str(&text).map_err(json_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("framevault-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn writes_then_reads_back() {
        let vault = temp_vault("roundtrip");
        let entry = Entry::new("0199-demo", "下午随记", "2026-09-21T18:00:00+08:00");

        let path = write_entry(&vault, &entry).unwrap();
        assert!(path.exists());

        let back = read_entry(&vault, &entry.id).unwrap();
        assert_eq!(back.title, "下午随记");
        assert_eq!(back.schema_version, SCHEMA_VERSION);
        assert_eq!(back.tags.len(), 0);
    }

    #[test]
    fn json_fields_are_camel_case() {
        let entry = Entry::new("id-1", "t", "2026-01-01T00:00:00Z");
        let json = serde_json::to_string(&entry).unwrap();

        assert!(json.contains("\"schemaVersion\""));
        assert!(json.contains("\"createdAt\""));
        assert!(!json.contains("schema_version"));
    }

    #[test]
    fn rewrite_replaces_and_leaves_no_tmp() {
        let vault = temp_vault("rewrite");
        let mut entry = Entry::new("id-2", "v1", "2026-01-01T00:00:00Z");
        write_entry(&vault, &entry).unwrap();

        entry.title = "v2".to_string();
        write_entry(&vault, &entry).unwrap();

        let back = read_entry(&vault, "id-2").unwrap();
        assert_eq!(back.title, "v2");
        assert!(!vault
            .join("entries")
            .join("id-2")
            .join("entry.json.tmp")
            .exists());
    }

    #[test]
    fn rejects_unknown_schema_version() {
        assert!(is_supported_schema_version(1));
        assert!(!is_supported_schema_version(99));
    }
}

pub fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = tmp_path(path);
    let json = serde_json::to_string_pretty(value).map_err(json_err)?;
    fs::write(&tmp, json)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(".tmp"); // entry.json → entry.json.tmp
    PathBuf::from(s)
}
