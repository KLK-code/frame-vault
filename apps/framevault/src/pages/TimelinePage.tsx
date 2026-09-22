import { useEffect, useState } from "react";
import { listEntries, type Entry } from "../lib/api";
import "./TimelinePage.css";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

export default function TimelinePage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      setEntries(await listEntries());
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <>
      <div className="timeline__head">
        <h1>时间线</h1>
        <button className="timeline__refresh" onClick={refresh} disabled={loading}>
          {loading ? "读取中…" : "刷新"}
        </button>
      </div>

      {error && <p className="timeline__error">{error}</p>}

      {!error && !loading && entries.length === 0 && (
        <p className="timeline__empty">这个仓库里还没有记录。</p>
      )}

      <ul className="timeline__list">
        {entries.map((entry) => (
          <li key={entry.id} className="timeline__item">
            <span className="timeline__title">{entry.title || "(无标题)"}</span>
            <span className="timeline__time">{formatTime(entry.createdAt)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
