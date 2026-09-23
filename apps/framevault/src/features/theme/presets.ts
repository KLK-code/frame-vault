/** 内置外观预设：三套，每套都"浅 + 深"齐全（规矩见 docs/theme-contract.md §1.1）。
 *  id 改动要同步 skins.css 的选择器；加第四套 = skins.css 两个块 + 这里一行。
 *  **只有名字**：成套的说明留给文档，界面上多写一句就是噪音（设置里已经够长了）。 */
export type AppearancePreset = { id: string; name: string };

/** 认不出选择时的兜底（也是"跟随主题"时主题没推荐时的兜底） */
export const DEFAULT_APPEARANCE = "preset.paper";

export const PRESETS: AppearancePreset[] = [
  { id: "preset.paper", name: "暖纸" },
  { id: "preset.tide", name: "青碧" },
  { id: "preset.ember", name: "炭火" },
];
