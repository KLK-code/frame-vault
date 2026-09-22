import type { ReactNode } from "react";
import type { MdNode } from "../../../markdown/parse";
import {
  CodeBlock, Delete, Emphasis, HardBreak, Heading, Html, Image, InlineCode,
  Link, List, ListItem, Paragraph, Quote, Strong, Table, Text, ThematicBreak,
} from "./blocks";

/**
 * 渲染注册表：**mdast 节点名 → 渲染函数**。
 *
 * 这是将来的扩展点（主题 / 插件要加自定义块，就在这里多一行），
 * 但它只认节点名，不认识任何业务概念，也不认识 remark 的具体版本。
 */
export type Ctx = {
  /** 这个节点的 children 已经渲染好 */
  children: ReactNode;
  /** 需要自己重排结构时用它渲染某个节点的 children（表格的单元格用到） */
  inline: (node: MdNode) => ReactNode;
};

export type Renderer = (props: { node: MdNode; ctx: Ctx }) => ReactNode;

export const BLOCKS: Record<string, Renderer> = {
  heading: Heading,
  paragraph: Paragraph,
  blockquote: Quote,
  list: List,
  listItem: ListItem,
  code: CodeBlock,
  thematicBreak: ThematicBreak,
  table: Table,
  html: Html,
};

export const INLINES: Record<string, Renderer> = {
  text: Text,
  strong: Strong,
  emphasis: Emphasis,
  delete: Delete,
  inlineCode: InlineCode,
  break: HardBreak,
  link: Link,
  image: Image,
  html: Html,
};
