import { Fragment, useMemo, type ReactNode } from "react";
import { parseMarkdown, type MdNode } from "../../../markdown/parse";
import { BLOCKS, INLINES, type Ctx } from "./registry";
import "./MarkdownView.css";

/**
 * 把一段 Markdown 渲染成 React 节点。
 *
 * 三条规矩（写在 ARCHITECTURE_IMPL §4.9）：
 *   1. 原始 HTML 不渲染，给一条看得见的提示；
 *   2. 认不出的节点降级显示内容（**不许白屏**，跟"认不出的主题"同一条规矩）；
 *   3. 只读文本、绝不回写：渲染是只读投影。
 */
function inlineChildren(node: MdNode): ReactNode {
  const children = node.children ?? [];
  return children.map((child, i) => <Fragment key={i}>{renderInline(child)}</Fragment>);
}

function ctxFor(node: MdNode): Ctx {
  return { children: inlineChildren(node), inline: inlineChildren };
}

function renderInline(node: MdNode): ReactNode {
  const renderer = INLINES[node.type];
  if (renderer) return renderer({ node, ctx: ctxFor(node) });
  return fallback(node, true);
}

function renderBlock(node: MdNode): ReactNode {
  const renderer = BLOCKS[node.type];
  if (renderer) return renderer({ node, ctx: ctxFor(node) });
  return fallback(node, false);
}

/** 认不出的节点：有文字就显示文字，有子节点就显示子节点，都没有就什么都不显示 */
function fallback(node: MdNode, inline: boolean): ReactNode {
  if (typeof node.value === "string") return node.value;
  const children = node.children ?? [];
  if (children.length === 0) return null;
  if (inline) return inlineChildren(node);
  return children.map((child, i) => <Fragment key={i}>{renderBlock(child)}</Fragment>);
}

export default function MarkdownView({ text }: { text: string }) {
  const root = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="md">
      {root.children.map((child, i) => (
        <Fragment key={i}>{renderBlock(child)}</Fragment>
      ))}
    </div>
  );
}
