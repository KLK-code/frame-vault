//! SAF（Storage Access Framework）后端 —— 安卓上的"字节怎么落盘"。
//!
//! 安卓上用户选的目录只有一条 `content://` 树 URI + 持久授权，**没有路径这回事**，
//! 所以桌面用 `NativeFs`（`vault/store.rs`），安卓换成这里。领域规则一个字都不动：
//! `vault/` 那一层根本不知道自己是写在文件系统上还是 SAF 上（AGENTS 跨端一致性硬线）。
//!
//! 分工：**路径解析、游标查询、流复制这些脏活在 Kotlin 里**（`SafBridgePlugin.kt`），
//! 这里只做三件事：把领域层的绝对路径换算成"树里的相对路径"、把参数包成 JSON、
//! 把 Kotlin 的报错翻成人话。
//!
//! 为什么平台层可以认识 tauri：`register_android_plugin` / `run_mobile_plugin` 都是
//! tauri 的类型，而领域层不许碰（AGENTS §2）。这个文件就是 §2 里"平台差异"的第三处落点。

// ── 与平台无关的部分 ──

/// 用户在系统选择器里选的目录（`pick_saf_tree` 的返回值）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedTree {
    /// 树 URI：以后所有读写都靠它 + 那条持久授权
    pub uri: String,
    /// 系统给的显示名（`DISPLAY_NAME`），给仓库列表用
    pub name: String,
}

/// 与平台无关的部分：base64（只在安卓用得上，但测试在桌面跑，所以两边都编）。
///
/// 为什么手写：SAF 的桥只过 JSON，二进制得先编码；而 AGENTS §1 对新增依赖有红线，
/// 这里只需要二十行。**媒体本体不走这条路**（S3 是 Kotlin 侧的流式复制）。
#[cfg(any(target_os = "android", test))]
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[(triple >> 18) as usize & 0x3f] as char);
        out.push(TABLE[(triple >> 12) as usize & 0x3f] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(triple >> 6) as usize & 0x3f] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[triple as usize & 0x3f] as char
        } else {
            '='
        });
    }
    out
}

// ── 安卓专属 ──

#[cfg(target_os = "android")]
mod android {
    use crate::error::{AppError, AppResult};
    use crate::vault::store::{DirEntry, Vault, VaultStore};
    use serde::de::DeserializeOwned;
    use serde::{Deserialize, Serialize};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use tauri::plugin::PluginHandle;
    use tauri::{Manager, Runtime};

    /// 桥的句柄：Kotlin 那边的 `SafBridgePlugin` 实例。
    ///
    /// 它由插件 setup 拿到，随后**存进 tauri 的托管状态** —— 于是命令层只要手里有
    /// AppHandle 就能把仓库引用变成句柄，不用把句柄一路往下传参。
    pub struct SafBridge<R: Runtime> {
        handle: PluginHandle<R>,
    }

    impl<R: Runtime> SafBridge<R> {
        pub fn new(handle: PluginHandle<R>) -> Self {
            Self { handle }
        }

        /// 调一个 Kotlin 命令。参数与返回值都是 JSON（两端的字段名必须一字不差）。
        fn call<T: DeserializeOwned>(
            &self,
            command: &str,
            payload: impl Serialize,
        ) -> AppResult<T> {
            self.handle
                .run_mobile_plugin::<T>(command, payload)
                .map_err(|err| AppError::Invalid(format!("访问这个目录失败（{command}）：{err}")))
        }

        /// 只关心成不成功的那些命令（写文件 / 建目录 / 改名 / 删除）。
        /// Kotlin 侧返回 `{}`，这里丢掉它，省得每个调用点都写一遍类型标注。
        fn call_unit(&self, command: &str, payload: impl Serialize) -> AppResult<()> {
            self.call::<Ignore>(command, payload).map(|_| ())
        }
    }

    impl<R: Runtime> Clone for SafBridge<R> {
        fn clone(&self) -> Self {
            Self {
                handle: self.handle.clone(),
            }
        }
    }

    /// 一条树 URI 上的仓库。
    pub struct SafStore<R: Runtime> {
        bridge: SafBridge<R>,
        /// 树 URI 本身（`content://…/tree/primary%3AFrameVault`）
        tree: String,
        /// 领域层看到的"根路径"。**它不指向磁盘上任何东西** —— SAF 上没有等价物，
        /// 它只用来给领域层拼路径（`vault.join("科研/论文笔记")`）。
        root: PathBuf,
    }

    impl<R: Runtime> SafStore<R> {
        /// 树里的相对路径：剥掉根前缀，分隔符统一成 `/`（领域层可能带 `\`，SAF 只认 `/`）。
        fn rel(&self, path: &Path) -> String {
            let rest = path.strip_prefix(&self.root).unwrap_or(path);
            rest.to_string_lossy().replace('\\', "/")
        }

