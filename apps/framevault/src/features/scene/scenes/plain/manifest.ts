import type { SceneManifest } from "../../manifest";

/**
 * 普通记录：只有一件"主题特有"的东西——正文。
 * 它自己不写 input，只声明"我有一个多行文本字段"，表单由核心渲染。
 */
const manifest: SceneManifest = {
  presentation: {
    icon: "book", eyebrow: "DAILY JOURNAL", suggestedAppearance: "preset.paper",
  },
  entryFields: [
    { key: "text", label: "正文", type: "textarea", placeholder: "写点什么…" },
  ],
};

export default manifest;
