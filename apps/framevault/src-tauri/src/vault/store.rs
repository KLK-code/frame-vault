//! 存储抽象：**领域层只认这一层"字节怎么落盘"**。
//!
//! 为什么要有它：桌面是普通文件系统路径，安卓是 SAF（用户在系统选择器里选的目录，
//! 只有 `content://` 树 URI + 持久授权）。领域规则 —— 命名、层级、回收站、调序、对账 ——
//! **一个字都不许因为平台不同**（AGENTS 铁律：桌面打的包传到手机要能直接导入）。
//! 所以把规则与"文件操作从哪来"分开：`vault/` 只认 trait，**实现住在外面**
//! （`NativeFs` 在这儿；`SafStore` 在平台层，因为它要 tauri 的类型，见 AGENTS §2）。
//!
//! 路径约定：领域层手里的路径是**仓库根拼出来的绝对路径**（`Vault::join`）。
//! 桌面实现直接用；SAF 实现自己按 `root` 剥前缀换成树里的相对路径 —— 所以领域代码不用知道这件事。

use super::media::{CopiedFile, MediaSource, SourceInfo};
use crate::error::{AppError, AppResult};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// 目录里的一项：领域层只需要"叫什么"、"是不是目录"、还有**多大**。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    /// 文件字节数（目录填 0）。**列目录时一起给出**：SAF 上"再 stat 一次"是额外一次跨进程查询，
    /// 几十张照片就是几十次；`DocumentsContract` 一次查询就能连 `COLUMN_SIZE` 一起拿到，
    /// 桌面这边 `read_dir` 顺手取 metadata 也不比原来贵（原来也是逐个 stat）。
    pub size: u64,
}

/// 一个仓库的读写后端。**只做原语**，不做业务判断（不判重名、不认识 note.md）。
pub trait VaultStore: Send + Sync {
    fn read_bytes(&self, path: &Path) -> AppResult<Vec<u8>>;
    fn read_text(&self, path: &Path) -> AppResult<String>;
    /// 落盘（父目录不存在要顺手建）。**写入必须尽量原子**：
    /// 桌面是 tmp + rename（要么旧内容要么新内容）；SAF 没有"同目录 rename 覆盖"的语义，
    /// 实现退化成"写临时 → 改名 → 删旧"，这个差异记在 AGENTS §9。
    fn write_bytes(&self, path: &Path, bytes: &[u8]) -> AppResult<()>;
    fn list_dir(&self, path: &Path) -> AppResult<Vec<DirEntry>>;
    fn create_dir_all(&self, path: &Path) -> AppResult<()>;
    /// 改名 / 搬家。**不负责防撞名**（那是 `naming` 的事，而且判定要在同一份目录列表上做）。
    fn rename(&self, from: &Path, to: &Path) -> AppResult<()>;
    fn remove_dir_all(&self, path: &Path) -> AppResult<()>;
    fn is_file(&self, path: &Path) -> bool;
    fn is_dir(&self, path: &Path) -> bool;
    /// 删掉**一个文件**（不是目录）。导入失败时清理那半个文件要用它。
    fn remove_file(&self, path: &Path) -> AppResult<()>;

    /// 这个后端手里的路径**是不是真的指向文件系统**？
    ///
    /// 桌面（`NativeFs`）是；SAF 不是 —— 那边的"路径"只是树的相对位置的载体，
    /// 拿给 WebView（asset 协议）或当磁盘路径用都会出错。所以这类事靠**能力**分叉，
    /// 而不是靠"现在是什么系统"。
    fn native_paths(&self) -> bool {
        true
    }

    // ── 媒体来源 ──
    //
    // 导入的"源头"在两端形态不同：桌面是文件路径，安卓是系统选择器给的
    // `content://` 文档 URI。领域层只把它当不透明标识，怎么读全在这里决定 ——
    // 这样"导入一篇照片"的规则（命名模板 / 撞名去重 / 元数据）两端一模一样。

