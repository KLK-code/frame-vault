import type { SceneManifest } from "../../manifest";

/**
 * 普通记录：只有一件"主题特有"的东西——正文。
 * 它自己不写 input，只声明"我有一个多行文本字段"，表单由核心渲染。
 */
const manifest: SceneManifest = {
  presentation: {
    icon: "book",
  },
  entryFields: [
    // note: true = 正文落磁盘上的 note.md（记录目录里能直接打开的那个文件）
    { key: "text", label: "正文", type: "textarea", note: true, placeholder: "写点什么…" },
  ],
  // 媒体导入时按这个模板生成文件名（可选；不写走核心默认）
  mediaNameTemplate: "{date}_{title}_{n}",
};

export default manifest;
