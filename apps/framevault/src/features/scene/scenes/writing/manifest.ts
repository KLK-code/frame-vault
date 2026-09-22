import type { SceneManifest } from "../../manifest";

/**
 * 写作台：一屏一篇，为**长文写作**优化的功能主题。
 *
 * 跟其他三个主题的分工：普通日记 / 旅行 / 挑战是"快速记录"（一两句 + 照片）；
 * 这个主题是"坐下来写"——正文占满一屏、桌面并排预览、元数据（地点）收在页头。
 *
 * 它只用公开接口：字段靠这份声明、表单靠 SceneFields、编辑器靠 MarkdownField、
 * 大图靠 MediaLightbox。所以它将来原样搬成插件时不用改代码。
 */
const manifest: SceneManifest = {
  presentation: {
    icon: "book", eyebrow: "WRITING", suggestedAppearance: "preset.paper",
  },
  entryFields: [
    { key: "location", label: "地点", type: "text", placeholder: "在哪里写的" },
    {
      key: "text",
      label: "正文",
      type: "textarea",
      placeholder: "开始写…（支持 Markdown：# 标题、**加粗**、- 列表、> 引用、表格）",
    },
  ],
};

export default manifest;
