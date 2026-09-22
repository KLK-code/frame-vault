use super::id::new_id;
use super::model::{is_supported, Entry, VaultMeta, SCHEMA_VERSION};
use crate::error::{AppError, AppResult};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

// ── 路径约定（Vault 长什么样，只有这里说了算）──

pub fn entries_dir(vault: &Path) -> PathBuf {
    vault.join("entries")
}

pub fn entry_dir(vault: &Path, id: &str) -> PathBuf {
    entries_dir(vault).join(id)
}

pub fn entry_path(vault: &Path, id: &str) -> PathBuf {
    entry_dir(vault, id).join("entry.json")
}

pub fn vault_meta_path(vault: &Path) -> PathBuf {
    vault.join("vault.json")
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(".tmp"); // entry.json → entry.json.tmp
    PathBuf::from(s)
}

/// 原子写入：先写 «文件».tmp，再 rename 覆盖。
/// 同一文件系统内 rename 是原子操作，所以崩溃/断电不会留下"半个文件"。
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let tmp = tmp_path(path);
    let json = serde_json::to_string_pretty(value)?;
    fs::write(&tmp, json)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn read_json<T: DeserializeOwned>(path: &Path) -> AppResult<T> {
    let text = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&text)?)
}

// ── Vault 身份 ──

/// 这个目录是 Vault 根吗？判断依据只有一条：**有没有 vault.json**。
/// 这样就不会再把 «.../entries» 这种子目录误当成 Vault（之前踩过）。
pub fn is_vault(dir: &Path) -> bool {
    vault_meta_path(dir).is_file()
}

/// 在 dir 里创建一个新 Vault：建目录结构 + 写身份文件。
pub fn create_vault(dir: &Path, name: &str, created_at: &str) -> AppResult<VaultMeta> {
    if is_vault(dir) {
        return Err(AppError::Invalid(format!(
            "{} 已经是一个 Vault 了",
            dir.display()
        )));
    }

    fs::create_dir_all(entries_dir(dir))?;
    fs::create_dir_all(dir.join(".framevault").join("tombstones"))?;

    let meta = VaultMeta {
        schema_version: SCHEMA_VERSION,
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
    if !is_supported(meta.schema_version) {
        return Err(AppError::Invalid(format!(
            "Vault 版本 {} 不受支持（本程序只认 {}）",
            meta.schema_version, SCHEMA_VERSION
        )));
    }
    Ok(meta)
}

// ── Entry ──

pub fn write_entry(vault: &Path, entry: &Entry) -> AppResult<PathBuf> {
    if !is_supported(entry.schema_version) {
        return Err(AppError::Invalid(format!(
            "不支持的 schemaVersion: {}",
            entry.schema_version
        )));
    }

    let target = entry_path(vault, &entry.id);
    write_json_atomic(&target, entry)?;
    Ok(target)
}

pub fn read_entry(vault: &Path, id: &str) -> AppResult<Entry> {
    read_json(&entry_path(vault, id))
}

/// 扫描 Vault 下所有 Entry。
/// 原则：**一条坏数据不该毁掉整次扫描** —— 单独跳过并打日志。
pub fn list_entries(vault: &Path) -> AppResult<Vec<Entry>> {
    let dir = entries_dir(vault);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for item in fs::read_dir(&dir)? {
        let path = item?.path();
        if !path.is_dir() {
            continue; // 跳过散落的文件
        }

        let file = path.join("entry.json");
        if !file.is_file() {
            continue; // 不是 Entry 目录
        }

        match read_json::<Entry>(&file) {
            Ok(entry) => out.push(entry),
            Err(err) => eprintln!("[vault] 跳过损坏的 Entry {}：{err}", file.display()),
        }
    }

    out.sort_by(|a, b| b.created_at.cmp(&a.created_at)); // 新的在前
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{Entry, SCHEMA_VERSION};

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
    fn rewrite_replaces_and_leaves_no_tmp() {
        let vault = temp_vault("rewrite");
        let mut entry = Entry::new("id-2", "v1", "2026-01-01T00:00:00Z");
        write_entry(&vault, &entry).unwrap();

        entry.title = "v2".to_string();
        write_entry(&vault, &entry).unwrap();

        let back = read_entry(&vault, "id-2").unwrap();
        assert_eq!(back.title, "v2");
        assert!(!vault.join("entries/id-2/entry.json.tmp").exists());
    }

    #[test]
    fn create_vault_writes_identity() {
        let dir = temp_vault("create");
        assert!(!is_vault(&dir)); // 一开始不是 Vault

        let meta = create_vault(&dir, "我的日记", "2026-01-01T00:00:00Z").unwrap();

        assert!(is_vault(&dir));
        assert!(dir.join("entries").is_dir());
        assert!(dir.join("vault.json").is_file());
        assert_eq!(meta.name, "我的日记");
        assert_eq!(meta.vault_id.len(), 36); // UUIDv7

        // 再建一次应该被拒绝，而不是覆盖掉已有身份
        assert!(create_vault(&dir, "重复", "2026-01-01T00:00:00Z").is_err());

        // 读回来一致
        let back = read_vault_meta(&dir).unwrap();
        assert_eq!(back.vault_id, meta.vault_id);
    }

    #[test]
    fn list_entries_sorts_newest_first_and_skips_broken() {
        let vault = temp_vault("list");
        create_vault(&vault, "测试", "2026-01-01T00:00:00Z").unwrap();

        write_entry(&vault, &Entry::new("a", "旧", "2026-01-01T00:00:00Z")).unwrap();
        write_entry(&vault, &Entry::new("b", "新", "2026-03-01T00:00:00Z")).unwrap();

        // 塞一个坏掉的 entry.json，应该被跳过而不是让整次扫描失败
        let broken = entry_dir(&vault, "c");
        fs::create_dir_all(&broken).unwrap();
        fs::write(broken.join("entry.json"), "{ 这不是 JSON").unwrap();

        // 再塞一个不是 Entry 的目录
        fs::create_dir_all(entries_dir(&vault).join("随便一个文件夹")).unwrap();

        let list = list_entries(&vault).unwrap();
        assert_eq!(list.len(), 2, "坏数据和空目录都该被跳过");
        assert_eq!(list[0].title, "新", "新的应当排在前面");
        assert_eq!(list[1].title, "旧");
    }
}
