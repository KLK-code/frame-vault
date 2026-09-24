use crate::error::AppResult;
use crate::vault::write_json_atomic;
use serde::ser::SerializeStruct;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 一个仓库「在哪儿」。
///
/// - **桌面**：文件系统路径；
/// - **安卓**：SAF 的 `content://` 树 URI（用户在系统选择器里选的目录 + 系统给的持久授权）。
///
/// 注意 `vaults.json` 是**本机注册表**：它在应用数据目录里，**不进 Vault、不参与同步** ——
/// 所以两台设备上"记得的仓库位置"不一样是完全正常的。Vault 的身份在它自己的 `vault.json` 里，
/// 跟着仓库走（`vaultId`），跨端一致靠的是这个，不是这个文件。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultRef {
    Fs(PathBuf),
    Saf(String),
}

impl VaultRef {
    /// 桌面路径那一支；SAF 引用返回 `None`（调用方按平台给人话错误）
    pub fn as_path(&self) -> Option<&Path> {
        match self {
            VaultRef::Fs(path) => Some(path.as_path()),
            VaultRef::Saf(_) => None,
        }
    }

    /// 给人看的样子（错误消息 / 界面显示）
    pub fn display(&self) -> String {
        match self {
            VaultRef::Fs(path) => path.display().to_string(),
            VaultRef::Saf(uri) => uri.clone(),
        }
    }

    /// 从界面 / 命令传来的字符串认出这是哪种引用。
    ///
    /// 判据就是 scheme：SAF 的**树 URI 一定 `content://` 开头**（安卓上唯一的来源是
    /// 系统目录选择器），其余一律当路径 —— 桌面端永远不会出现 `content://`。
    /// 这样 `create_vault` / `add_vault` 的参数形状两端共用，接 SAF 时命令层不用再改。
    pub fn from_input(input: &str) -> Self {
        if input.starts_with("content://") {
            VaultRef::Saf(input.to_string())
        } else {
            VaultRef::Fs(PathBuf::from(input))
        }
    }
}

/// 序列化：**路径那支保持裸字符串**（用户老文件的形状一字不变，不因为我们加了 SAF 就被重排），
/// SAF 那支写成 `{"uri": "content://…"}`。
impl Serialize for VaultRef {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            VaultRef::Fs(path) => path.serialize(serializer),
            VaultRef::Saf(uri) => {
                let mut s = serializer.serialize_struct("VaultRef", 1)?;
                s.serialize_field("uri", uri)?;
                s.end()
            }
        }
    }
}

/// 反序列化：**裸字符串 = 老格式（就是路径）**；对象形式 `{"path"}` / `{"uri"}` 两种都认。
impl<'de> Deserialize<'de> for VaultRef {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            /// v0.1 起的形状：一个字符串就是路径
            Bare(PathBuf),
            Tagged {
                path: Option<PathBuf>,
                uri: Option<String>,
            },
        }

        match Raw::deserialize(deserializer)? {
            Raw::Bare(path) => Ok(VaultRef::Fs(path)),
            Raw::Tagged { uri: Some(uri), .. } => Ok(VaultRef::Saf(uri)),
            Raw::Tagged { path: Some(path), .. } => Ok(VaultRef::Fs(path)),
            Raw::Tagged { .. } => Err(serde::de::Error::custom(
                "仓库引用既没有 path 也没有 uri",
            )),
        }
    }
}

/// 已知仓库列表 + 当前仓库；会持久化成 `vaults.json`。
///
/// **加字段一律 `#[serde(default)]`**：老文件没有新字段时反序列化会失败，
/// 而 `lib.rs` 的 `setup` 里是 `state.load()?` —— 一旦 `Err`，**应用直接起不来**。
#[derive(Default, Serialize, Deserialize)]
pub struct VaultRegistry {
    #[serde(default)]
    pub active: Option<VaultRef>,
    #[serde(default)]
    pub known: Vec<VaultRef>,
}

pub struct AppState {
    config_path: PathBuf, // vaults.json 的完整路径
    pub vaults: Mutex<VaultRegistry>,
}

impl AppState {
    pub fn new(config_path: PathBuf) -> Self {
        Self {
            config_path,
            vaults: Mutex::new(VaultRegistry::default()),
        }
    }

    /// 启动时调一次：把上次的列表读回来。
    ///
    /// **绝不因为这个小文件让应用起不来**：读不动或解不开就按空列表启动，并在日志里吼一声。
    /// 理由是调用点写着 `load()?` —— 一次 `Err` 就是白屏。丢的也只是"本机记得哪些仓库"，
    /// Vault 本体一个字都不在这个文件里。
    pub fn load(&self) -> AppResult<()> {
        if !self.config_path.exists() {
            return Ok(()); // 第一次运行，正常情况
        }
        let parsed = std::fs::read_to_string(&self.config_path)
            .map_err(|e| e.to_string())
            .and_then(|text| serde_json::from_str::<VaultRegistry>(&text).map_err(|e| e.to_string()));

        match parsed {
            Ok(reg) => *self.vaults.lock().unwrap() = reg,
            Err(err) => {
                eprintln!(
                    "[state] vaults.json 读不动，按空列表启动（原文件没动，修好它会自动回来）：{err}"
                );
            }
        }
        Ok(())
    }

