import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
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
 * 正文输入控件（所见即所得）：一整块区域，**文档本身就是 Markdown 文本**，边写边渲染。
 *
 * 跟 MarkdownField 的关系：**对外接口一模一样**（value 进、markdown 字符串出），
 * 区别只在"编辑引擎"——MarkdownField 是 textarea + 工具栏，这个是 CodeMirror 6。
 * 两者都**只产出 Markdown**，所以磁盘格式、渲染器、主题都不用知道用的是哪个。
 *
 * 为什么换掉 ProseMirror：我们要的是 Obsidian 那种手感 —— 源码即真值、语法符号用装饰藏/显、
 * 选区永远贯穿全篇。ProseMirror 的文档是节点树，`**` 根本不在文档里，"藏/显"只能靠
 * 序列化来回翻译，于是必然出现"两份表示"以及随之而来的盒子、层切换、选区被困。
 * 装饰规则见 `livePreview.ts`。
 *
 * 它重（带进 CM6 家族），所以**只在写作台里按需加载**（React.lazy）。
 *
 * 粘贴是纯文本插入 —— 文档就是 Markdown，粘一整篇 `.md` 进来当场就是排好版的样子。
 */
type Props = {
  value: string;
  onChange: (markdown: string) => void;
};

/** 每次按键都重渲染没必要；攒一小会儿再报上去（与旧实现的 200ms 体感一致） */
const EMIT_DELAY = 220;

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
    color: "var(--fv-color-text)",
    fontSize: "var(--fv-text-base)",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    minHeight: "320px",
    maxHeight: "70vh",
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
    padding: "var(--fv-space-4)",
    fontFamily: "inherit",
    caretColor: "var(--fv-color-accent)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor": {
    borderLeftWidth: "2px",
    borderLeftColor: "var(--fv-color-accent)",
  },
});

function Surface({ value, onChange }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // 记住"我们自己刚发出去的那份"，用来分辨 value 的变化是外部换篇还是自己回显
  const emitted = useRef(value);
  const timer = useRef<number | null>(null);

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
          livePreview,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const markdownText = update.state.doc.toString();
            // 先记下"这是我们自己写出去的那份"，再攒一小会儿报给父组件
            emitted.current = markdownText;
            if (timer.current != null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => {
              timer.current = null;
              onChangeRef.current(markdownText);
            }, EMIT_DELAY);
          }),
          editorTheme,
          // Ctrl/Cmd + 点击链接 → 交给系统浏览器，别让 WebView 自己跳走
          EditorView.domEventHandlers({
            mousedown(event, instance) {
              if (!event.metaKey && !event.ctrlKey) return false;
              const pos = instance.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos == null) return false;
              let node = syntaxTree(instance.state).resolveInner(pos, 0);
              for (; node; node = node.parent!) {
                if (node.name === "URL") {
                  const url = instance.state.doc.sliceString(node.from, node.to);
                  void openExternal(url).catch(() => undefined);
                  return true;
                }
                if (node.name === "Link") {
                  for (let child = node.firstChild; child; child = child.nextSibling) {
                    if (child.name === "URL") {
                      const url = instance.state.doc.sliceString(child.from, child.to);
                      void openExternal(url).catch(() => undefined);
                      return true;
                    }
                  }
                }
                if (!node.parent) break;
              }
              return false;
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

  return <div className="md-wysiwyg__host" ref={host} onMouseDown={onHostMouseDown} />;
}

export default function MarkdownWysiwyg(props: Props) {
  return (
    <div className="md-wysiwyg">
      <Surface {...props} />
    </div>
  );
}
