import { useRef, useState } from "react";
import MarkdownView from "./MarkdownView";
import "./MarkdownField.css";

/** 换行 / 反引号用码点拼：这份文件里到处都要用，写成裸字符反而看不清结构 */
const NL = String.fromCharCode(10);
const TICK = String.fromCharCode(96);
const FENCE = TICK + TICK + TICK;

type Action = {
  key: string;
  label: string;
  title: string;
  /** prefix：给选中的每一行加前缀；wrap：包住选区；block：前后各加一段 */
  kind: "prefix" | "wrap" | "block";
  prefix: string;
  suffix?: string;
  sample?: string;
};

const ACTIONS: Action[] = [
  { key: "h2", label: "H2", title: "小标题", kind: "prefix", prefix: "## " },
  { key: "b", label: "B", title: "加粗", kind: "wrap", prefix: "**", suffix: "**", sample: "加粗" },
  { key: "i", label: "I", title: "斜体", kind: "wrap", prefix: "*", suffix: "*", sample: "斜体" },
  { key: "ul", label: "•", title: "无序列表", kind: "prefix", prefix: "- " },
  { key: "ol", label: "1.", title: "有序列表", kind: "prefix", prefix: "1. " },
  { key: "quote", label: "❝", title: "引用", kind: "prefix", prefix: "> " },
  { key: "task", label: "☐", title: "任务", kind: "prefix", prefix: "- [ ] " },
  { key: "code", label: "‹›", title: "行内代码", kind: "wrap", prefix: TICK, suffix: TICK, sample: "代码" },
  { key: "pre", label: FENCE, title: "代码块", kind: "block", prefix: FENCE + NL, suffix: NL + FENCE },
];

/**
 * 正文输入控件：textarea + 语法工具栏 + 编辑 / 预览 切换。
 *
 * 它**只产出 Markdown 字符串**，不碰数据、也不认识记录 —— 所以渲染器换不换、主题怎么写都跟它无关。
 * 三个坑都在这儿治好了（也记进了 AGENTS §9）：
 *   1. 工具栏按钮 onMouseDown 里 preventDefault：不然点按钮会抢走焦点，手机键盘当场收起来；
 *   2. 插入用 setRangeText 而不是自己拼字符串：自己拼会把浏览器的撤销栈清掉（Ctrl+Z 一次全丢）；
 *   3. 中文输入法组合期间（composition）不碰选区，否则拼音串会被截断。
 */
export default function MarkdownField({
  id,
  value,
  placeholder,
  rows = 4,
  onChange,
}: {
  id?: string;
  value: string;
  placeholder?: string;
  rows?: number;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  function apply(action: Action) {
    const el = ref.current;
    if (!el || composing.current) return;

    const text = el.value;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? start;

    if (action.kind === "prefix") {
      // 前缀类动作作用在"选中的每一行"（没选就当前行）
      const lineStart = text.lastIndexOf(NL, start - 1) + 1;
      const found = text.indexOf(NL, end);
      const lineEnd = found === -1 ? text.length : found;
      const next = text
        .slice(lineStart, lineEnd)
        .split(NL)
        .map((line) => action.prefix + line)
        .join(NL);
      el.focus();
      el.setRangeText(next, lineStart, lineEnd, "end");
      el.setSelectionRange(lineStart + next.length, lineStart + next.length);
    } else {
      const selected = text.slice(start, end);
      const inner = selected || action.sample || "";
      const next = action.prefix + inner + (action.suffix ?? "");
      el.focus();
      el.setRangeText(next, start, end, "end");
      // 选中刚插进去的内容，接着敲或直接往下写
      el.setSelectionRange(start + action.prefix.length, start + action.prefix.length + inner.length);
    }

    // 让 React 收到这次改动（受控 textarea 靠 input 事件同步）
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return (
    <div className="md-field">
      <div className="md-field__head">
        <div className="md-field__bar" role="toolbar" aria-label="Markdown 语法">
          {ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              className="md-field__btn"
              title={action.title}
              aria-label={action.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
        <div className="md-field__modes">
          <button
            type="button"
            className={mode === "edit" ? "md-field__mode is-active" : "md-field__mode"}
            onClick={() => setMode("edit")}
          >
            编辑
          </button>
          <button
            type="button"
            className={mode === "preview" ? "md-field__mode is-active" : "md-field__mode"}
            onClick={() => setMode("preview")}
          >
            预览
          </button>
        </div>
      </div>

      {mode === "edit" ? (
        <textarea
          id={id}
          ref={ref}
          className="field__control md-field__input"
          rows={rows}
          placeholder={placeholder}
          value={value}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="md-field__preview">
          {value.trim() ? <MarkdownView text={value} /> : <p className="md-field__empty">还没有内容</p>}
        </div>
      )}
    </div>
  );
}
