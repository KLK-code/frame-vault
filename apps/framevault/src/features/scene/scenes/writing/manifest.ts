import type { SceneManifest } from "../../manifest";

/**
 * 写作台：一屏一篇，为**长文写作**优化的功能主题。
 *
 * 跟其他三个主题的分工：普通日记 / 旅行 / 挑战是"快速记录"（一两句 + 照片）；
 * 这个主题是"坐下来写"——照片收在上方一条可收起的卡片里，下面整块归正文。
 *
 * 它只用公开接口：字段靠这份声明、表单靠 SceneFields、编辑器靠 MarkdownField、
 * 大图靠 MediaLightbox。所以它将来原样搬成插件时不用改代码。
 */
const manifest: SceneManifest = {
  presentation: {
    icon: "book",
  },
  entryFields: [
    // 刻意**没有**「地点」：写作台是坐下来写的地方，位置这类元数据属于内容侧（主题/文件夹），
    // 不塞进正文这一屏（2026-09 按用户意见删掉；老记录里的 location 仍在 entry.json 里，只是不再显示）
    {
      key: "text",
      label: "正文",
      type: "textarea",
      // note: true = 这一篇的正文就是记录目录里的 note.md（磁盘上真有一个 .md 文件）
      note: true,
      placeholder: "开始写…（支持 Markdown：# 标题、**加粗**、- 列表、> 引用、表格）",
    },
  ],
  mediaNameTemplate: "{date}_{title}_{n}",
};

export default manifest;
