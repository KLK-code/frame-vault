/** 哪些 token 允许在界面上实时调整。
 *  这里是唯一的一份清单——加一个可调项只要往下面加一行。 */
export type TokenDef = {
  key: string;
  label: string;
  /** 一句话说明它影响哪些地方（和 Obsidian 的设置项一样，有说明才像个正经设置） */
  desc?: string;
  kind: "color" | "length" | "text";
  min?: number;
  max?: number;
  step?: number;
};

export type TokenGroup = { title: string; tokens: TokenDef[] };

export const TOKEN_GROUPS: TokenGroup[] = [
  {
    title: "字体",
    tokens: [
      {
        key: "--fv-font-sans",
        label: "界面字体",
        desc: "按优先级排列的字体栈，逗号分隔；找不到的字体会自动往后退",
        kind: "text",
      },
    ],
  },
  {
    title: "主色",
    tokens: [
      {
        key: "--fv-color-accent",
        label: "主色",
        desc: "选中项、聚焦环、菜单圆点、进度等强调元素",
        kind: "color",
      },
      {
        key: "--fv-color-accent-soft",
        label: "选中底色",
        desc: "导航与菜单里当前项的底色",
        kind: "color",
      },
      {
        key: "--fv-color-accent-hover",
        label: "悬停淡色",
        desc: "鼠标悬停在可选项目上时的底色",
        kind: "color",
      },
      {
        key: "--fv-color-focus-ring",
        label: "键盘聚焦环",
        desc: "用 Tab 键移动焦点时的描边颜色",
        kind: "color",
      },
    ],
  },
  {
    title: "表面与文字",
    tokens: [
      { key: "--fv-color-bg", label: "内容区底色", desc: "正文区域的背景", kind: "color" },
      {
        key: "--fv-color-surface",
        label: "侧栏 / 面板底色",
        desc: "侧栏、标题栏、卡片等次级表面",
        kind: "color",
      },
      {
        key: "--fv-color-surface-hover",
        label: "悬停底色",
        desc: "次级表面上的悬停状态",
        kind: "color",
      },
      { key: "--fv-color-text", label: "正文", desc: "主要文字颜色", kind: "color" },
      { key: "--fv-color-text-strong", label: "强调文字", desc: "标题与需要更实的文字", kind: "color" },
      { key: "--fv-color-muted", label: "次要文字", desc: "说明文字、路径、禁用态", kind: "color" },
      { key: "--fv-color-border", label: "分隔线", desc: "发丝线：边框与分割", kind: "color" },
    ],
  },
  {
    title: "圆角与尺寸",
    tokens: [
      {
        key: "--fv-titlebar-height",
        label: "标题栏高度",
        desc: "自绘标题栏的高度",
        kind: "length",
        min: 28,
        max: 48,
        step: 1,
      },
      { key: "--fv-radius-sm", label: "小圆角", desc: "按钮、导航项", kind: "length", min: 0, max: 12, step: 1 },
      { key: "--fv-radius-md", label: "中圆角", desc: "卡片、菜单、输入框", kind: "length", min: 0, max: 16, step: 1 },
      { key: "--fv-radius-lg", label: "大圆角", desc: "分组卡片、浮层", kind: "length", min: 0, max: 24, step: 1 },
    ],
  },
  {
    title: "字号与间距",
    tokens: [
      { key: "--fv-text-sm", label: "小字号", desc: "说明文字、标签", kind: "length", min: 11, max: 18, step: 1 },
      { key: "--fv-text-base", label: "基准字号", desc: "正文与设置项", kind: "length", min: 12, max: 20, step: 1 },
      { key: "--fv-text-lg", label: "大字号", desc: "分区标题", kind: "length", min: 14, max: 26, step: 1 },
      { key: "--fv-space-3", label: "间距 · 紧", desc: "卡片内边距、控件间隙", kind: "length", min: 4, max: 24, step: 1 },
      { key: "--fv-space-5", label: "间距 · 中", desc: "分组之间", kind: "length", min: 8, max: 40, step: 1 },
      { key: "--fv-space-6", label: "间距 · 松", desc: "内容区外边距", kind: "length", min: 12, max: 64, step: 2 },
    ],
  },
];

export const EDITABLE_KEYS = TOKEN_GROUPS.flatMap((g) => g.tokens.map((t) => t.key));
