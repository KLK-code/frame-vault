import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

/**
 * Markdown 的**唯一出口**。
 *
 * 别处（渲染器、主题、外壳）只认这里的类型，**不许直接 import remark** ——
 * 将来换解析器、或者加 remark-directive 之类的插件，只改这一个文件。
 *
 * 这里的类型是**结构化的最小视图**：只声明我们会读的字段，多出来的字段一律忽略。
 * 所以未知节点、将来新增的节点都不会把类型搞炸 —— 渲染器那边看到不认识的 type 会降级显示。
 */
export type MdNode = {
  type: string;
  /** text / code / html 的原始内容 */
  value?: string;
  /** heading 层级 1~6 */
  depth?: number;
  /** list：是否有序，以及起始序号 */
  ordered?: boolean | null;
  start?: number | null;
  /** listItem：GFM 任务列表的勾选态（null = 不是任务项） */
  checked?: boolean | null;
  /** code：语言标注 */
  lang?: string | null;
  /** link / image 的目标 */
  url?: string;
  /** image 的替代文字 */
  alt?: string | null;
  /** tableCell：GFM 对齐 */
  align?: "left" | "center" | "right" | null;
  children?: MdNode[];
};

export type MdRoot = MdNode & { type: "root"; children: MdNode[] };

const processor = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdown(text: string): MdRoot {
  // remark 返回的是 mdast 类型；这里刻意只做一次收窄（理由见上面的类型说明）
  return processor.parse(text) as unknown as MdRoot;
}

/** 一眼看得出「这是 Markdown」的**块级**构造 */
const MD_BLOCKS = ["heading", "list", "code", "blockquote", "table", "thematicBreak"];

/**
 * 这段文本是不是"带结构的 Markdown"。
 *
 * 只认**块级**构造：普通文本里几乎撞不上（网页文本项目符号是 "•"、标题没有 "##"），
 * 所以拿它当"要不要按 Markdown 解析这段粘贴内容"的判据是安全的。
 * 反过来，**行内**构造（`**粗**`、链接、`code`）在普通文本里太常见，一律不计入 ——
 * 判据保守一点，最多是少解析一次，不会把用户粘的富文本改坏。
 */
export function looksLikeMarkdown(text: string): boolean {
  if (!text.trim()) return false;
  const walk = (node: MdNode): boolean =>
    MD_BLOCKS.includes(node.type) || (node.children ?? []).some(walk);
  return walk(parseMarkdown(text));
}
