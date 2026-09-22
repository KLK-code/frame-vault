/** 哪些 token 允许在界面上实时调整。
 *  这里是唯一的一份清单——加一个可调项只要往下面加一行。 */
export type TokenDef = {
  key: string;
  label: string;
  kind: "color" | "length";
  /** length 用：滑块范围与步长（单位 px） */
  min?: number;
  max?: number;
  step?: number;
};

export type TokenGroup = { title: string; tokens: TokenDef[] };

export const TOKEN_GROUPS: TokenGroup[] = [
  {
    title: "主色",
    tokens: [
      { key: "--fv-color-accent", label: "主色", kind: "color" },
      { key: "--fv-color-accent-soft", label: "选中底色", kind: "color" },
      { key: "--fv-color-accent-hover", label: "悬停淡色", kind: "color" },
      { key: "--fv-color-focus-ring", label: "键盘聚焦环", kind: "color" },
    ],
  },
  {
    title: "表面与文字",
    tokens: [
      { key: "--fv-color-bg", label: "内容区底色", kind: "color" },
      { key: "--fv-color-surface", label: "侧栏 / 面板底色", kind: "color" },
      { key: "--fv-color-surface-hover", label: "悬停底色", kind: "color" },
      { key: "--fv-color-text", label: "正文", kind: "color" },
      { key: "--fv-color-text-strong", label: "强调文字", kind: "color" },
      { key: "--fv-color-muted", label: "次要文字", kind: "color" },
      { key: "--fv-color-border", label: "分隔线", kind: "color" },
    ],
  },
  {
    title: "圆角与尺寸",
    tokens: [
      { key: "--fv-titlebar-height", label: "标题栏高度", kind: "length", min: 24, max: 48, step: 1 },
      { key: "--fv-radius-sm", label: "小圆角", kind: "length", min: 0, max: 12, step: 1 },
      { key: "--fv-radius-md", label: "中圆角", kind: "length", min: 0, max: 16, step: 1 },
      { key: "--fv-radius-lg", label: "大圆角", kind: "length", min: 0, max: 24, step: 1 },
    ],
  },
  {
    title: "字号与间距",
    tokens: [
      { key: "--fv-text-sm", label: "小字号", kind: "length", min: 10, max: 16, step: 1 },
      { key: "--fv-text-base", label: "基准字号", kind: "length", min: 11, max: 18, step: 1 },
      { key: "--fv-text-lg", label: "大字号", kind: "length", min: 13, max: 22, step: 1 },
      { key: "--fv-space-3", label: "间距 · 紧", kind: "length", min: 4, max: 24, step: 1 },
      { key: "--fv-space-5", label: "间距 · 中", kind: "length", min: 8, max: 40, step: 1 },
      { key: "--fv-space-6", label: "间距 · 松", kind: "length", min: 12, max: 64, step: 2 },
    ],
  },
];

export const EDITABLE_KEYS = TOKEN_GROUPS.flatMap((g) => g.tokens.map((t) => t.key));
