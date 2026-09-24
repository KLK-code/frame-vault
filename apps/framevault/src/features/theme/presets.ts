/** 内置外观预设：五套，每套都"浅 + 深"齐全（规矩见 docs/theme-contract.md §1.1）。
 *  id 改动要同步 skins.css 的选择器；加一套 = skins.css 两个块 + 这里一行。
 *  **只有名字**：成套的说明留给文档，界面上多写一句就是噪音（设置里已经够长了）。
 *
 *  2026-09 起：场景**不再**推荐配色（`manifest.presentation.suggestedAppearance` 已删）——
 *  外观就是"用户选一套"，没选过就是下面这个默认。 */
export type AppearancePreset = { id: string; name: string };

/** 认不出选择时的兜底，也是没选过时的默认 */
export const DEFAULT_APPEARANCE = "preset.mono";

export const PRESETS: AppearancePreset[] = [
  { id: "preset.mono", name: "极简白" },
  { id: "preset.paper", name: "暖纸" },
  { id: "preset.tide", name: "青碧" },
  { id: "preset.ember", name: "炭火" },
  { id: "preset.azure", name: "晴空" },
];