    /// 看一眼来源（不读内容）：名字与大小。领域层靠它决定要不要算元数据。
    fn probe_source(&self, source: &MediaSource) -> AppResult<SourceInfo>;
    /// 读来源的全部字节。**只给"图片且不大"用** —— 大文件走 `copy_source` 流式复制。
    fn read_source(&self, source: &MediaSource) -> AppResult<Vec<u8>>;
    /// 把来源**流式**复制到 dest，一遍过把 sha256 也算掉（大视频不进内存）。
    fn copy_source(&self, source: &MediaSource, dest: &Path) -> AppResult<CopiedFile>;

    /// 文本落盘：**行尾一律 LF**。跨端一致要靠它 —— Windows 写出的 CRLF 会让
    /// 别的端与 git 看到"整个文件都变了"（storage.rs 的 `write_text_atomic` 一直在做这件事）。
    fn write_text(&self, path: &Path, text: &str) -> AppResult<()> {
        self.write_bytes(path, text.replace("\r\n", "\n").as_bytes())
    }

    /// 读文本，读不到就是空串（`note.md` 缺了不该让整条记录读不出来）。
    fn read_text_or_empty(&self, path: &Path) -> String {
        self.read_text(path).unwrap_or_default()
    }
}

/// 临时文件路径：`entry.json` → `entry.json.tmp`（同目录，rename 才可能是原子的）。
pub fn tmp_path(path: &Path) -> PathBuf {
    let mut raw = path.as_os_str().to_owned();
    raw.push(".tmp");
    PathBuf::from(raw)
}

/// 桌面（以及安卓上的应用私有目录）：直通 `std::fs`。
pub struct NativeFs;

impl VaultStore for NativeFs {
    fn read_bytes(&self, path: &Path) -> AppResult<Vec<u8>> {
        Ok(std::fs::read(path)?)
    }

    fn read_text(&self, path: &Path) -> AppResult<String> {
        Ok(std::fs::read_to_string(path)?)
    }

    fn write_bytes(&self, path: &Path, bytes: &[u8]) -> AppResult<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = tmp_path(path);
        std::fs::write(&tmp, bytes)?;
        // 同目录 rename：Windows / POSIX 上都覆盖且原子
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    fn list_dir(&self, path: &Path) -> AppResult<Vec<DirEntry>> {
        let mut out = Vec::new();
        for item in std::fs::read_dir(path)? {
            let item = item?;
            let name = item.file_name().to_string_lossy().to_string();
            let is_dir = item.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let size = if is_dir {
                0
            } else {
                item.metadata().map(|m| m.len()).unwrap_or(0)
            };
            out.push(DirEntry { name, is_dir, size });
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    fn create_dir_all(&self, path: &Path) -> AppResult<()> {
        Ok(std::fs::create_dir_all(path)?)
    }

    fn rename(&self, from: &Path, to: &Path) -> AppResult<()> {
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Ok(std::fs::rename(from, to)?)
    }

    fn remove_dir_all(&self, path: &Path) -> AppResult<()> {
        Ok(std::fs::remove_dir_all(path)?)
    }

    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }

    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn remove_file(&self, path: &Path) -> AppResult<()> {
        Ok(std::fs::remove_file(path)?)
    }

    fn probe_source(&self, source: &MediaSource) -> AppResult<SourceInfo> {
        let path = match source {
            MediaSource::Path(path) => path,
            MediaSource::Uri(uri) => {
                return Err(AppError::Invalid(format!("这条来源只有安卓认识：{uri}")))
            }
        };
        let meta = std::fs::metadata(path)
            .map_err(|_| AppError::Invalid(format!("找不到这个文件：{}", path.display())))?;
        if !meta.is_file() {
            return Err(AppError::Invalid(format!("不是文件：{}", path.display())));
        }
        Ok(SourceInfo {
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            size: meta.len(),
        })
    }

    fn read_source(&self, source: &MediaSource) -> AppResult<Vec<u8>> {
        match source {
            MediaSource::Path(path) => Ok(std::fs::read(path)?),
            MediaSource::Uri(uri) => Err(AppError::Invalid(format!(
                "这条来源只有安卓认识：{uri}"
            ))),
        }
    }

    fn copy_source(&self, source: &MediaSource, dest: &Path) -> AppResult<CopiedFile> {
        let path = match source {
            MediaSource::Path(path) => path,
            MediaSource::Uri(uri) => {
                return Err(AppError::Invalid(format!("这条来源只有安卓认识：{uri}")))
            }
        };
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // 一遍过：边拷边算哈希（原来是拷完之后再读一遍整个文件算）
        let mut input = std::fs::File::open(path)?;
        let mut output = std::fs::File::create(dest)?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 64 * 1024];
        let mut size = 0u64;
        loop {
            let read = input.read(&mut buf)?;
            if read == 0 {
                break;
            }
            hasher.update(&buf[..read]);
            output.write_all(&buf[..read])?;
            size += read as u64;
        }
        Ok(CopiedFile {
            size,
            hash: hasher.finalize().iter().map(|b| format!("{b:02x}")).collect(),
        })
    }
}

