import { Fragment } from "react";
import { openExternal } from "../../../lib/api";
import type { MdNode } from "../../../markdown/parse";
import type { Ctx } from "./registry";

/**
 * 这些组件只负责"长什么样"：不认识数据来源、不自己取数据、也不认识 remark。
 * 统一收一个 props 包：{ node, ctx }，其中 ctx.children 是已经渲染好的子节点。
 */

/** 认不出的节点 / 原始 HTML：给一条看得见的提示，不静默丢掉 */
export function Notice({ text }: { text: string }) {
  return <p className="md__notice">{text}</p>;
}

export function Html() {
  return <Notice text="这段原始 HTML 已忽略（正文不允许写 HTML）" />;
}

export function Heading({ node, ctx }: { node: MdNode; ctx: Ctx }) {
  const depth = Math.min(Math.max(node.depth ?? 1, 1), 6);
  const className = "md__h md__h--" + depth;
  if (depth === 1) return <h1 className={className}>{ctx.children}</h1>;
  if (depth === 2) return <h2 className={className}>{ctx.children}</h2>;
  if (depth === 3) return <h3 className={className}>{ctx.children}</h3>;
  if (depth === 4) return <h4 className={className}>{ctx.children}</h4>;
  if (depth === 5) return <h5 className={className}>{ctx.children}</h5>;
  return <h6 className={className}>{ctx.children}</h6>;
}

export function Paragraph({ ctx }: { ctx: Ctx }) {
  return <p className="md__p">{ctx.children}</p>;
}

export function Quote({ ctx }: { ctx: Ctx }) {
  return <blockquote className="md__quote">{ctx.children}</blockquote>;
}

export function List({ node, ctx }: { node: MdNode; ctx: Ctx }) {
  if (node.ordered) {
    return (
      <ol
        className="md__list md__list--ordered"
        start={typeof node.start === "number" ? node.start : undefined}
      >
        {ctx.children}
      </ol>
    );
  }
  return <ul className="md__list">{ctx.children}</ul>;
}

export function ListItem({ node, ctx }: { node: MdNode; ctx: Ctx }) {
  const isTask = node.checked === true || node.checked === false;
  return (
    <li className={isTask ? "md__item md__item--task" : "md__item"}>
      {isTask && (
        <span className="md__check" aria-hidden="true">
          {node.checked ? "☑" : "☐"}
        </span>
      )}
      <span className="md__item-body">{ctx.children}</span>
    </li>
  );
}

export function CodeBlock({ node }: { node: MdNode }) {
  return (
    <pre className="md__pre">
      <code className="md__code">{node.value ?? ""}</code>
    </pre>
  );
}

export function ThematicBreak() {
  return <hr className="md__hr" />;
}

/* ── 行内 ── */

/** 软换行按"换行"显示（保日记 / 手机记录的习惯），不按 CommonMark 合并成空格 */
export function Text({ node }: { node: MdNode }) {
  const value = node.value ?? "";
  if (!value.includes("\n")) return value;
  const lines = value.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </>
  );
}

export function Strong({ ctx }: { ctx: Ctx }) {
  return <strong className="md__strong">{ctx.children}</strong>;
}

export function Emphasis({ ctx }: { ctx: Ctx }) {
  return <em className="md__em">{ctx.children}</em>;
}

export function Delete({ ctx }: { ctx: Ctx }) {
  return <del className="md__del">{ctx.children}</del>;
}

export function InlineCode({ node }: { node: MdNode }) {
  return <code className="md__inline-code">{node.value ?? ""}</code>;
}

export function HardBreak() {
  return <br />;
}

/** 只放行能安全交给系统浏览器的协议；其它一律当文字显示 */
function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("mailto:")) {
    return trimmed;
  }
  return null;
}

export function Link({ node, ctx }: { node: MdNode; ctx: Ctx }) {
  const url = safeUrl(node.url);
  if (!url) {
    // 不认识的协议（javascript: / file: …）不给点，只把地址显示出来
    return (
      <span className="md__link-blocked" title={node.url}>
        {ctx.children}（这个链接不能打开：{node.url}）
      </span>
    );
  }
  return (
    <a
      className="md__link"
      href={url}
      title={url}
      onClick={(e) => {
        // 关键：不让 WebView 自己跳走，交给系统浏览器
        e.preventDefault();
        void openExternal(url).catch(() => {});
      }}
    >
      {ctx.children}
    </a>
  );
}

/** 图片先不渲染：Vault 内的图片引用语法定下来之前，别让正文引用任意路径 */
export function Image({ node }: { node: MdNode }) {
  const alt = node.alt && node.alt.trim() ? node.alt.trim() : "图片";
  return <Notice text={"图片暂不渲染：" + alt + "（等图片语法定下来）"} />;
}

/* ── GFM 表格：mdast 里没有 thead，首行就是表头 ── */

function cellClass(cell: MdNode, isHead: boolean): string {
  let cls = "md__cell";
  if (isHead) cls += " md__cell--head";
  if (cell.align === "center") cls += " md__cell--center";
  else if (cell.align === "right") cls += " md__cell--right";
  return cls;
}

export function Table({ node, ctx }: { node: MdNode; ctx: Ctx }) {
  const rows = node.children ?? [];
  const head = rows[0];
  const body = rows.slice(1);
  return (
    <div className="md__table-wrap">
      <table className="md__table">
        {head && (
          <thead>
            <tr>
              {(head.children ?? []).map((cell, i) => (
                <th key={i} className={cellClass(cell, true)}>
                  {ctx.inline(cell)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {(row.children ?? []).map((cell, ci) => (
                <td key={ci} className={cellClass(cell, false)}>
                  {ctx.inline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