    /// 每次改动后调一次：写回磁盘
    pub fn save(&self) -> AppResult<()> {
        let guard = self.vaults.lock().unwrap();
        write_json_atomic(&self.config_path, &*guard)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("framevault-state-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// **老文件必须还能读**：那时字段就是裸字符串，没有 uri 这些新东西。
    /// 这条要是破了，用户升级后应用直接起不来（`setup` 里 `load()?`）。
    #[test]
    fn old_vaults_json_still_loads() {
        let dir = scratch("old-format");
        let file = dir.join("vaults.json");
        fs::write(
            &file,
            r#"{
  "active": "D:\\Gitee\\VaultTest",
  "known": [
    "D:\\Gitee\\VaultTest",
    "D:\\Gitee\\vu"
  ]
}"#,
        )
        .unwrap();

        let state = AppState::new(file);
        state.load().unwrap();
        let reg = state.vaults.lock().unwrap();
        assert_eq!(
            reg.active,
            Some(VaultRef::Fs(PathBuf::from("D:\\Gitee\\VaultTest")))
        );
        assert_eq!(reg.known.len(), 2);
        assert_eq!(reg.known[1], VaultRef::Fs(PathBuf::from("D:\\Gitee\\vu")));
    }

    /// 桌面那支序列化后**一字不变**（还是裸字符串）：不能因为加了 SAF 就把用户的文件重排一遍。
    #[test]
    fn fs_ref_serializes_as_bare_string() {
        let one = VaultRef::Fs(PathBuf::from("/tmp/vault"));
        let json = serde_json::to_string(&VaultRef::Fs(PathBuf::from("/tmp/vault"))).unwrap();
        assert_eq!(json, "\"/tmp/vault\"");
        assert_eq!(serde_json::from_str::<VaultRef>(&json).unwrap(), one);
    }

    /// SAF 那支写 `{"uri": …}`，并且能读回来。
    #[test]
    fn saf_uri_round_trips() {
        let uri = "content://com.android.externalstorage.documents/tree/primary%3AFrameVault";
        let json = serde_json::to_string(&VaultRef::Saf(uri.to_string())).unwrap();
        assert!(json.contains("\"uri\""), "应当是带字段名的对象：{json}");
        assert_eq!(
            serde_json::from_str::<VaultRef>(&json).unwrap(),
            VaultRef::Saf(uri.to_string())
        );
    }

    /// 整体往返：SAF 仓库写进 vaults.json 再读回来，两个字段都在。
    #[test]
    fn registry_with_mixed_refs_round_trips() {
        let dir = scratch("mixed");
        let file = dir.join("vaults.json");
        let state = AppState::new(file.clone());
        {
            let mut reg = state.vaults.lock().unwrap();
            reg.active = Some(VaultRef::Saf("content://tree/x".into()));
            reg.known = vec![
                VaultRef::Fs(PathBuf::from("/tmp/a")),
                VaultRef::Saf("content://tree/x".into()),
            ];
        }
        state.save().unwrap();

        let reloaded = AppState::new(file);
        reloaded.load().unwrap();
        let reg = reloaded.vaults.lock().unwrap();
        assert_eq!(reg.active, Some(VaultRef::Saf("content://tree/x".into())));
        assert_eq!(reg.known.len(), 2);
        assert_eq!(reg.known[0], VaultRef::Fs(PathBuf::from("/tmp/a")));
    }

    /// 缺字段（老文件没有新加的字段）与多字段（新版本写的、老版本读）都不该炸。
    #[test]
    fn missing_and_unknown_fields_are_tolerated() {
        let empty: VaultRegistry = serde_json::from_str("{}").unwrap();
        assert!(empty.active.is_none() && empty.known.is_empty());

        let extra: VaultRegistry =
            serde_json::from_str(r#"{"active": "/tmp/a", "known": [], "未来字段": 1}"#).unwrap();
        assert_eq!(extra.active, Some(VaultRef::Fs(PathBuf::from("/tmp/a"))));

        // 只有 known、没有 active（老版本可能这么写过）
        let only_known: VaultRegistry = serde_json::from_str(r#"{"known": ["/tmp/b"]}"#).unwrap();
        assert!(only_known.active.is_none());
        assert_eq!(only_known.known.len(), 1);
    }

    /// 坏文件**不让应用起不来**：按空列表启动，而且不返回 Err。
    #[test]
    fn corrupt_file_does_not_fail_startup() {
        let dir = scratch("corrupt");
        let file = dir.join("vaults.json");
        fs::write(&file, "{ 这不是 JSON").unwrap();

        let state = AppState::new(file.clone());
        assert!(state.load().is_ok(), "坏文件也必须能启动");
        let reg = state.vaults.lock().unwrap();
        assert!(reg.active.is_none() && reg.known.is_empty());
        drop(reg);
        // 而且原文件没被我们动过（用户还能自己去看一眼）
        assert_eq!(fs::read_to_string(&file).unwrap(), "{ 这不是 JSON");
    }
}