/// 内存实现：**给测试用的**，也是"SAF 实现该有什么语义"的可执行说明书。
///
/// 它是 `pub` 的（不是 `#[cfg(test)]`），因为集成测试 `tests/*.rs` 看不到 crate 内部的测试项 ——
/// 而那批"磁盘形状"的断言要能在两种实现上各跑一遍才有意义。
#[derive(Default)]
pub struct MemStore {
    files: Mutex<HashMap<String, Vec<u8>>>,
    dirs: Mutex<HashSet<String>>,
}

impl MemStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn key(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }
}

impl VaultStore for MemStore {
    fn remove_file(&self, path: &Path) -> AppResult<()> {
        self.files.lock().unwrap().remove(&Self::key(path));
        Ok(())
    }

    fn native_paths(&self) -> bool {
        false
    }

    // 内存实现没有"仓库外面的文件"，导入那条链一律报错 ——
    // 它守的是"仓库内部读写长什么样"，不是"字节从哪来"。
    fn probe_source(&self, _source: &MediaSource) -> AppResult<SourceInfo> {
        Err(AppError::Invalid("内存实现不支持外部来源".to_string()))
    }

    fn read_source(&self, _source: &MediaSource) -> AppResult<Vec<u8>> {
        Err(AppError::Invalid("内存实现不支持外部来源".to_string()))
    }

    fn copy_source(&self, _source: &MediaSource, _dest: &Path) -> AppResult<CopiedFile> {
        Err(AppError::Invalid("内存实现不支持外部来源".to_string()))
    }