        fn stat(&self, path: &Path) -> AppResult<StatResult> {
            let args = PathArgs {
                root: &self.tree,
                path: &self.rel(path),
            };
            self.bridge.call("stat", args)
        }
    }

    /// 树根在系统里显示的名字（仓库列表给用户看的那个名字）。
    /// 不用先建句柄 —— 列表里可能有几条用户选的目录，每条都建一遍太浪费。
    pub fn tree_name<R: Runtime>(app: &tauri::AppHandle<R>, uri: &str) -> AppResult<String> {
        let bridge = app
            .try_state::<SafBridge<R>>()
            .ok_or_else(|| AppError::Invalid("SAF 桥没就绪（Android 插件没注册）".to_string()))?
            .inner()
            .clone();
        let store = SafStore {
            bridge,
            tree: uri.to_string(),
            root: PathBuf::from(uri),
        };
        Ok(store.stat(Path::new(""))?.name)
    }

    // ── 桥的入参（字段名与 Kotlin 的 @InvokeArg 类一一对应）──

    #[derive(Serialize)]
    struct PathArgs<'a> {
        root: &'a str,
        path: &'a str,
    }

    #[derive(Serialize)]
    struct WriteTextArgs<'a> {
        root: &'a str,
        path: &'a str,
        text: &'a str,
    }

    #[derive(Serialize)]
    struct WriteBytesArgs<'a> {
        root: &'a str,
        path: &'a str,
        base64: &'a str,
    }

    #[derive(Serialize)]
    struct RenameArgs<'a> {
        root: &'a str,
        from: &'a str,
        to: &'a str,
    }

    // ── 桥的返回值 ──

    #[derive(Deserialize)]
    struct ListResult {
        items: Vec<ListItem>,
    }

    #[derive(Deserialize)]
    struct ListItem {
        name: String,
        #[serde(default)]
        dir: bool,
        /// SAF 上一次查询就能连大小一起拿到（`COLUMN_SIZE`），不用再 stat
        #[serde(default)]
        size: u64,
    }

    #[derive(Deserialize)]
    struct TextResult {
        text: String,
    }

    #[derive(Deserialize)]
    struct StatResult {
        exists: bool,
        #[serde(default)]
        dir: bool,
        #[serde(default)]
        name: String,
    }

    /// Kotlin 那边空着返回的（`{}`），忽略即可。
    #[derive(Deserialize)]
    struct Ignore {}

    impl<R: Runtime> VaultStore for SafStore<R> {
        fn read_bytes(&self, path: &Path) -> AppResult<Vec<u8>> {
            // 媒体本体走 S3 的流式复制，不经过桥。这里明确报错，别给个空数组。
            let _ = path;
            Err(AppError::Invalid(
                "安卓上读媒体文件还没接（S3）；文本记录不受影响".to_string(),
            ))
        }

        fn read_text(&self, path: &Path) -> AppResult<String> {
            let args = PathArgs {
                root: &self.tree,
                path: &self.rel(path),
            };
            Ok(self.bridge.call::<TextResult>("readText", args)?.text)
        }

        fn write_bytes(&self, path: &Path, bytes: &[u8]) -> AppResult<()> {
            // 桥只过 JSON，元数据（entry.json / folder.json，几十 KB 级）走 base64。
            let encoded = super::base64_encode(bytes);
            let args = WriteBytesArgs {
                root: &self.tree,
                path: &self.rel(path),
                base64: &encoded,
            };
            self.bridge.call_unit("writeBytes", args)
        }

        fn write_text(&self, path: &Path, text: &str) -> AppResult<()> {
            // 行尾一律 LF —— 与桌面同一条规矩（跨端一致性：Windows 写出的 CRLF
            // 会让别的端与 git 看到"整个文件都变了"）
            let normalized = text.replace("\r\n", "\n");
            let args = WriteTextArgs {
                root: &self.tree,
                path: &self.rel(path),
                text: &normalized,
            };
            self.bridge.call_unit("writeText", args)
        }

        fn list_dir(&self, path: &Path) -> AppResult<Vec<DirEntry>> {
            let args = PathArgs {
                root: &self.tree,
                path: &self.rel(path),
            };
            let listed: ListResult = self.bridge.call("list", args)?;
            let mut out: Vec<DirEntry> = listed
                .items
                .into_iter()
                .map(|item| DirEntry {
                    name: item.name,
                    is_dir: item.dir,
                    size: item.size,
                })
                .collect();
            out.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(out)
        }

        fn create_dir_all(&self, path: &Path) -> AppResult<()> {
            // SAF 的 mkdir 本来就是 create_dir_all 语义：中间层不在就一层层建
            let args = PathArgs {
                root: &self.tree,
                path: &self.rel(path),
            };
            self.bridge.call_unit("mkdir", args)
        }

        fn rename(&self, from: &Path, to: &Path) -> AppResult<()> {
            let args = RenameArgs {
                root: &self.tree,
                from: &self.rel(from),
                to: &self.rel(to),
            };
            // 同一个父目录 → 原生改名；换了父目录 → SAF 没有 move，Kotlin 那边复制 + 删旧
            self.bridge.call_unit("renameOrMove", args)
        }

        fn remove_dir_all(&self, path: &Path) -> AppResult<()> {
            let args = PathArgs {
                root: &self.tree,
                path: &self.rel(path),
            };
            self.bridge.call_unit("delete", args)
        }

        fn is_file(&self, path: &Path) -> bool {
            self.stat(path).map(|s| s.exists && !s.dir).unwrap_or(false)
        }

        fn is_dir(&self, path: &Path) -> bool {
            self.stat(path).map(|s| s.exists && s.dir).unwrap_or(false)
        }
    }

    /// 把 SAF 引用变成领域层的根句柄。
    ///
    /// 根路径就用树 URI 本身：**它不指向磁盘**，只用于拼路径；
    /// `rel()` 会把前缀剥掉，换成树里的相对路径。
    pub fn vault_for_uri<R: Runtime>(app: &tauri::AppHandle<R>, uri: &str) -> AppResult<Vault> {
        let bridge = app
            .try_state::<SafBridge<R>>()
            .ok_or_else(|| AppError::Invalid("SAF 桥没就绪（Android 插件没注册）".to_string()))?
            .inner()
            .clone();
        let root = PathBuf::from(uri);
        let store = SafStore {
            bridge,
            tree: uri.to_string(),
            root: root.clone(),
        };
        Ok(Vault::new(root, Arc::new(store)))
    }

    /// 建这条仓库之前先看看那个目录里有没有 `vault.json`（有就是"导入已有仓库"）。
    pub fn has_vault_file<R: Runtime>(app: &tauri::AppHandle<R>, uri: &str) -> AppResult<bool> {
        let vault = vault_for_uri(app, uri)?;
        Ok(vault.is_file(&vault.join("vault.json")))
    }

    /// 弹系统目录选择器。用户取消就返回 `None`（不是错误 —— 取消是正常操作）。
    pub fn pick_tree<R: Runtime>(app: &tauri::AppHandle<R>) -> AppResult<Option<super::PickedTree>> {
        #[derive(Deserialize)]
        struct Raw {
            #[serde(default)]
            cancelled: bool,
            #[serde(default)]
            uri: String,
            #[serde(default)]
            name: String,
        }

        let bridge = app
            .try_state::<SafBridge<R>>()
            .ok_or_else(|| AppError::Invalid("SAF 桥没就绪（Android 插件没注册）".to_string()))?
            .inner()
            .clone();
        let picked: Raw = bridge.call("pickTree", ())?;
        if picked.cancelled || picked.uri.is_empty() {
            return Ok(None);
        }
        Ok(Some(super::PickedTree {
            uri: picked.uri,
            name: picked.name,
        }))
    }
}

