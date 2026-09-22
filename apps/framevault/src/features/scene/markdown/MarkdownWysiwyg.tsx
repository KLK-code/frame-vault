import { useEffect, useRef } from "react";
import { Editor, defaultValueCtx, editorViewOptionsCtx, parserCtx, rootCtx } from "@milkdown/kit/core";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Slice } from "@milkdown/kit/prose/model";
import { replaceAll } from "@milkdown/kit/utils";
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

function Surface({ value, onChange }: Props) {
  // 父组件的 onChange 每次渲染都是新函数；用 ref 兜住，别让它把编辑器重建了
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // 记住"我们自己刚发出去的那份"，用来分辨 value 的变化是外部换篇还是自己回显
  const emitted = useRef(value);

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
          emitted.current = markdown;
          onChangeRef.current(markdown);
        });
      })
      .use(commonmark)
      .use(gfm)
      // clipboard 插件负责「复制出去给的是 Markdown 文本」（粘贴那半边由上面的 handlePaste 管）
      .use(clipboard)
      .use(listener),
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