    fn read_bytes(&self, path: &Path) -> AppResult<Vec<u8>> {
        let key = Self::key(path);
        self.files
            .lock()
            .unwrap()
            .get(&key)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("没有这个文件：{key}")))
    }

    fn read_text(&self, path: &Path) -> AppResult<String> {
        let bytes = self.read_bytes(path)?;
        String::from_utf8(bytes)
            .map_err(|e| AppError::Invalid(format!("不是 UTF-8：{e}")))
    }

    fn write_bytes(&self, path: &Path, bytes: &[u8]) -> AppResult<()> {
        let key = Self::key(path);
        // 父目录得存在（与 NativeFs 的 create_dir_all 一致）
        if let Some(parent) = path.parent() {
            let parent_key = Self::key(parent);
            if !parent_key.is_empty() && parent_key != "/" {
                self.dirs.lock().unwrap().insert(parent_key);
            }
        }
        self.files.lock().unwrap().insert(key, bytes.to_vec());
        Ok(())
    }

    fn list_dir(&self, path: &Path) -> AppResult<Vec<DirEntry>> {
        let base = format!("{}/", Self::key(path));
        let mut out: Vec<DirEntry> = Vec::new();

        for name in self.dirs.lock().unwrap().iter() {
            if let Some(rest) = name.strip_prefix(&base) {
                if !rest.is_empty() && !rest.contains('/') {
                    out.push(DirEntry {
                        name: rest.to_string(),
                        is_dir: true,
                        size: 0,
                    });
                }
            }
        }
        for (name, bytes) in self.files.lock().unwrap().iter() {
            if let Some(rest) = name.strip_prefix(&base) {
                if !rest.is_empty() && !rest.contains('/') {
                    out.push(DirEntry {
                        name: rest.to_string(),
                        is_dir: false,
                        size: bytes.len() as u64,
                    });
                }
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out.dedup_by(|a, b| a.name == b.name);
        Ok(out)
    }

    fn create_dir_all(&self, path: &Path) -> AppResult<()> {
        let mut acc = String::new();
        for segment in Self::key(path).split('/') {
            if segment.is_empty() {
                acc.push('/');
                continue;
            }
            acc.push_str(segment);
            self.dirs.lock().unwrap().insert(acc.clone());
            acc.push('/');
        }
        Ok(())
    }

    fn rename(&self, from: &Path, to: &Path) -> AppResult<()> {
        let from_key = Self::key(from);
        let to_key = Self::key(to);

        if let Some(bytes) = self.files.lock().unwrap().remove(&from_key) {
            self.write_bytes(to, &bytes)?;
            return Ok(());
        }
        // 目录：整棵子树一起搬
        let prefix = format!("{from_key}/");
        let files: Vec<(String, Vec<u8>)> = {
            let mut guard = self.files.lock().unwrap();
            let keys: Vec<String> = guard.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
            keys.into_iter()
                .filter_map(|k| guard.remove(&k).map(|v| (k, v)))
                .collect()
        };
        let dirs: Vec<String> = {
            let mut guard = self.dirs.lock().unwrap();
            // 注意要连**它自己**那个节点一起摘掉（只按 `from/` 前缀过滤会漏掉它）
            let keys: Vec<String> = guard
                .iter()
                .filter(|k| *k == &from_key || k.starts_with(&prefix))
                .cloned()
                .collect();
            for k in &keys {
                guard.remove(k);
            }
            keys
        };
        if files.is_empty() && dirs.is_empty() {
            return Err(AppError::NotFound(format!("没有这个目录：{from_key}")));
        }
        for (key, bytes) in files {
            let tail = &key[from_key.len()..];
            self.write_bytes(Path::new(&format!("{to_key}{tail}")), &bytes)?;
        }
        for key in dirs {
            let tail = &key[from_key.len()..];
            self.create_dir_all(Path::new(&format!("{to_key}{tail}")))?;
        }
        self.create_dir_all(to)?;
        Ok(())
    }

    fn remove_dir_all(&self, path: &Path) -> AppResult<()> {
        let key = Self::key(path);
        let prefix = format!("{key}/");
        self.files.lock().unwrap().retain(|k, _| k != &key && !k.starts_with(&prefix));
        self.dirs.lock().unwrap().retain(|k| k != &key && !k.starts_with(&prefix));
        Ok(())
    }

    fn is_file(&self, path: &Path) -> bool {
        self.files.lock().unwrap().contains_key(&Self::key(path))
    }

    fn is_dir(&self, path: &Path) -> bool {
        self.dirs.lock().unwrap().contains(&Self::key(path))
    }
}

/// 一个仓库的**根 + 用哪套存储读写它**。
///
/// 领域函数原来第一个参数是 `vault: &Path`；改成它之后，"根在哪儿"和"怎么读写"都跟着句柄走，
/// 换平台只换句柄的构造，领域代码一行不改。
#[derive(Clone)]
pub struct Vault {
    root: PathBuf,
    store: Arc<dyn VaultStore>,
}

impl Vault {
    pub fn new(root: PathBuf, store: Arc<dyn VaultStore>) -> Self {
        Self { root, store }
    }

    /// 桌面（与安卓私有目录）的常见构造：真实路径 + `NativeFs`
    pub fn at(root: PathBuf) -> Self {
        Self::new(root, Arc::new(NativeFs))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn store(&self) -> &dyn VaultStore {
        self.store.as_ref()
    }

    /// 拼一个仓库内的绝对路径：领域层的路径算术都走它（根 join 相对路径）
    pub fn join<P: AsRef<Path>>(&self, rel: P) -> PathBuf {
        self.root.join(rel)
    }

    /// 这个绝对路径相对根的位置（SAF 实现需要它换算成树里的相对路径）
    pub fn relative<'a>(&self, path: &'a Path) -> Option<&'a Path> {
        path.strip_prefix(&self.root).ok()
    }

    pub fn read_text(&self, path: &Path) -> AppResult<String> {
        self.store.read_text(path)
    }

    pub fn read_text_or_empty(&self, path: &Path) -> String {
        self.store.read_text_or_empty(path)
    }

    pub fn read_bytes(&self, path: &Path) -> AppResult<Vec<u8>> {
        self.store.read_bytes(path)
    }

    pub fn write_bytes(&self, path: &Path, bytes: &[u8]) -> AppResult<()> {
        self.store.write_bytes(path, bytes)
    }

    pub fn write_text(&self, path: &Path, text: &str) -> AppResult<()> {
        self.store.write_text(path, text)
    }

    pub fn list_dir(&self, path: &Path) -> AppResult<Vec<DirEntry>> {
        self.store.list_dir(path)
    }

    pub fn create_dir_all(&self, path: &Path) -> AppResult<()> {
        self.store.create_dir_all(path)
    }

    pub fn rename(&self, from: &Path, to: &Path) -> AppResult<()> {
        self.store.rename(from, to)
    }

    pub fn remove_dir_all(&self, path: &Path) -> AppResult<()> {
        self.store.remove_dir_all(path)
    }

    pub fn is_file(&self, path: &Path) -> bool {
        self.store.is_file(path)
    }

    pub fn is_dir(&self, path: &Path) -> bool {
        self.store.is_dir(path)
    }
}

