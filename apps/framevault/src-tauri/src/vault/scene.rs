use serde::Serialize;

/// 内置的"普通记录"场景：任何没绑定场景的文件夹最终回落到它
pub const PLAIN_SCENE: &str = "builtin.plain";

/// 一个场景（= 功能主题）的元信息。
/// 现在只有内置的；将来这里会换成"从主题包清单里读"，第三方就能带自己的场景。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub builtin: bool,
}

/// 目前可用的场景清单。M1 只需要普通记录，旅行 / 挑战等以后再加。
pub fn builtin_scenes() -> Vec<SceneInfo> {
    vec![SceneInfo {
        id: PLAIN_SCENE.to_string(),
        name: "普通记录".to_string(),
        description: "照片 + 文字的时间线，最基础的场景".to_string(),
        builtin: true,
    }]
}

/// 这个场景 id 认识吗？
pub fn is_known(id: &str) -> bool {
    builtin_scenes().iter().any(|s| s.id == id)
}
