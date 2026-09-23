import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * 实时渲染（live preview）装饰层：**语法符号一直躺在文档里，靠装饰决定藏还是显**。
 *
 * 这是「真·Obsidian 式」的全部秘密：文档就是 Markdown 文本，没有第二份表示，
 * 所以选区永远贯穿全篇、也没有"进模式"这回事。规则两条：
 *
 * - **块级记号**（`# ` / `> ` / `- ` / 围栏）→ **按行**露出：光标在这一行就露，移开就藏。
 * - **行内记号**（`**` / `*` / `~~` / `` ` `` / `[](…)`）→ **按令牌**露出：光标落进那段才露。
 *
 * 三条硬要求（前两条写在计划里，第三条是 CM6 的硬规矩、踩过）：
 * 1. **块级/行级装饰必须走 `StateField`**：CM6 明确禁止 `ViewPlugin` 提供块级装饰
 *    （`Decoration.line` 与 `block: true` 的 replace），否则一挂载就抛
 *    `RangeError: Block decorations may not be specified via plugins` —— 而且是**整块不渲染**，
 *    画面全空、DOM 里却什么都有，很难一眼看出。所以这里分两半：`outer` 走 StateField，
 *    `inner`（行内记号、widget）走 ViewPlugin。
 * 2. **行内那半只算视口**：语法树遍历用 `view.visibleRanges` 限定，千行文档只算眼前这几屏。
 *    （块级那半由 StateField 管，按 CM6 的规矩只能全篇算 —— 它只加类名、不建 widget，代价小。）
 * 3. **替换装饰绝不能盖住光标**：凡是会藏掉文本的地方，都先问过"光标/选区碰没碰到"。
 */

/** 藏掉一段（不加 widget） */
function hide(out: Range<Decoration>[], from: number, to: number) {
  if (to > from) out.push(Decoration.replace({}).range(from, to));
}

/** 藏掉一个行首记号，连同紧跟的一个空格（`## ` 整体消失，而不是留一个空格） */
function hideMarkWithSpace(state: EditorState, out: Range<Decoration>[], from: number, to: number) {
  const next = state.doc.sliceString(to, to + 1);
  hide(out, from, next === " " ? to + 1 : to);
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-fv-bullet";
    span.textContent = "•";
    return span;
  }
}

class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const div = document.createElement("div");
    div.className = "cm-fv-hr";
    // 分隔线本身是空的，靠 border 画；不写裸色值，颜色在 CSS 里
    return div;
  }
}

