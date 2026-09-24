/**
 * 临时 harness：把 EntryTimeline 拿假的 SceneData 挂起来，在**真浏览器**里点它。
 *
 * 为什么要有它（AGENTS §9）：时间线要跑起来得靠 Tauri 后端，而"点一下就改 / 自动保存 /
 * 源码切换"这些行为在跑着的 app 里既不好反复触发（HMR 也不重建编辑器），
 * 所以用浏览器自动化在 harness 上精确点选、读 DOM 与计算样式。
 *
 * 用法：`pnpm dev` 然后打开 http://localhost:1420/harness.html
 * 它不是产品的一部分：vite 只把 index.html 当入口，这个文件不进构建产物。
 */
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/layers.css";
import "./styles/reset.css";
import "./styles/compact.css";
import "./tokens.css";
import "./skins.css";
import EntryTimeline from "./features/scene/EntryTimeline";
import type { SceneData } from "./features/scene/useSceneData";
import type { Entry } from "./lib/api";
import type { FieldDecl } from "./features/scene/manifest";

type Edit = { id: string; title: string; note: string };

declare global {
  interface Window {
    __edits: Edit[];
  }
}
window.__edits = [];

const fields: FieldDecl[] = [
  { key: "text", label: "正文", type: "textarea", note: true, placeholder: "写点什么…" },
];

function entry(id: string, title: string, note: string, createdAt: string): Entry {
  return {
    id,
    title,
    day: createdAt.slice(0, 10),
    tags: [],
    createdAt,
    updatedAt: createdAt,
    folderId: "folder-1",
    scene: "builtin.plain",
    fields: {},
    media: [],
    order: null,
    note,
  } as unknown as Entry;
}

const RICH = [
  "# 一级标题",
  "",
  "这是**加粗**、*斜体*、`行内码`，还有一个[链接](https://example.com)。",
  "",
  "- 列表第一项",
  "- 列表第二项",
  "",
  "> 引用一句",
  "",
  "| 列 A | 列 B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "```js",
  "const a = 1;",
  "```",
].join("\n");

const LONG = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行长文本，用来量长记录在时间线里会不会被压成内部滚动。`).join("\n\n");

const entries = [
  entry("e1", "带各种语法的记录", RICH, "2026-09-24T02:00:00.000Z"),
  entry("e2", "长文记录", LONG, "2026-09-23T02:00:00.000Z"),
  entry("e3", "只有标题的记录", "", "2026-09-22T02:00:00.000Z"),
];

const data: SceneData = {
  entries,
  media: [],
  busy: null,
  error: null,
  reload: async () => undefined,
  mediaOf: () => [],
  dateOf: (item: Entry) => item.day,
  create: async () => null,
  edit: async (target: Entry, patch) => {
    const text = Object.fromEntries(
      fields.map((field) => [field.key, String(patch.note ?? "")]),
    ) as Record<string, string>;
    window.__edits.push({
      id: target.id,
      title: String(patch.title ?? ""),
      note: text.text ?? patch.note ?? "",
    });
    return true;
  },
  pickPhotos: async () => [],
  importPhotos: async () => false,
  attachPhotos: async () => false,
  createWithPhotos: async () => null,
  remove: async () => true,
  undo: async () => true,
  reorderEntries: async () => true,
  notice: null,
  dismissNotice: () => undefined,
  clearError: () => undefined,
};

/** 写盘次数实时显示在右上角，方便一眼看出"切换模式有没有偷偷写一次" */
function App() {
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const timer = window.setInterval(() => force((n) => n + 1), 300);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
      <p style={{ font: "12px system-ui", color: "#888" }}>
        #edits = {window.__edits.length}
        {window.__edits.length > 0 &&
          ` · 最后一次：${window.__edits[window.__edits.length - 1].title} / ${window.__edits[
            window.__edits.length - 1
          ].note.slice(0, 24)}…`}
      </p>
      <EntryTimeline
        data={data}
        sceneId="builtin.plain"
        fields={fields}
        emptyText="还没有记录。"
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
