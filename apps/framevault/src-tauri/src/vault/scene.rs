use serde::Serialize;

/// 内置的"普通记录"场景：任何没绑定场景的文件夹最终回落到它
pub const PLAIN_SCENE: &str = "builtin.plain";

/// 内置的"挑战 / 打卡"场景：连续打卡，顶部显示进度与连续天数
pub const CHALLENGE_SCENE: &str = "builtin.challenge";

pub const TRAVEL_SCENE: &str = "builtin.travel";

/// 内置的"写作台"场景：一屏一篇，为长文写作优化（Markdown + 并排预览）
pub const WRITING_SCENE: &str = "builtin.writing";

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

/// 目前可用的场景清单。
///
/// 加一个场景的完整动作本来有两步：这里登记一行 + 前端 `registry.ts` 加一行映射。
/// 如果哪天两边只有一边有，界面会给"主题没安装"的兜底提示，而不是白屏。
pub fn builtin_scenes() -> Vec<SceneInfo> {
    vec![
        SceneInfo {
            id: PLAIN_SCENE.to_string(),
            name: "普通日记".to_string(),
            description: "记录生活，那些细小而珍贵的瞬间".to_string(),
            builtin: true,
        },
        SceneInfo {
            id: TRAVEL_SCENE.to_string(),
            name: "旅行".to_string(),
            description: "收藏世界，也收藏自己：用地点、文字与照片记录旅程".to_string(),
            builtin: true,
        },
        SceneInfo {
            id: WRITING_SCENE.to_string(),
            name: "写作台".to_string(),
            description: "一屏一篇：Markdown 写作 + 并排预览".to_string(),
            builtin: true,
        },
        SceneInfo {
            id: CHALLENGE_SCENE.to_string(),
            name: "挑战".to_string(),
            description: "挑战今天，遇见更强的自己：进度、连续天数与打卡记录".to_string(),
            builtin: true,
        },
    ]
}

/// 这个场景 id 认识吗？
pub fn is_known(id: &str) -> bool {
    builtin_scenes().iter().any(|s| s.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_scenes_cover_plain_and_challenge() {
        let list = builtin_scenes();
        assert!(is_known(PLAIN_SCENE));
        assert!(is_known(CHALLENGE_SCENE));
        assert!(is_known(WRITING_SCENE));
        assert!(!is_known("vendor.unknown"));
        assert!(list.iter().all(|s| s.builtin));

        let mut ids: Vec<_> = list.iter().map(|s| s.id.clone()).collect();
        let total = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), total, "场景 id 不许重复");
    }

    #[test]
    fn every_scene_has_a_name_and_description() {
        for scene in builtin_scenes() {
            assert!(!scene.name.trim().is_empty(), "{} 没名字", scene.id);
            assert!(
                !scene.description.trim().is_empty(),
                "{} 没描述——界面上的主题标签会空着",
                scene.id
            );
        }
    }

    #[test]
    fn travel_can_be_selected_and_survives_folder_roundtrip() {
        assert!(is_known("builtin.travel"), "旅行必须能通过绑定主题的校验");
        let folder = super::super::folder::FolderMeta::new(
            "travel-test", "旅途", 0, Some("builtin.travel".into()),
        );
        let json = serde_json::to_string(&folder).unwrap();
        let restored: super::super::folder::FolderMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.effective_scene(), "builtin.travel");
    }
}