#[cfg(target_os = "android")]
pub use android::{has_vault_file, pick_tree, tree_name, vault_for_uri, SafBridge};

// ── 桌面上没有 SAF ──
//
// 这几个同签名替身是为了**命令层不写 cfg**：调用点只有一份，平台差异留在这个文件里
// （AGENTS §2：平台差异只准出现在指定的几处）。

#[cfg(not(target_os = "android"))]
pub fn vault_for_uri<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    uri: &str,
) -> crate::error::AppResult<crate::vault::store::Vault> {
    // 桌面上不可能存在 SAF 引用（只有安卓的系统选择器会给 content://）
    Err(crate::error::AppError::Invalid(format!(
        "「{uri}」是安卓上的目录引用，这个平台上用不了它"
    )))
}

#[cfg(not(target_os = "android"))]
pub fn has_vault_file(_app: &tauri::AppHandle, _uri: &str) -> crate::error::AppResult<bool> {
    Ok(false)
}

#[cfg(not(target_os = "android"))]
pub fn tree_name(_app: &tauri::AppHandle, _uri: &str) -> crate::error::AppResult<String> {
    Ok(String::new())
}

#[cfg(not(target_os = "android"))]
pub fn pick_tree(_app: &tauri::AppHandle) -> crate::error::AppResult<Option<PickedTree>> {
    Err(crate::error::AppError::Invalid(
        "系统目录选择器是安卓上的东西（桌面用 dialog 插件选目录）".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::base64_encode;

    #[test]
    fn base64_matches_known_vectors() {
        // RFC 4648 的样例（不引依赖，就用这几个把边界钉住：空 / 1 / 2 / 3 字节余数）
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        // 真实负载：entry.json 里会有中文
        assert_eq!(base64_encode("未归类".as_bytes()), "5pyq5b2S57G7");
    }
}
