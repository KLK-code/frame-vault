use crate::vault::write_json_atomic;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

/// 已知仓库列表 + 当前仓库；会持久化成 vaults.json
#[derive(Default, Serialize, Deserialize)]
pub struct VaultRegistry {
    pub active: Option<PathBuf>,
    pub known: Vec<PathBuf>,
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

    /// 启动时调一次：把上次的列表读回来
    pub fn load(&self) -> std::io::Result<()> {
        if !self.config_path.exists() {
            return Ok(()); // 第一次运行，正常情况
        }
        let text = std::fs::read_to_string(&self.config_path)?;
        let reg: VaultRegistry = serde_json::from_str(&text)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        *self.vaults.lock().unwrap() = reg;
        Ok(())
    }

    /// 每次改动后调一次：写回磁盘
    pub fn save(&self) -> std::io::Result<()> {
        let guard = self.vaults.lock().unwrap();
        write_json_atomic(&self.config_path, &*guard)
    }
}
