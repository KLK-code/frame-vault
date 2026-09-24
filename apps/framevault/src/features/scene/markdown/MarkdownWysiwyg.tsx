import { useCallback, useEffect, useRef, useState } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { Compartment, EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  commonmarkLanguage,
  markdown,
  markdownKeymap,
  pasteURLAsLink,
} from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { openExternal } from "../../../lib/api";
import { livePreview } from "./livePreview";
import "./MarkdownWysiwyg.css";

/**
 * 正文控件：**全项目唯一的 Markdown 编辑器与渲染器**，一个引擎提供三种模式。
 *
 * | 模式 | 怎么来 | 用在哪 |
 * |---|---|---|
 * | `live`（默认） | 挂上 `livePreview`：语法符号藏起来、光标碰到才露 | 正文默认；写作台 |
 * | `source` | 把那套装饰换成语法高亮 —— 就是源码本身 | 想直接改 `**` / 表格列宽这类场合 |
 * | 只读 | `readOnly` | 时间线的读态：排好版的文字，点一下才变可写 |
 *
 * 三种模式都是**同一个实例**：`mode` 与 `readOnly` 各由一个 `Compartment` 装，
 * 切换只是重配扩展集 —— 不重建编辑器、不重解析文档、**不丢光标与撤销栈**，
 * 而且因为文档没变（`docChanged` 为假），**切换模式不会被当成一次改动**。
 * 这也是"点一下就改不闪"的原因：读态与编辑态从来就是同一个编辑器。
 *
 * 宿主决定它长什么样：`variant="fill"` 是写作台那种"吃掉剩余高度"，
 * `variant="inline"` 是时间线/表单里的小块（跟着内容长、**不内部滚动** ——
 * 时间线本身就是滚动容器，里面再套一层滚动区在手机上极难用）。
 * 将来若要改成"点开一屏编辑"，换的只是宿主，这个组件不用动。
 *
 * 它重（带进 CM6 家族），所以**由核心组件按需加载**（`React.lazy`），别静态 import。
 *
 * 粘贴是纯文本插入 —— 文档就是 Markdown，粘一整篇 `.md` 进来当场就是排好版的样子。
 */
type Mode = "live" | "source";

type Props = {
  value: string;
  onChange: (markdown: string) => void;
  /** 读态：不落光标、不接受输入；文本仍可选中复制。切换不重建实例 */
  readOnly?: boolean;
  /** 默认模式（用户当场切换后以他选的为准；重新挂载会回到这个值） */
  mode?: Mode;
  /** 声明式"现在该获得焦点"：由 false 变 true 时聚焦并把光标落到文末 */
  focus?: boolean;
  placeholder?: string;
  /** CM6 里没有可 `htmlFor` 的元素，无障碍标签走这里 */
  ariaLabel?: string;
  variant?: "fill" | "inline";
  /**
   * 把"立刻把还没交出去的文本交出去"的把手交给宿主。
   *
   * 为什么必须有：上报有 220ms 防抖，而**卸载时定时器会被清掉** ——
   * 打完字立刻切篇 / 切场景 / 切页，最后那几个字就永远不会到父组件那里（丢字）。
   * 宿主在自己的"落盘前"调一次这个把手（返回值是刚补交的文本，没有就是 null），
   * 就能把这段尾巴要回来。
   */
  onFlushReady?: (flush: () => string | null) => void;
};

/** 每次按键都重渲染没必要；攒一小会儿再报上去（与旧实现的 200ms 体感一致） */
const EMIT_DELAY = 220;

/**
 * 三个 Compartment：编辑权限、呈现模式，都靠重配切换（不重建实例）。
 * 一个 Compartment 可以被多个实例共用 —— 它只是 state 里的一把钥匙。
 */
const editCompartment = new Compartment();
const modeCompartment = new Compartment();
const readOnlyExtensions = [EditorState.readOnly.of(true), EditorView.editable.of(false)];
const editableExtensions = [EditorState.readOnly.of(false), EditorView.editable.of(true)];

