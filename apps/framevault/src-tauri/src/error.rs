use serde::ser::{Serialize, Serializer};

/// 全局错误类型。
///
/// 有了它，命令里就不用满屏写 `map_err(|e| e.to_string())`：
/// 只要实现了 `From`，`?` 就能自动转换（这是 Rust 错误处理的标准做法）。
#[derive(Debug)]
pub enum AppError {
    Io(std::io::Error),
    Json(serde_json::Error),
    /// 参数不合法（比如"不是有效目录"）
    Invalid(String),
    /// 找不到东西（**明确不存在** —— 这是唯一允许"那就新建吧""那就当没有"的依据）
    NotFound(String),
    /// 没有权限（用户的目录授权被撤销、或系统不允许访问这个位置）
    NoPermission(String),
    /// 暂时不可用（存储服务抖动、SAF 桥失败、没联网的网盘……）——
    /// **它和"不存在"是两回事**：拿它去新建/清空就是丢数据
    Unavailable(String),
    /// 内容损坏（JSON 解析不了、字段对不上）
    Corrupt(String),
    /// 还没有选择仓库
    NotSelected,
    /// 来自 Tauri 本身（窗口操作等）
    Tauri(tauri::Error),
}

pub type AppResult<T> = Result<T, AppError>;

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Json(e)
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Tauri(e)
    }
}

/// 锁被毒化（别的线程 panic 了）——这样 `.lock()?` 也能直接用
impl<T> From<std::sync::PoisonError<T>> for AppError {
    fn from(_: std::sync::PoisonError<T>) -> Self {
        AppError::Invalid("状态锁已损坏".to_string())
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Io(e) => write!(f, "文件操作失败：{e}"),
            AppError::Json(e) => write!(f, "数据格式不对：{e}"),
            AppError::Invalid(msg) => write!(f, "{msg}"),
            AppError::NotFound(msg) => write!(f, "{msg}"),
            AppError::NoPermission(msg) => write!(f, "没有访问权限：{msg}"),
            AppError::Unavailable(msg) => write!(f, "存储暂时不可用：{msg}"),
            AppError::Corrupt(msg) => write!(f, "文件内容有问题：{msg}"),
            AppError::NotSelected => write!(f, "还没有选择仓库"),
            AppError::Tauri(e) => write!(f, "窗口操作失败：{e}"),
        }
    }
}

impl std::error::Error for AppError {}

/// Tauri 要求错误能序列化：直接变成一句人话给前端
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
