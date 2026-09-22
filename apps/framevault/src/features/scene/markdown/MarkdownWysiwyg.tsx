import { useEffect, useRef } from "react";
import { Editor, defaultValueCtx, rootCtx } from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { replaceAll } from "@milkdown/kit/utils";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
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
 */
type Props = {
  value: string;
  onChange: (markdown: string) => void;
};

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
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          emitted.current = markdown;
          onChangeRef.current(markdown);
        });
      })
      .use(commonmark)
      .use(gfm)
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