/** 呈现模式：即时渲染 = livePreview 那套装饰；源码模式 = 语法高亮，符号全都露着 */
function modeExtensions(mode: Mode) {
  return mode === "source"
    ? syntaxHighlighting(defaultHighlightStyle, { fallback: true })
    : livePreview;
}

/** `**粗体**` / `*斜体*` / `` `行内码` `` 的开关：包上、脱掉、空选区插一对并把光标放中间 */
function toggleWrap(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const size = marker.length;
    const changes = state.changeByRange((range) => {
      const { from, to } = range;
      const before = state.doc.sliceString(Math.max(0, from - size), from);
      const after = state.doc.sliceString(to, to + size);
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: from - size, to: from },
            { from: to, to: to + size },
          ],
          range: EditorSelection.range(from - size, to - size),
        };
      }
      const inner = state.doc.sliceString(from, to);
      if (inner.length >= size * 2 && inner.startsWith(marker) && inner.endsWith(marker)) {
        return {
          changes: [
            { from, to: from + size },
            { from: to - size, to },
          ],
          range: EditorSelection.range(from, to - size * 2),
        };
      }
      if (from === to) {
        return {
          changes: { from, to, insert: marker + marker },
          range: EditorSelection.cursor(from + size),
        };
      }
      return {
        changes: { from, to, insert: marker + inner + marker },
        range: EditorSelection.range(from + size, to + size),
      };
    });
    dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

/** 行首记号（`## ` / `- ` / `1. ` / `> ` / `- [ ] `）的开关：选中的每一行一起加、一起去掉 */
function toggleLinePrefix(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const range = state.selection.main;
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    const lines = [];
    for (let n = first; n <= last; n++) lines.push(state.doc.line(n));
    const allHave = lines.every((line) => line.text.startsWith(marker));
    const changes = lines.map((line) =>
      allHave
        ? { from: line.from, to: line.from + marker.length }
        : { from: line.from, insert: marker },
    );
    dispatch(state.update({ changes, userEvent: "input" }));
    return true;
  };
}

/** 围栏代码块：选中的内容包进 ``` 里；再按一次（选中的就是围栏块）脱掉 */
function toggleFence(): StateCommand {
  return ({ state, dispatch }) => {
    const range = state.selection.main;
    const text = state.doc.sliceString(range.from, range.to);
    const fenced = /^```[^\n]*\n[\s\S]*\n?```$/.test(text.trim());
    const insert = fenced
      ? text.trim().replace(/^```[^\n]*\n/, "").replace(/\n?```$/, "")
      : "```\n" + text + "\n```";
    dispatch(
      state.update({
        changes: { from: range.from, to: range.to, insert },
        selection: EditorSelection.range(range.from, range.from + insert.length),
        userEvent: "input",
      }),
    );
    return true;
  };
}

/**
 * 源码模式的一排按钮。手机上没有 Ctrl+B 这种快捷键，可点的按钮是真有用。
 * 插入一律走 CM6 的命令（dispatch 事务），不是自己拼字符串塞 DOM ——
 * 这样**撤销栈、输入法、选区都由内核负责**（旧的自研工具栏在这三件事上都踩过坑）。
 */
const TOOLS: { label: string; title: string; run: StateCommand }[] = [
  { label: "H2", title: "标题", run: toggleLinePrefix("## ") },
  { label: "B", title: "加粗（Ctrl/⌘+B）", run: toggleWrap("**") },
  { label: "I", title: "斜体（Ctrl/⌘+I）", run: toggleWrap("*") },
  { label: "•", title: "无序列表", run: toggleLinePrefix("- ") },
  { label: "1.", title: "有序列表", run: toggleLinePrefix("1. ") },
  { label: "”", title: "引用", run: toggleLinePrefix("> ") },
  { label: "☐", title: "待办", run: toggleLinePrefix("- [ ] ") },
  { label: "‹›", title: "行内代码（Ctrl/⌘+E）", run: toggleWrap("`") },
  { label: "```", title: "代码块", run: toggleFence() },
];