/// **迁移期的过渡写法**：领域函数的第一个参数要"一个仓库句柄"。
///
/// 两种调用都合法：
/// - 给 `&Vault`（**带 store** —— 安卓 SAF 走这条，桌面也走这条）；
/// - **只在测试里**，还给 `&Path` / `PathBuf`（等价于 `Vault::at(那个路径)`，即桌面文件系统）。
///
/// ⚠️ **`Path` / `PathBuf` 那两个 impl 加了 `#[cfg(test)]`，这是刻意的，不是偷懒**：
/// 生产代码里"把一条路径当句柄用"曾经造成过一个真 bug —— 安卓上 SAF 的 `content://` 路径
/// 被包装成**桌面文件系统**句柄，于是"文件明明在磁盘上却报缺 `entry.json`"，
/// 而桌面上一切正常、单测全绿（见执行计划 P1）。
/// 现在生产代码只能传句柄：**再犯这种错会直接编译不过**，而不是静默走错后端。
///
/// 测试里保留快捷写法是为了少改几百处断言；等测试也全改完，这个 trait 就可以整个删掉。
pub trait AsVault {
    fn as_vault(&self) -> Vault;
}

impl AsVault for Vault {
    fn as_vault(&self) -> Vault {
        self.clone()
    }
}

/// **测试专用**：把路径当仓库根（生产代码禁止，原因见 trait 的文档）
#[cfg(test)]
impl AsVault for Path {
    fn as_vault(&self) -> Vault {
        Vault::at(self.to_path_buf())
    }
}

/// **测试专用**：同上
#[cfg(test)]
impl AsVault for PathBuf {
    fn as_vault(&self) -> Vault {
        Vault::at(self.clone())
    }
}