class CheckboxWidget extends WidgetType {
  /** CM6 的 widget 拿不到"我在哪"，位置只能自己带；带上就得进 `eq`，否则前面插字会原地失灵 */
  constructor(
    readonly from: number,
    readonly checked: boolean,
  ) {
    super();
  }
  eq(other: WidgetType) {
    return other instanceof CheckboxWidget && other.checked === this.checked && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-fv-check";
    box.checked = this.checked;
    box.addEventListener("click", (event) => {
      event.preventDefault();
      // 勾选 = 改文档里的 `[ ]` / `[x]` 三个字符，别的都不动
      view.dispatch({
        changes: { from: this.from, to: this.from + 3, insert: this.checked ? "[ ]" : "[x]" },
      });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: WidgetType) {
    return other instanceof ImageWidget && other.url === this.url && other.alt === this.alt;
  }
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-fv-img";
    img.src = this.url;
    img.alt = this.alt;
    return img;
  }
}

/** 把一段管道符文本画成只读表格（表头 / 对齐 / 发丝线都在 CSS 里） */
function buildTableTable(source: string): HTMLElement {
  const splitCells = (line: string) =>
    line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((cell) => cell.trim());
  const lines = source.split("\n").filter((line) => line.trim() !== "");
  const table = document.createElement("table");
  table.className = "cm-fv-table";
  if (lines.length === 0) return table;

  const head = splitCells(lines[0]);
  const aligns =
    lines.length > 1
      ? splitCells(lines[1]).map((cell) =>
          /^:-+:$/.test(cell) ? "center" : /^:-+$/.test(cell) ? "left" : /^-+:$/.test(cell) ? "right" : "",
        )
      : [];

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  head.forEach((text, i) => {
    const th = document.createElement("th");
    th.textContent = text;
    if (aligns[i]) th.style.textAlign = aligns[i];
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const line of lines.slice(2)) {
    const row = document.createElement("tr");
    splitCells(line).forEach((text, i) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (aligns[i]) td.style.textAlign = aligns[i];
      row.appendChild(td);
    });
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: WidgetType) {
    return other instanceof TableWidget && other.source === this.source;
  }
  toDOM() {
    return buildTableTable(this.source);
  }
}

/** 行内记号：藏掉首尾记号 + 给正文加样式（取不到成对记号就原样不动，宁可不渲染） */
function inlineMark(
  state: EditorState,
  out: Range<Decoration>[],
  from: number,
  to: number,
  cls: string,
) {
  const text = state.doc.sliceString(from, to);
  const paired = /^(\*{1,3}|_{1,3}|~~|`+)([\s\S]*)\1$/.exec(text);
  if (!paired) return;
  const mark = paired[1].length;
  hide(out, from, from + mark);
  hide(out, to - mark, to);
  out.push(Decoration.mark({ class: cls }).range(from + mark, to - mark));
}

type Buckets = { outer: Range<Decoration>[]; inner: Range<Decoration>[] };

/** 走一遍语法树，按"块级/行级"与"行内"两桶分装饰（前者必须交给 StateField） */
function collect(state: EditorState, ranges: readonly { from: number; to: number }[]): Buckets {
  const outer: Range<Decoration>[] = [];
  const inner: Range<Decoration>[] = [];
  const out = inner;

  // 光标 / 选区碰到的行（块级记号按这个露）
  const touchedLines = new Set<number>();
  for (const range of state.selection.ranges) {
    touchedLines.add(state.doc.lineAt(range.from).number);
    touchedLines.add(state.doc.lineAt(range.to).number);
  }
  const lineTouched = (pos: number) => touchedLines.has(state.doc.lineAt(pos).number);
  // 选区有没有伸进某段范围（行内记号按这个露）
  const rangeTouched = (from: number, to: number) =>
    state.selection.ranges.some((range) => range.from <= to && range.to >= from);

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter: (node) => {
        const heading = /^ATXHeading([1-6])$/.exec(node.name);
        if (heading) {
          outer.push(
            Decoration.line({ class: `cm-fv-h${heading[1]}` }).range(state.doc.lineAt(node.from).from),
          );
          return;
        }

        switch (node.name) {
          case "HeaderMark":
            if (!lineTouched(node.from)) hideMarkWithSpace(state, out, node.from, node.to);
            break;

          case "Blockquote": {
            // 逐行加"左侧竖线 + 灰字"，行级记号各管各的
            const first = state.doc.lineAt(node.from).number;
            const last = state.doc.lineAt(Math.min(node.to, state.doc.length)).number;
            for (let n = first; n <= last; n++) {
              outer.push(Decoration.line({ class: "cm-fv-quote" }).range(state.doc.line(n).from));
            }
            break;
          }
          case "QuoteMark":
            if (!lineTouched(node.from)) hideMarkWithSpace(state, out, node.from, node.to);
            break;

          case "ListMark": {
            if (lineTouched(node.from)) break;
            // 任务项：整行只留勾选框，标记连同后面的空格一起藏掉
            let isTask = false;
            for (let sibling = node.node.nextSibling; sibling; sibling = sibling.nextSibling) {
              if (sibling.name === "Task") {
                isTask = true;
                break;
              }
            }
            if (isTask) {
              hideMarkWithSpace(state, out, node.from, node.to);
              break;
            }
            // 无序列表的标记换成统一的圆点；有序列表的序号本身就好看，留着
            const text = state.doc.sliceString(node.from, node.to);
            if (/^[-*+]$/.test(text)) {
              out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
            }
            break;
          }

          case "Task":
            outer.push(Decoration.line({ class: "cm-fv-task" }).range(state.doc.lineAt(node.from).from));
            break;
          case "TaskMarker": {
            if (lineTouched(node.from)) break;
            const checked = state.doc.sliceString(node.from, node.to).toLowerCase().includes("x");
            out.push(
              Decoration.replace({ widget: new CheckboxWidget(node.from, checked) }).range(
                node.from,
                node.to,
              ),
            );
            break;
          }

          case "StrongEmphasis":
            if (!rangeTouched(node.from, node.to)) inlineMark(state, out, node.from, node.to, "cm-fv-strong");
            break;
          case "Emphasis":
            if (!rangeTouched(node.from, node.to)) inlineMark(state, out, node.from, node.to, "cm-fv-em");
            break;
          case "Strikethrough":
            if (!rangeTouched(node.from, node.to)) inlineMark(state, out, node.from, node.to, "cm-fv-strike");
            break;
          case "InlineCode":
            if (!rangeTouched(node.from, node.to))
              inlineMark(state, out, node.from, node.to, "cm-fv-inline-code");
            break;

          case "Link": {
            if (rangeTouched(node.from, node.to)) break;
            const marks: { from: number; to: number }[] = [];
            for (let child = node.node.firstChild; child; child = child.nextSibling) {
              if (child.name === "LinkMark") marks.push({ from: child.from, to: child.to });
            }
            if (marks.length < 3) break;
            hide(out, marks[0].from, marks[0].to); // [
            hide(out, marks[1].from, node.to); // ](url)
            out.push(
              Decoration.mark({ class: "cm-fv-link" }).range(marks[0].to, marks[1].from),
            );
            break;
          }
          case "URL":
            // 裸 URL（不在链接里的）也给个可点的样子
            out.push(Decoration.mark({ class: "cm-fv-link" }).range(node.from, node.to));
            break;

          case "Image": {
            if (rangeTouched(node.from, node.to)) break;
            const text = state.doc.sliceString(node.from, node.to);
            const parsed = /^!\[([^\]]*)\]\(([^)\s]+)/.exec(text);
            // 只渲染 http(s) / data —— 本地路径不把 asset 协议引进编辑器
            if (!parsed || !/^(https?:|data:)/.test(parsed[2])) break;
            out.push(
              Decoration.replace({ widget: new ImageWidget(parsed[2], parsed[1]) }).range(
                node.from,
                node.to,
              ),
            );
            break;
          }

          case "HorizontalRule": {
            if (lineTouched(node.from)) break;
            out.push(Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to));
            break;
          }

          case "FencedCode": {
            // 整块（含围栏行）都铺代码背景，首尾行起圆角 —— 这样它就是一条完整的底色带
            const first = state.doc.lineAt(node.from).number;
            const last = state.doc.lineAt(Math.min(node.to, state.doc.length)).number;
            for (let n = first; n <= last; n++) {
              const edge =
                n === first && n === last
                  ? " cm-fv-code-first cm-fv-code-last"
                  : n === first
                    ? " cm-fv-code-first"
                    : n === last
                      ? " cm-fv-code-last"
                      : "";
              outer.push(Decoration.line({ class: `cm-fv-code${edge}` }).range(state.doc.line(n).from));
            }
            break;
          }
          case "CodeMark":
          case "CodeInfo": {
            // 只藏围栏本身的文本（` ``` ` 与语言标注）；行内码的 ` 由行内规则管。
            // 露出粒度按**整个代码块**判：光标在块里任何地方，上下两条围栏一起露
            const block = node.node.parent;
            if (!block || block.name !== "FencedCode") break;
            if (!rangeTouched(block.from, block.to)) hide(out, node.from, node.to);
            break;
          }

          case "Table": {
            if (rangeTouched(node.from, node.to)) break;
            const first = state.doc.lineAt(node.from).number;
            const last = state.doc.lineAt(Math.min(node.to, state.doc.length)).number;
            const source = state.doc.sliceString(

              state.doc.line(first).from,
              state.doc.line(last).to,
            );
            outer.push(
              Decoration.replace({ widget: new TableWidget(source) }).range(node.from, node.to),
            );
            break;
          }
        }
      },
    });
  }

  return { outer, inner };
}

/** 块级 / 行级：CM6 只认 StateField（全篇算，但只加类名、不建 widget） */
const outerDecorations = StateField.define<DecorationSet>({
  create: (state) => Decoration.set(collect(state, [{ from: 0, to: state.doc.length }]).outer, true),
  update: (value, tr) =>
    tr.docChanged || tr.selection
      ? Decoration.set(collect(tr.state, [{ from: 0, to: tr.state.doc.length }]).outer, true)
      : value,
  provide: (field) => EditorView.decorations.from(field),
});

/** 行内记号 / widget：走 ViewPlugin，只算视口 */
const innerDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    /** 输入法组合期间挂起重算（组合一结束补一次） */
    private pending = false;

    constructor(view: EditorView) {
      this.decorations = Decoration.set(collect(view.state, view.visibleRanges).inner, true);
    }

    update(update: ViewUpdate) {
      if (update.view.composing) {
        this.pending = true;
        return;
      }
      if (this.pending) {
        this.pending = false;
        this.decorations = Decoration.set(collect(update.state, update.view.visibleRanges).inner, true);
        return;
      }
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = Decoration.set(collect(update.state, update.view.visibleRanges).inner, true);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export const livePreview = [outerDecorations, innerDecorations];
