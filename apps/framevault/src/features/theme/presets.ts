/** 内置外观预设：三套，每套都"浅 + 深"齐全（规矩见 docs/theme-contract.md §1.1）。
 *  id 改动要同步 skins.css 的选择器；加第四套 = skins.css 两个块 + 这里一行。 */
export type AppearancePreset = { id: string; name: string; desc: string };

/** 认不出选择时的兜底（也是"跟随主题"时主题没推荐时的兜底） */
export const DEFAULT_APPEARANCE = "preset.paper";

export const PRESETS: AppearancePreset[] = [
  { id: "preset.paper", name: "暖纸", desc: "米白底 + 棕色主色，最耐看" },
  { id: "preset.tide", name: "青碧", desc: "海边青绿，冷而清爽" },
  { id: "preset.ember", name: "炭火", desc: "橙红主色，有力量感" },
];

export function presetName(id: string): string {
  return PRESETS.find((p) => p.id === id)?.name ?? "默认";
}