/// 引用透传：`&Vault` 能直接当参数用
impl<T: AsVault + ?Sized> AsVault for &T {
    fn as_vault(&self) -> Vault {
        (**self).as_vault()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("framevault-store-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// **同一套断言跑两种实现**：这是 SAF 实现的网络 —— 桌面那批"磁盘形状"的断言
    /// 用的是裸 `std::fs`，SAF 下没有磁盘可看，所以语义必须钉在这一层。
    fn conformance(store: Arc<dyn VaultStore>, root: PathBuf) {
        let vault = Vault::new(root, store);

        // 写（父目录自动建）+ 读回
        let note = vault.join("科研/论文笔记/2026-09-24 周报/note.md");
        vault.write_text(&note, "# 标题\n正文\n").unwrap();
        assert_eq!(vault.read_text(&note).unwrap(), "# 标题\n正文\n");
        assert!(vault.is_file(&note));
        assert!(vault.is_dir(&vault.join("科研/论文笔记/2026-09-24 周报")));

        // 行尾归一：CRLF 进来，LF 存下去（跨端一致）
        let other = vault.join("随笔/note.md");
        vault.write_text(&other, "a\r\nb\r\n").unwrap();
        assert_eq!(vault.read_text(&other).unwrap(), "a\nb\n");

        // 原子写的中间文件不许留在目录里
        let names: Vec<String> = vault
            .list_dir(&vault.join("随笔"))
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, vec!["note.md".to_string()]);

        // 覆盖写：内容换了，还是没有残留
        vault.write_text(&other, "新内容").unwrap();
        assert_eq!(vault.read_text(&other).unwrap(), "新内容");

        // 列目录：名字 + 是不是目录
        let mut entries = vault.list_dir(&vault.join("科研/论文笔记")).unwrap();
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(
            entries,
            vec![DirEntry {
                name: "2026-09-24 周报".to_string(),
                is_dir: true,
                size: 0
            }]
        );

        // 改名（同父）
        let renamed = vault.join("科研/论文笔记/2026-09-24 周报-改");
        vault
            .rename(&vault.join("科研/论文笔记/2026-09-24 周报"), &renamed)
            .unwrap();
        assert!(vault.is_file(&renamed.join("note.md")));
        assert!(!vault.is_dir(&vault.join("科研/论文笔记/2026-09-24 周报")));

        // 跨父搬（换归属 = 真搬目录）
        vault.create_dir_all(&vault.join("未归类")).unwrap();
        let moved = vault.join("未归类/2026-09-24 周报-改");
        vault.rename(&renamed, &moved).unwrap();
        assert!(vault.is_file(&moved.join("note.md")));

        // 删
        vault.remove_dir_all(&vault.join("未归类")).unwrap();
        assert!(!vault.is_dir(&vault.join("未归类")));
        assert!(!vault.is_file(&moved.join("note.md")));

        // 不存在的路径：探针返回 false，读返回 Err
        let ghost = vault.join("不存在");
        assert!(!vault.is_file(&ghost) && !vault.is_dir(&ghost));
        assert!(vault.read_text(&ghost).is_err());
        // `read_text_or_empty` 是给 note.md 用的：缺了就当空
        assert_eq!(vault.read_text_or_empty(&ghost), "");
    }

    #[test]
    fn native_fs_satisfies_the_contract() {
        conformance(Arc::new(NativeFs), scratch("native"));
    }

    #[test]
    fn mem_store_satisfies_the_same_contract() {
        // 内存实现用同一个根路径字符串；它自己维护目录与文件集合
        conformance(Arc::new(MemStore::new()), PathBuf::from("/mem-vault"));
    }

    /// 仓库相对路径：SAF 实现要靠它把绝对路径换算成树里的相对路径。
    #[test]
    fn relative_path_is_the_tail_under_the_root() {
        let vault = Vault::at(PathBuf::from("/tmp/仓库"));
        assert_eq!(
            vault.relative(Path::new("/tmp/仓库/科研/note.md")),
            Some(Path::new("科研/note.md"))
        );
        assert_eq!(vault.relative(Path::new("/别处/note.md")), None);
    }
}
