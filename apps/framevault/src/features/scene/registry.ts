import type { SceneUnit } from "./manifest";
import challengeScene from "./scenes/challenge";
import plainScene from "./scenes/plain";
import travelScene from "./scenes/travel";

export type { FieldDecl, SceneManifest, SceneUnit, SceneViewProps } from "./manifest";

/**
 * 主题注册表：**id → 主题单元**。
 *
 * 一个主题 = 一个目录（`scenes/<id>/`），里面是"声明（manifest）+ 视图（View）+ 自己的样式"。
 * 注册表只做汇总，不认识主题内部——所以加主题是"加一个目录 + 这里一行"，
 * 主题之间也互不影响。将来主题包自带 manifest 时，这里换成动态加载。
 *
 * 注意：Rust 的 `builtin_scenes()` 也要登记同一个 id（它负责"这个 id 能不能存进 folder.json"）。
 * 两边只缺一边时，界面会显示"主题没有安装"的兜底提示，而不是白屏。
 */
export const SCENES: Record<string, SceneUnit> = {
  "builtin.plain": plainScene,
  "builtin.challenge": challengeScene,
  "builtin.travel": travelScene,
};

export function sceneOf(id: string): SceneUnit | undefined {
  return SCENES[id];
}

/** 这个主题推荐哪套外观？认不出的主题返回 undefined（回落默认预设） */
export function suggestedAppearanceOf(id: string | undefined): string | undefined {
  return id ? SCENES[id]?.manifest.presentation?.suggestedAppearance : undefined;
}
