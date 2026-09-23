import { useEffect, useRef } from "react";
import {
  Editor,
  defaultValueCtx,
  editorViewOptionsCtx,
  parserCtx,
  rootCtx,
  schemaCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Fragment, Slice, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { ReplaceStep } from "@milkdown/kit/prose/transform";
import { history as historyPlugin, undo, redo } from "@milkdown/kit/prose/history";
import { keymap } from "@milkdown/kit/prose/keymap";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { $prose, replaceAll } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { looksLikeMarkdown } from "../../../markdown/parse";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "./MarkdownWysiwyg.css";

/**
 * 正文输入控件（所见即所得）：一块区域，边写边渲染，语法符号不出现。
 *
 * 跟 MarkdownField 的关系：**对外接口一模一样**（value 进、markdown 字符串出），
 * 区别只在"编辑引擎"——MarkdownField 是 textarea + 工具栏，这个是 ProseMirror（经 Milkdown）。
 * 两者都**只产出 Markdown**，所以磁盘格式、渲染器、主题都不用知道用的是哪个。
 *
 * 它重（带进 ProseMirror 家族），所以**只在写作台里按需加载**（React.lazy）。
 *
 * 粘贴：**纯文本、或来源声明自己是 Markdown 的，按 Markdown 解析**（否则粘一整篇 .md 进来
 * 只会得到一堆源码）；网页富文本照旧交给浏览器给的 HTML。复制出去给的是 Markdown 文本。
 */
type Props = {
  value: string;
  onChange: (markdown: string) => void;
};

/** VS Code 粘贴时会带上`它从哪种文件复制的`，只信它的 mode */
const VSCODE_MARKDOWN_MODES = ["markdown", "md", "mdx"];

function vsCodeMode(data: DataTransfer): string | null {
  const raw = data.getData("vscode-editor-data");
  if (!raw) return null;
  try {
    const mode = (JSON.parse(raw) as { mode?: unknown }).mode;
    return typeof mode === "string" ? mode.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * 这次粘贴要不要当 Markdown 读？要就返回该解析的文本，不要就返回 null（走默认粘贴）。
 *
 * 顺序即优先级：来源自己说了算 → 没有 HTML（记事本 / 终端 / 纯文本编辑器）→
 * 有 HTML 但纯文本里带着块级 Markdown（VS Code 复制源码就是这种）。
 */
function markdownFromPaste(data: DataTransfer): string | null {
  const text = data.getData("text/plain");
  if (!text.trim()) return null;
  const mode = vsCodeMode(data);
  if (mode) return VSCODE_MARKDOWN_MODES.includes(mode) ? text : null;
  if (!data.getData("text/html")) return text;
  return looksLikeMarkdown(text) ? text : null;
}

/* ═══════════════════ 光标所在块显示源码（Live Source） ═══════════════════
 *
 * 平时整篇渲染；光标落进某个块（标题 / 段落 / 引用 / 列表项 / 表格）就地把**这一块**
 * 换成一块源码文本域：`## `、`> `、`- `、表格管道符、`**粗**`、`[链接](url)` 全都看得见、
 * 直接改；光标离开这一块，再把文本解析回节点、恢复渲染。参照 Obsidian 的 Live Preview。
 *
 * 为什么不用 NodeView：这些块的 DOM 必须由 ProseMirror 自己渲染（`li > p`、`.ProseMirror > *`
 * 这些排版规则都挂在默认 DOM 上），NodeView 一定要多包一层壳，层级一变样式就全歪。
 * 这里改用两条装饰：给这一块挂 `display: none`（**DOM 结构一个字不动**），再在它的位置插一个
 * widget 装文本域 —— 跟 `@milkdown/components` 的代码块组件同一套路数，但不需要 CodeMirror。
 *
 * 隔离：widget 的 `stopEvent` 让 ProseMirror 彻底无视文本域里的键盘 / 输入 / 选区事件；
 * 文本域拿到焦点后 `view.hasFocus()` 是 false，PM 也不会来抢 DOM 选区（源码态的 caret
 * 归文本域自己管）。于是"编辑器里的编辑器"不会跟 PM 打架。
 *
 * 时序：源码态**不进 PM 的输入管线**（不逐键回写，避免受控回灌那套坑），
 * 只在①光标离开这一块 ②文本域失焦 时，一次性提交**一个**事务 —— 所以 Ctrl+Z 一步就能撤销
 * 这一次源码编辑，而不是逐字符往回退。
 */

/** 可以进入源码态的块级节点。往上找时**从外层往内层**找，命中的第一个就是"这一块" */
const LIVE_BLOCK_TYPES = new Set([
  "heading",
  "paragraph",
  "blockquote",
  "list_item",
  "table",
]);
/** 光标落在这类节点里一律不进源码态：代码块本来就在显示源码，html 是原子块 */
const LIVE_SKIP_TYPES = new Set(["code_block", "html"]);
/**
 * 列表项只有待在列表里才序列化得出「- 」/「1. 」，所以单节点序列化时要连它那层列表一起裹上，
 * 解析回来时再脱掉。见 serializeLiveBlock / parseLiveSource。
 */
const LIVE_LIST_TYPES = new Set(["bullet_list", "ordered_list"]);
/** 进入源码态前的等待：按住方向键连跳块时，只让**最后停下**的那块翻面，不是每块闪一下 */
const LIVE_ENTER_DELAY = 120;
/**
 * 源码态里敲字之后，隔多久把"粗投影"报给上层。
 * 为的是父组件的草稿 / "未保存"标记跟得上 —— 否则用户在源码态里改了字，
 * 保存按钮还是灰的（草稿里没有这次改动），点一下只会失焦。
 */
const LIVE_PROJECT_DELAY = 250;
const LIVE_PARSE_ERROR = "这段 Markdown 解析不了，原内容没动。改回来，或按 Esc 放弃。";
/** widget 的 stopEvent 必须是**同一个函数**：PM 靠函数身份判断"这个 widget 要不要重建" */
const liveStopAll = () => true;

type LiveMeta = {
  /** 定时器确认：可以进这一块了（值 = 那块的起始位置，防止过期定时器打到别的块上） */
  activate?: number;
  /** 显式退出（Esc） */
  deactivate?: boolean;
  /** 失焦那一瞬间的保命提交：改动落到文档里，但源码态留着（不抢焦点回来） */
  flush?: boolean;
  /** 我们自己提交源码回来时打的记号 */
  commit?: boolean;
  /** 提交失败 → 把源码态恢复出来并挂上错误提示 */
  restore?: LiveActive;
};

type LiveActive = {
  /** 这一块的稳定身份：提交后位置会挪、记录会重建，但它还是同一块（用来判断"要不要重新夺焦点"） */
  id: number;
  /** 这一块在文档里的起始位置 */
  pos: number;
  /** 节点类型名：用来判断"这块还在不在原地" */
  typeName: string;
  node: ProseNode;
  /** 进源码态时的初始文本（解析失败恢复时用） */
  source: string;
  /** 光标在源码里的落点（进块时算一次，之后归文本域自己管） */
  caret: number;
  /** 用户改过没有：没改就不提交，别平白往撤销栈里塞一步 */
  edited: boolean;
  error: string | null;
  /** 输入法组合中：这期间不许进出块 */
  composing: boolean;
  /** widget 的 toDOM：身份稳定，PM 才不会把文本域拔了重插（那会丢焦点和光标） */
  dom: () => HTMLElement;
  ta: HTMLTextAreaElement | null;
  err: HTMLParagraphElement | null;
};

type LiveState = {
  active: LiveActive | null;
  /** 光标当前所在的、可以进源码态的块（还没真进去，等定时器确认） */
  targetPos: number | null;
  /**
   * 这个位置上"暂时别进去"。Esc 退出后光标还停在原来那块上，不记这一笔的话
   * 120ms 后定时器会把刚退出的那块又打开一遍 —— 看起来就是"Esc 没用"。
   */
  muted: number | null;
  /** 这次事务是"用户在打字"（不是我们自己的提交） */
  typed: boolean;
};

/** 某个节点该配哪种源码态排版（决定字号 / 缩进跟它渲染时长一个样，切换才不跳） */
function liveKindClass(node: ProseNode): string {
  switch (node.type.name) {
    case "heading":
      return `md-wysiwyg__live--h${node.attrs.level ?? 1}`;
    case "blockquote":
      return "md-wysiwyg__live--quote";
    case "list_item":
      return "md-wysiwyg__live--item";
    case "table":
      return "md-wysiwyg__live--table";
    default:
      return "md-wysiwyg__live--para";
  }
}

/**
 * 单节点序列化：把这一块变成 Markdown 文本。
 *
 * `serializerCtx` 只吃整篇文档，所以临时把这一块包进一个空文档再序列化。
 * 列表项要**连它所在的那层列表一起裹**：孤儿 listItem 在 mdast 里排不出「- 」/「1. 」，
 * 序号会丢（有序列表会悄悄变成无序）。解析回来时用 parseLiveSource 对称地脱掉这一层。
 */
function serializeLiveBlock(
  ctx: Ctx,
  doc: ProseNode,
  pos: number,
  node: ProseNode,
): string {
  const schema = ctx.get(schemaCtx);
  const serializer = ctx.get(serializerCtx);
  const parent = doc.resolve(pos).parent;
  const wrapped = LIVE_LIST_TYPES.has(parent.type.name)
    ? parent.type.create(parent.attrs, node, parent.marks)
    : node;
  const only = schema.topNodeType.create(null, wrapped);
  return serializer(only).replace(/\n+$/, "");
}

/**
 * 源码文本 → 可以直接换掉原节点的内容片段；解析不了就返回 null（调用方保留原节点）。
 *
 * 两道闸：产物要放得进原来那个位置（`canReplace`，PM 的事务不做 schema 校验，
 * 硬塞会造出非法文档）；空的产物要给个空段落顶上，别把块整个删掉（父节点的内容规则
 * 可能不允许少这一块）。
 */
function parseLiveSource(
  ctx: Ctx,
  source: string,
  doc: ProseNode,
  pos: number,
  node: ProseNode,
): Fragment | null {
  const schema = ctx.get(schemaCtx);
  const parent = doc.resolve(pos).parent;
  let parsed: ProseNode;
  try {
    parsed = ctx.get(parserCtx)(source);
  } catch {
    return null;
  }
  if (!parsed) return null;

  let content = parsed.content;
  if (LIVE_LIST_TYPES.has(parent.type.name)) {
    // 序列化时裹了一层列表，这里脱掉；用户把「- 」改成「1. 」也走这条
    const only =
      parsed.childCount === 1 && LIVE_LIST_TYPES.has(parsed.firstChild!.type.name)
        ? parsed.firstChild!
        : null;
    if (only) content = only.content;
  }
  if (content.size === 0) {
    const empty = schema.nodes.paragraph?.createAndFill();
    if (!empty) return null;
    content = Fragment.from(empty);
  }
  // 闸门：拿真正的 ReplaceStep 试一把 —— 它跟后面要提交的那次事务走同一套规则。
  // **别用 `doc.canReplace(from, to, ...)`**：那个 API 的 from/to 是"第几个子节点"，
  // 不是文档位置。把位置传进去，它要么瞎返回 true 放行非法替换（最后在 fitter 里
  // 抛 Index out of range），要么把合法编辑误判成不合法。
  try {
    const probe = new ReplaceStep(pos, pos + node.nodeSize, new Slice(content, 0, 0));
    if (probe.apply(doc).failed) return null;
  } catch {
    return null;
  }
  return content;
}

/** 光标在块内的文本偏移 → 源码里的字符偏移（近似映射，见提案风险表） */
function caretInSource(state: EditorState, pos: number, node: ProseNode, source: string): number {
  const offset = state.selection.from - pos - 1; // 节点内容里的偏移
  const plain = offset > 0 ? node.textBetween(0, Math.min(offset, node.content.size), "\n", " ") : "";
  if (!plain) return leadingMarker(source);
  const head = source.indexOf(plain);
  if (head >= 0) return head + plain.length;
  // 多行块（引用 / 列表）源码里插了 `> ` 这类前缀，整段前缀对不上 —— 退一步只认最后一行
  const lastLine = plain.slice(plain.lastIndexOf("\n") + 1);
  const tail = lastLine ? source.indexOf(lastLine) : -1;
  return tail >= 0 ? tail + lastLine.length : 0;
}

/** `## `、`> `、`- `、`1. ` 这些开头记号有多长（光标落在块首时停在记号之后，读起来才顺） */
function leadingMarker(source: string): number {
  const found = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+|\|[ \t]?)*/.exec(source);
  return found ? found[0].length : 0;
}

function syncLiveHeight(rec: LiveActive) {
  const ta = rec.ta;
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`;
}

function syncLiveError(rec: LiveActive) {
  if (!rec.err) return;
  rec.err.textContent = rec.error ?? "";
  rec.err.hidden = rec.error == null;
}

/** 造源码态的那块 DOM。`rec.dom` 只在第一次调用时走到这里（之后复用同一个元素） */
function buildLiveDom(rec: LiveActive, hooks: LiveHooks): HTMLDivElement {
  const box = document.createElement("div");
  box.className = `md-wysiwyg__live ${liveKindClass(rec.node)}`;

  const ta = document.createElement("textarea");
  ta.className = "md-wysiwyg__live-input";
  ta.rows = 1;
  ta.spellcheck = false;
  ta.value = rec.source;
  ta.addEventListener("input", () => hooks.input(rec));
  ta.addEventListener("keydown", (event) => hooks.keydown(rec, event));
  ta.addEventListener("blur", () => hooks.blur(rec));
  ta.addEventListener("compositionstart", () => {
    rec.composing = true;
  });
  ta.addEventListener("compositionend", () => {
    rec.composing = false;
  });

  const err = document.createElement("p");
  err.className = "md-wysiwyg__live-error";
  err.hidden = true;

  box.append(ta, err);
  rec.ta = ta;
  rec.err = err;
  return box;
}

type LiveHooks = {
  input: (rec: LiveActive) => void;
  keydown: (rec: LiveActive, event: KeyboardEvent) => void;
  blur: (rec: LiveActive) => void;
};

/** 光标所在的那个"块"的起始位置；不在任何可进块的节点里就返回 null */
function findLiveTarget(state: EditorState): number | null {
  const sel = state.selection;
  // 只有"落定的光标"才算：拖选一段、选中整个节点（图片）时不切
  if (!(sel instanceof TextSelection) || !sel.empty) return null;
  const $head = sel.$head;
  for (let d = $head.depth; d >= 1; d--) {
    if (LIVE_SKIP_TYPES.has($head.node(d).type.name)) return null;
  }
  for (let d = 1; d <= $head.depth; d++) {
    const node = $head.node(d);
    if (!LIVE_BLOCK_TYPES.has(node.type.name)) continue;
    // 空块没有语法可显示：保持普通文本行（也否则一进去就没法打字了）
    return node.content.size === 0 ? null : $head.before(d);
  }
  return null;
}

function selectionInside(state: EditorState, rec: LiveActive): boolean {
  const sel = state.selection;
  return sel.from > rec.pos && sel.to < rec.pos + rec.node.nodeSize;
}

/**
 * 光标所在块显示源码。
 *
 * 状态机只有两条线：
 *   ① 光标挪进某块 → 等 LIVE_ENTER_DELAY 确认（连跳时只认最后停下那块）→ 进源码态；
 *   ② 光标离开 / 失焦 / Esc → 退出，改动多的那次交给 appendTransaction 一次性提交。
 * 位置一律由 `tr.selection` 现算，不缓存，所以不会攒出"过期位置"。
 */
function createLiveSource(ctx: Ctx, emit: (markdown: string) => void): Plugin {
  const key = new PluginKey<LiveState>("framevault-live-source");
  const viewRef: { current: EditorView | null } = { current: null };
  /** 待提交的源码态：apply 填，appendTransaction 消费 */
  let waiting: LiveActive | null = null;
  let focusedId: number | null = null;
  let nextId = 1;
  let enterTimer: ReturnType<typeof setTimeout> | null = null;
  let projectTimer: ReturnType<typeof setTimeout> | null = null;
  /** 文档真值变过的次数（提交 / 取消）：用来在 view.update 里补一次 emit，不走 200ms 防抖 */
  let syncTick = 0;
  let lastSync = 0;
  /** 见 LiveState.muted：光标一动就清掉 */
  let muted: number | null = null;

  const disarm = () => {
    if (enterTimer != null) {
      clearTimeout(enterTimer);
      enterTimer = null;
    }
  };
  const dropProjection = () => {
    if (projectTimer != null) {
      clearTimeout(projectTimer);
      projectTimer = null;
    }
  };
  const isActive = (rec: LiveActive) =>
    viewRef.current != null && key.getState(viewRef.current.state)?.active === rec;

  function makeActive(state: EditorState, pos: number): LiveActive | null {
    const node = state.doc.nodeAt(pos);
    if (!node) return null;
    let source: string;
    try {
      source = serializeLiveBlock(ctx, state.doc, pos, node);
    } catch {
      return null;
    }
    let box: HTMLDivElement | null = null;
    const rec: LiveActive = {
      id: nextId++,
      pos,
      typeName: node.type.name,
      node,
      source,
      caret: caretInSource(state, pos, node, source),
      edited: false,
      error: null,
      composing: false,
      ta: null,
      err: null,
      dom: () => (box ??= buildLiveDom(rec, hooks)),
    };
    return rec;
  }

  /**
   * 提交之后把源码态挪到新文档里对应的位置，顺手清掉"改过"和错误提示。
   *
   * **就地改**（不新造一个记录）：文本域上挂的事件闭包认的是这个对象，
   * 换一个对象它们就全部失效 —— 表现是"提交过一次之后，在同一个源码态里再敲字没人管"。
   */
  function relocate(doc: ProseNode, rec: LiveActive, tr: Transaction): LiveActive | null {
    const pos = tr.mapping.map(rec.pos, 1);
    // nodeAt 越界会抛 RangeError，映射后的位置先量一下
    if (pos < 0 || pos > doc.content.size) return null;
    const node = doc.nodeAt(pos);
    if (!node || node.type.name !== rec.typeName) return null;
    rec.pos = pos;
    rec.node = node;
    rec.source = rec.ta ? rec.ta.value : rec.source;
    rec.edited = false;
    rec.error = null;
    return rec;
  }

  /** 源码态里的编辑"粗投影"到整篇 Markdown：给上层看草稿，不碰文档 */
  function project(): void {
    const view = viewRef.current;
    if (!view) return;
    const rec = key.getState(view.state)?.active;
    if (!rec || !rec.ta || !rec.edited) return;
    const doc = view.state.doc;
    const content = parseLiveSource(ctx, rec.ta.value, doc, rec.pos, rec.node);
    if (!content) return;
    try {
      const projected = doc.replace(
        rec.pos,
        rec.pos + rec.node.nodeSize,
        new Slice(content, 0, 0),
      );
      emit(ctx.get(serializerCtx)(projected));
    } catch {
      /* 投影只是给上层看的，出错就算了，真正的提交在离开时 */
    }
  }

  const hooks: LiveHooks = {
    input(rec) {
      if (!isActive(rec)) return;
      rec.edited = true;
      // 用户已经在改了，错误提示先收掉（下次离开时再判）
      if (rec.error) {
        rec.error = null;
        syncLiveError(rec);
      }
      syncLiveHeight(rec);
      dropProjection();
      projectTimer = setTimeout(() => {
        projectTimer = null;
        project();
      }, LIVE_PROJECT_DELAY);
    },
    keydown(rec, event) {
      const view = viewRef.current;
      if (!view || !isActive(rec) || rec.composing || event.isComposing) return;
      const ta = rec.ta;
      if (!ta) return;
      if (event.key === "Escape") {
        // 放弃这次源码编辑，退回渲染态（父组件那边若收过投影，会在 syncTick 那步拉回来）
        event.preventDefault();
        view.dispatch(view.state.tr.setMeta(key, { deactivate: true }));
        // 文本域马上会被摘掉，焦点会掉到 <body>；不还给编辑器的话，
        // 接下来的打字和 Ctrl+Z 都落空 —— 退出就应该是"回到文档里"
        view.focus();
        return;
      }
      // 光标顶到源码的第一行 / 最后一行还想继续走：退出这一块，把光标交给相邻的块，
      // 否则进了文本域就再也用方向键走不出去了
      const up = event.key === "ArrowUp" && ta.value.lastIndexOf("\n", ta.selectionStart - 1) < 0;
      const down =
        event.key === "ArrowDown" && ta.value.indexOf("\n", ta.selectionStart) < 0;
      if (!up && !down) return;
      event.preventDefault();
      const doc = view.state.doc;
      const edge = down ? rec.pos + rec.node.nodeSize : rec.pos;
      const near = doc.resolve(Math.max(0, Math.min(edge, doc.content.size)));
      view.dispatch(view.state.tr.setSelection(TextSelection.near(near, down ? 1 : -1)));
      disarm();
      view.focus();
    },
    blur(rec) {
      // 失焦（比如去点"保存"）不能把焦点抢回来，所以这里只提交、不退出
      const view = viewRef.current;
      if (!view || !isActive(rec) || rec.composing || !rec.edited) return;
      view.dispatch(view.state.tr.setMeta(key, { flush: true }));
    },
  };

  return new Plugin<LiveState>({
    key,
    state: {
      init: (_config, state) => ({
        active: null,
        targetPos: findLiveTarget(state),
        muted: null,
        typed: false,
      }),
      apply: (tr, prev, oldState, newState) => {
        const meta = (tr.getMeta(key) ?? {}) as LiveMeta;
        if (!oldState.selection.eq(newState.selection)) muted = null;
        let active = prev.active;

        if (meta.restore) {
          // 提交失败：原节点一个字都没动，把源码态摆回来挂上提示。
          // 这一笔**不按选区判**——正因为用户的选区已经走了才触发的提交
          active = meta.restore;
        } else {
          if (active && meta.commit) {
            active = relocate(newState.doc, active, tr);
          } else if (active && tr.docChanged) {
            // 文档被别人整份换掉了（切了另一篇）→ 源码态作废，别拿旧位置去动新文档
            active = null;
          }

          // 失焦保命：改动先落进文档，源码态留着（提交事务回来时 relocate 会清掉 edited）
          if (active && meta.flush && active.edited) waiting = active;

          if (active && (meta.deactivate || !selectionInside(newState, active))) {
            if (meta.deactivate) {
              // Esc = "放弃这次源码编辑"：一个字都不往文档里写（也不提交），
              // 只把父组件的草稿拉回文档真值。解析失败卡住时，这是唯一的出口。
              syncTick++;
            } else if (active.edited) {
              waiting = active;
            }
            muted = meta.deactivate ? active.pos : null;
            active = null;
          }
        }

        const targetPos = findLiveTarget(newState);
        if (
          !active &&
          meta.activate != null &&
          meta.activate === targetPos &&
          !viewRef.current?.composing
        ) {
          active = makeActive(newState, targetPos);
        }

        return {
          active,
          targetPos,
          muted,
          typed: tr.docChanged && !meta.commit && !meta.restore,
        };
      },
    },
    props: {
      decorations: (state) => {
        const rec = key.getState(state)?.active;
        if (!rec) return null;
        const size = rec.node.nodeSize;
        if (rec.pos < 0 || rec.pos + size > state.doc.content.size) return null;
        try {
          return DecorationSet.create(state.doc, [
            // 结构一个字不动，只把这一块藏起来
            Decoration.node(rec.pos, rec.pos + size, { class: "md-wysiwyg__live-hidden" }),
            // 源码文本域就插在它的位置上
            Decoration.widget(rec.pos, rec.dom, {
              side: -1,
              stopEvent: liveStopAll,
              ignoreSelection: true,
            }),
          ]);
        } catch {
          return null;
        }
      },
    },
    appendTransaction: (trs, _oldState, newState) => {
      const rec = waiting;
      if (!rec) return null;
      waiting = null;
      const source = rec.ta ? rec.ta.value : rec.source;
      let pos = rec.pos;
      for (const tr of trs) pos = tr.mapping.map(pos, 1);
      if (pos < 0 || pos > newState.doc.content.size) return null;
      const node = newState.doc.nodeAt(pos);
      // 这一块已经不在原地了（被删 / 被换）→ 什么都不做，用户的改动落空总比改错地方强
      if (!node || node.type.name !== rec.typeName) return null;

      const content = parseLiveSource(ctx, source, newState.doc, pos, node);
      if (!content) {
        // 解析不了：**原节点一个字都不动**，把源码态原样摆回来并挂一个看得见的提示。
        // 就地改这个记录（原因同 relocate）：文本域上还挂着它的监听，换对象等于把用户的输入丢在半路
        rec.pos = pos;
        rec.node = node;
        rec.edited = false;
        rec.error = LIVE_PARSE_ERROR;
        return newState.tr.setMeta(key, { restore: rec });
      }
      syncTick++;
      return newState.tr
        .replaceWith(pos, pos + node.nodeSize, content)
        .setMeta(key, { commit: true });
    },
    view: (view) => {
      viewRef.current = view;
      return {
        update: (current) => {
          const state = key.getState(current.state);
          if (!state) return;

          if (focusedId !== (state.active?.id ?? null)) {
            focusedId = state.active?.id ?? null;
            dropProjection();
            // 出错的源码态不抢焦点（用户已经点到别处去了，硬拉回来只会打架）
            if (state.active && !state.active.error) {
              const rec = state.active;
              const box = rec.dom() as HTMLDivElement;
              const ta = rec.ta;
              if (ta && box.parentNode) {
                syncLiveHeight(rec);
                ta.setSelectionRange(rec.caret, rec.caret);
                ta.focus({ preventScroll: true });
              }
            }
          }
          if (state.active) syncLiveError(state.active);

          // 提交 / 取消之后补一次"整篇真值"，别让上层的草稿停在投影上（listener 那边有 200ms 防抖）
          if (syncTick !== lastSync) {
            lastSync = syncTick;
            emit(ctx.get(serializerCtx)(current.state.doc));
          }

          // 进块要晚一点：按住方向键连跳时，只让最后停下的那块翻面，才不闪
          if (
            !state.active &&
            state.targetPos != null &&
            state.targetPos !== state.muted &&
            !state.typed &&
            !current.composing
          ) {
            const pos = state.targetPos;
            disarm();
            enterTimer = setTimeout(() => {
              enterTimer = null;
              const live = viewRef.current;
              if (!live || live.composing) return;
              const now = key.getState(live.state);
              if (!now || now.active || now.targetPos !== pos) return;
              live.dispatch(live.state.tr.setMeta(key, { activate: pos }));
            }, LIVE_ENTER_DELAY);
          } else {
            disarm();
          }
        },
        destroy: () => {
          disarm();
          dropProjection();
          viewRef.current = null;
        },
      };
    },
  });
}

function Surface({ value, onChange }: Props) {
  // 父组件的 onChange 每次渲染都是新函数；用 ref 兜住，别让它把编辑器重建了
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // 记住"我们自己刚发出去的那份"，用来分辨 value 的变化是外部换篇还是自己回显
  const emitted = useRef(value);
  // 往上报告的唯一出口：同一份内容不重复报（源码态的投影 / 提交 / listener 都会走到这）
  const emit = (markdown: string) => {
    if (markdown === emitted.current) return;
    emitted.current = markdown;
    onChangeRef.current(markdown);
  };
  const emitRef = useRef(emit);
  emitRef.current = emit;

  const { get } = useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, value);
        // 粘贴走 EditorProps 的 handlePaste：它的优先级高于任何插件，所以能压过 clipboard 插件的默认行为
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          handlePaste: (view, event) => {
            const data = event.clipboardData;
            const text = data ? markdownFromPaste(data) : null;
            if (text === null) return false;
            const doc = ctx.get(parserCtx)(text);
            if (!doc || typeof doc === "string") return false;
            view.dispatch(
              view.state.tr.replaceSelection(new Slice(doc.content, 0, 0)).scrollIntoView(),
            );
            return true;
          },
        }));
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          emitRef.current(markdown);
        });
      })
      .use(commonmark)
      .use(gfm)
      // clipboard 插件负责「复制出去给的是 Markdown 文本」（粘贴那半边由上面的 handlePaste 管）
      .use(clipboard)
      .use(listener)
      .use($prose((ctx) => createLiveSource(ctx, (markdown) => emitRef.current(markdown))))
      // 撤销栈自己装、键位自己绑。
      // 不用 `@milkdown/plugin-history`：它的 `$prose` provider 在这里拿不到
      // `historyProviderConfig` 那个 slice（实测 `undo()` 直接返回 false，说明 state 插件压根没进去），
      // 另外它的 `historyKeymap` 也是白给 —— 它等 KeymapReady 之后才往 keymap 管理器里加，
      // 而编辑器状态那边一拿到 KeymapReady 就把 keymap 建好了。两个坑一起绕开。
      .use($prose(() => historyPlugin()))
      .use(
        $prose(() =>
          keymap({
            "Mod-z": undo,
            "Shift-Mod-z": redo,
            "Mod-y": redo,
          }),
        ),
      ),
  );

  // 外部换了内容（切换了另一篇）→ 把编辑器的内容也换掉；不能每次都换，否则跟打字打架
  useEffect(() => {
    if (value === emitted.current) return;
    const editor = get();
    if (!editor) return;
    emitted.current = value;
    editor.action(replaceAll(value));
  }, [value, get]);

  return <Milkdown />;
}

export default function MarkdownWysiwyg(props: Props) {
  return (
    <MilkdownProvider>
      <div className="md-wysiwyg">
        <Surface {...props} />
      </div>
    </MilkdownProvider>
  );
}