/**
 * 结构性那几条（滚动容器、字号、内边距、光标）走 CM6 的 theme API，**不放进 CSS 文件**。
 *
 * 原因：CM6 会往 document 里注入自己的基础样式（`.cm-scroller { overflow: auto }` 之类），
 * 那是**未分层**的；而我们的 CSS 全在 `@layer components` 里 —— 按层叠层的规矩，
 * 未分层永远压过分层，写在 CSS 里多少条都不生效。走 theme API 是后注入的未分层样式，
 * 能盖住它自己那份基础样式。
 * 值仍然全部是 `--fv-*` token（没有裸色值），外观主题照样管得到。
 * 装饰相关的样式（标题字号、引用竖线、代码底纹、表格…）照常写在 `MarkdownWysiwyg.css` 里。
 */
const editorTheme = EditorView.theme({
  "&": {
    // 跟着 .md-wysiwyg（flex 容器）撑满：写作台里编辑器吃剩余全部高度
    height: "100%",
    color: "var(--fv-color-text)",
    fontSize: "var(--fv-text-base)",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    height: "100%",
    overflowX: "hidden",
    overflowY: "auto",
    scrollbarGutter: "stable",
    fontFamily: "inherit",
    lineHeight: "var(--fv-line-height)",
    // CM6 基础样式把内容**顶对齐**（align-items: flex-start）：空白笔记时内容只有一行高，
    // 下面一大片区域不属于 .cm-content —— 点那儿等于点在编辑器外面，光标进不去（之前就是这样）。
    // 拉成 stretch，再让内容至少撑满一屏，整块区域才都能点。
    alignItems: "stretch",
  },
  ".cm-content": {
    minHeight: "100%",
    fontFamily: "inherit",
    caretColor: "var(--fv-color-accent)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor": {
    borderLeftWidth: "2px",
    borderLeftColor: "var(--fv-color-accent)",
  },
});

/**
 * 内边距单独一条规则，而且**多套了一层 `.cm-editor`**。
 *
 * 为什么：CM6 自己的基础样式也写了 `.cm-content { padding: 4px 0 }`，与我们的选择器**同特异性**，
 * 于是"谁后注入谁赢"——实测它赢，我们按变体给的内边距（读态 0、编辑态 12px）全被盖成 4px。
 * 多一层把特异性抬到 (0,3,0)，就跟注入顺序无关，总能盖住基础样式。
 * 值仍是 `--md-wysiwyg-pad`（组件内变量，由 CSS 按变体给），没设时退回 `--fv-space-4`。
 */
const contentPaddingTheme = EditorView.theme({
  "&.cm-editor .cm-content": {
    padding: "var(--md-wysiwyg-pad, var(--fv-space-4))",
  },
});

/**
 * 时间线/表单里的小块：**跟着内容长，绝不内部滚动**。
 *
 * 高度交给内容（`height: auto`），滚动条那条也要关掉 —— 只 `overflow-y: hidden` 不够，
 * `scrollbar-gutter: stable` 照样会在每条记录右侧留一道空槽。外层的滚动由宿主负责。
 * 空笔记靠 CSS 里的 `min-height` 兜底（不然没内容时高度是 0，点不着）。
 */
const inlineTheme = EditorView.theme({
  "&": { height: "auto" },
  ".cm-scroller": {
    height: "auto",
    overflowY: "hidden",
    scrollbarGutter: "auto",
    alignItems: "stretch",
  },
  ".cm-content": { minHeight: "auto" },
});

/** 坐标底下那个链接的 URL（Ctrl/Cmd+点击与读态点击共用） */
function urlAt(instance: EditorView, x: number, y: number): string | null {
  const pos = instance.posAtCoords({ x, y });
  if (pos == null) return null;
  let node = syntaxTree(instance.state).resolveInner(pos, 0);
  for (; node; node = node.parent!) {
    if (node.name === "URL") return instance.state.doc.sliceString(node.from, node.to);
    if (node.name === "Link") {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === "URL") return instance.state.doc.sliceString(child.from, child.to);
      }
    }
    if (!node.parent) break;
  }
  return null;
}

