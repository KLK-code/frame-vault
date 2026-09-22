import { useCallback, useEffect, useState } from "react";
import { listEntries, newId, saveEntry, type Entry } from "../../../../lib/api";
import type { SceneViewProps } from "../../registry";
import "./PlainScene.css";

function formatTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * 内置"普通记录"：一条流水记录 = 一个标题 + 时间。
 *
 * 它同时是主题的**最小示例**——别的主题照着这个骨架写就行：
 * 从 props 拿到场景 → 自己决定列出什么、怎么录入 → 数据都存进 entry.fields。
 */
export default function PlainScene({ folder, scene }: SceneViewProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setEntries(await listEntries(folder.id));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [folder.id]);

  // 换场景就重新拉一次（列表按场景过滤）
  useEffect(() => {
    void reload();
  }, [reload]);

  async function add() {
    const text = title.trim();
    if (!text || busy) return;

    setBusy(true);
    try {
      const id = await newId();
      await saveEntry(id, text, { folderId: folder.id });
      setTitle("");
      await reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="plain-scene">
      <div className="plain-scene__compose">
        <input
          value={title}
          placeholder={`记点什么…（${scene.name}）`}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
        />
        <button onClick={() => void add()} disabled={busy || !title.trim()}>
          记录
        </button>
      </div>

      {error && <p className="plain-scene__error">{error}</p>}

      {entries.length === 0 ? (
        <p className="plain-scene__empty">这个场景还没有记录。</p>
      ) : (
        <ul className="plain-scene__list">
          {entries.map((entry) => (
            <li key={entry.id} className="entry">
              <span className="entry__title">{entry.title}</span>
              <time className="entry__time" dateTime={entry.createdAt}>
                {formatTime(entry.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}

      <p className="plain-scene__count">
        {entries.length > 0 && `共 ${entries.length} 条`}
      </p>
    </div>
  );
}