function Surface({
  value,
  onChange,
  onFlushReady,
  readOnly = false,
  mode: initialMode = "live",
  focus = false,
  placeholder: placeholderText,
  ariaLabel,
  variant = "fill",
}: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // 记住"我们自己刚发出去的那份"，用来分辨 value 的变化是外部换篇还是自己回显
  const emitted = useRef(value);
  const timer = useRef<number | null>(null);
  /** 防抖里还没送出去的那份文本 —— **卸载 / 失焦 / 落盘前必须补送**，否则丢字 */
  const pending = useRef<string | null>(null);
  /** 当场切换以用户为准：宿主给的只是**默认值**（重新挂载会回到它） */
  const [mode, setMode] = useState<Mode>(initialMode);

  /**
   * 立刻把最新文本交出去，不等防抖。返回刚补交的文本（没有待交的就返回 null）。
   * 宿主在自己的落盘前调它，就能把"打完字立刻切走"的那一段尾巴要回来。
   */
  const flush = useCallback((): string | null => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const text = pending.current;
    pending.current = null;
    if (text != null) onChangeRef.current(text);
    return text;
  }, []);

  // 把手交给宿主（写盘前 / 失焦 / 卸载都要用）
  useEffect(() => {
    onFlushReady?.(flush);
  }, [onFlushReady, flush]);

  // **卸载前补送最后一段** —— 这是"打完字立刻切场景/切篇"最常见的丢字点
  // （子组件先于父组件卸载，所以父组件的补写能看到这份文本）
  useEffect(() => () => { flush(); }, [flush]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const instance = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...markdownKeymap,
            indentWithTab,
            // markdownKeymap 只绑了回车续标记和退格；粗体/斜体/行内码得自己绑（Obsidian 同款）
            { key: "Mod-b", run: toggleWrap("**") },
            { key: "Mod-i", run: toggleWrap("*") },
            { key: "Mod-e", run: toggleWrap("`") },
          ]),
          markdown({ base: commonmarkLanguage, extensions: [GFM] }),
          // 把 URL 粘到选中的文字上 → 直接变成链接（Obsidian 同款；它是个 Extension，不能进 keymap）
          pasteURLAsLink,
          EditorView.lineWrapping,
          editCompartment.of(readOnly ? readOnlyExtensions : editableExtensions),
          modeCompartment.of(modeExtensions(initialMode)),
          ...(placeholderText ? [placeholder(placeholderText)] : []),
          ...(ariaLabel ? [EditorView.contentAttributes.of({ "aria-label": ariaLabel })] : []),
          variant === "inline" ? inlineTheme : editorTheme,
          contentPaddingTheme,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const markdownText = update.state.doc.toString();
            // 先记下"这是我们自己写出去的那份"，再攒一小会儿报给父组件
            emitted.current = markdownText;
            pending.current = markdownText; // 防抖期间也留着：卸载/失焦前能补交
            if (timer.current != null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => {
              timer.current = null;
              pending.current = null;
              onChangeRef.current(markdownText);
            }, EMIT_DELAY);
          }),
          EditorView.domEventHandlers({
            // 失焦立刻补交：不等防抖（点标题框、点别的记录、切到别的窗口）
            blur() {
              flush();
              return false;
            },
            // Ctrl/Cmd + 点击链接 → 交给系统浏览器，别让 WebView 自己跳走
            mousedown(event, instance) {
              if (!event.metaKey && !event.ctrlKey) return false;
              const url = urlAt(instance, event.clientX, event.clientY);
              if (!url) return false;
              void openExternal(url).catch(() => undefined);
              return true;
            },
            click(event, instance) {
              // 读态下点链接直接打开（原先那个只读渲染器就是这个行为，别丢）；
              // `stopPropagation` 是必需的：宿主把"点正文"当成"进入编辑"，点链接不该连带触发。
              if (!instance.state.facet(EditorState.readOnly)) return false;
              const url = urlAt(instance, event.clientX, event.clientY);
              if (!url) return false;
              event.preventDefault();
              event.stopPropagation();
              void openExternal(url).catch(() => undefined);
              return true;
            },
          }),
        ],
      }),
    });
    view.current = instance;
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
      instance.destroy();
      view.current = null;
    };
    // 只建一次 —— 编辑器实例只在挂载时创建（AGENTS §9：HMR 不会重建它，验行为必须整页刷新）
  }, []);

  // 读态 ↔ 可编辑：只重配，不重建（点一下就改才不会闪一下）
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({
      effects: editCompartment.reconfigure(readOnly ? readOnlyExtensions : editableExtensions),
    });
  }, [readOnly]);

  // 即时渲染 ↔ 源码：同样只重配。文档没动，所以不会被当成一次改动去触发保存
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(mode)) });
  }, [mode]);

  // 该聚焦了就聚焦，并把光标落到文末（"点一下接着写"比"改某个字"更常见）
  useEffect(() => {
    const instance = view.current;
    if (!instance || !focus) return;
    instance.focus();
    instance.dispatch({
      selection: { anchor: instance.state.doc.length },
      scrollIntoView: true,
    });
  }, [focus]);

  // 外部换了内容（切换了另一篇）→ 整篇换掉并回到开头；不能每次都换，否则跟打字打架
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    if (value === emitted.current) return;
    const current = instance.state.doc.toString();
    if (value === current) {
      // 内容其实一样（父组件回显），只对齐标记，别动选区
      emitted.current = value;
      return;
    }
    emitted.current = value;
    instance.dispatch({
      changes: { from: 0, to: instance.state.doc.length, insert: value },
      selection: { anchor: 0 },
    });
    instance.scrollDOM.scrollTop = 0;
  }, [value]);

  /** 点工具条：跑 CM6 命令，焦点留在编辑器里（焦点跑了手机上键盘就收起） */
  function runTool(command: StateCommand) {
    const instance = view.current;
    if (!instance) return;
    command({ state: instance.state, dispatch: (tr) => instance.dispatch(tr) });
    instance.focus();
  }

  /**
   * 点在**内容以外**的地方（空白笔记下面那一大片、或卡片的内边距）也要能开始写。
   *
   * CM6 只在自己的 `.cm-content` 上接鼠标事件，所以光标得我们自己放：
   * 聚焦 + 落到文末 —— 与 Obsidian 一致（点空白区就是"接着写"）。
   * 落在 `.cm-content` 里的点击一概不管，交给 CM6 自己定位（那才是精确点选）。
   */
  function onHostMouseDown(event: React.MouseEvent) {
    const instance = view.current;
    if (!instance) return;
    if ((event.target as HTMLElement).closest(".cm-content")) return;
    event.preventDefault();
    instance.focus();
    instance.dispatch({ selection: { anchor: instance.state.doc.length } });
  }

  return (
    <>
      {/* 工具条只在编辑态出现；那一排语法按钮只在源码模式 —— 即时渲染下符号是藏着的，
          写 `##` 直接就是标题的样子，不需要先插入记号 */}
      {!readOnly && (
        <div className="md-wysiwyg__bar">
          {mode === "source" && (
            <div className="md-wysiwyg__tools" role="toolbar" aria-label="Markdown 语法">
              {TOOLS.map((tool) => (
                <button
                  key={tool.label}
                  type="button"
                  className="md-wysiwyg__btn"
                  title={tool.title}
                  // 不加这句，点按钮时编辑器失焦，**手机上键盘当场收起**（AGENTS §9）
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => runTool(tool.run)}
                >
                  {tool.label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="md-wysiwyg__mode"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setMode(mode === "live" ? "source" : "live")}
          >
            {mode === "live" ? "源码" : "渲染"}
          </button>
        </div>
      )}
      <div className="md-wysiwyg__host" ref={host} onMouseDown={onHostMouseDown} />
    </>
  );
}

export default function MarkdownWysiwyg({ variant = "fill", readOnly = false, ...props }: Props) {
  const className = [
    "md-wysiwyg",
    variant === "inline" ? "is-inline" : "",
    // 编辑态才亮边框：读态是"排好版的文字"，不该给每条记录套一个方框
    readOnly ? "" : "is-editing",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className}>
      <Surface variant={variant} readOnly={readOnly} {...props} />
    </div>
  );
}
