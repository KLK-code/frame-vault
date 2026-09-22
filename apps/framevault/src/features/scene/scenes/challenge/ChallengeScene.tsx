import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assetUrl,
  importMedia,
  listEntries,
  listMedia,
  newId,
  pickMediaFiles,
  saveEntry,
  type Entry,
  type MediaItem,
} from "../../../../lib/api";
import MediaLightbox from "../../MediaLightbox";
import { displayableSrc, formatBytes, formatDay, localDay } from "../../mediaFormat";
import type { SceneViewProps } from "../../registry";
import { computeChallenge, relativeDay } from "./challengeStats";
import "./ChallengeScene.css";

/** 存在 folder.json 的 sceneConfig 里；核心（Rust）不解释它的内容 */
type ChallengeConfig = {
  /** 目标打卡天数；0 / 缺省 = 还没设目标 */
  targetDays?: number;
  /** 挑战规则，自由文本 */
  rules?: string;
};

/**
 * 内置"挑战"场景：照片墙 + 进度 + 连续天数。
 *
 * 打卡墙的核心差异：**一张照片算一格**（导入 3 张照片 = 建 3 条记录），
 * 所以这里不用普通记录那种"一条记录一个卡片"的画法。
 */
export default function ChallengeScene({ folder, scene, onSceneConfigChange }: SceneViewProps) {
  const config = (folder.sceneConfig ?? {}) as ChallengeConfig;
  const targetDays =
    typeof config.targetDays === "number" && config.targetDays > 0 ? Math.round(config.targetDays) : 0;
  const rules = typeof config.rules === "string" ? config.rules : "";

  const [entries, setEntries] = useState<Entry[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftTarget, setDraftTarget] = useState(targetDays > 0 ? String(targetDays) : "");
  const [draftRules, setDraftRules] = useState(rules);

  const today = localDay(new Date().toISOString()) ?? "";

  const reload = useCallback(async () => {
    try {
      const [list, all] = await Promise.all([listEntries(folder.id), listMedia(null)]);
      setEntries(list);
      const mine = new Set(list.map((entry) => entry.id));
      setMedia(all.filter((item) => item.entryId && mine.has(item.entryId)));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [folder.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 保存完（或外部改了配置）就把表单拉回最新值；正在编辑时不打扰
  useEffect(() => {
    if (editing) return;
    setDraftTarget(targetDays > 0 ? String(targetDays) : "");
    setDraftRules(rules);
  }, [editing, targetDays, rules]);

  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  /** 一格一张照片；日期优先用拍摄时间，没有就退回记录时间 */
  const cells = useMemo(() => {
    return media
      .filter((item) => item.entryId && entryById.has(item.entryId))
      .map((item) => ({
        item,
        iso: item.takenAt ?? entryById.get(item.entryId as string)?.createdAt ?? "",
      }))
      .sort((a, b) => b.iso.localeCompare(a.iso));
  }, [media, entryById]);

  const stats = useMemo(() => {
    const days = new Set<string>();
    for (const entry of entries) {
      const own = media.filter((item) => item.entryId === entry.id);
      const stamps = own.length > 0 ? own.map((item) => item.takenAt ?? entry.createdAt) : [entry.createdAt];
      for (const iso of stamps) {
        const day = localDay(iso);
        if (day) days.add(day);
      }
    }
    return computeChallenge(days, today);
  }, [entries, media, today]);

  const percent = targetDays > 0 ? Math.min(100, Math.round((stats.checked / targetDays) * 100)) : 0;

  /** 打卡主路径：选一批照片，一张照片建一条记录（所以一格 = 一张照片） */
  async function checkInWithPhotos() {
    if (busy) return;
    const files = await pickMediaFiles();
    if (files.length === 0) return;

    setBusy(true);
    try {
      const text = note.trim();
      for (const file of files) {
        const entryId = await newId();
        await saveEntry(entryId, text, { folderId: folder.id });
        await importMedia(file, entryId);
      }
      setNote("");
      await reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  /** 没有照片也能打卡（比如今天只是拉伸了一下） */
  async function checkInText() {
    const text = note.trim();
    if (!text || busy) return;

    setBusy(true);
    try {
      const entryId = await newId();
      await saveEntry(entryId, text, { folderId: folder.id });
      setNote("");
      await reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig() {
    const target = Math.round(Number(draftTarget));
    const next: ChallengeConfig = {
      ...config,
      targetDays: Number.isFinite(target) && target > 0 ? target : 0,
      rules: draftRules.trim(),
    };
    const ok = await onSceneConfigChange(next);
    if (ok) setEditing(false);
  }

  return (
    <div className="challenge">
      <section className="challenge__head">
        <div className="challenge__progress">
          <div className="challenge__bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <span className="challenge__fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="challenge__numbers">
            已打卡 <b>{stats.checked}</b> 天
            {targetDays > 0 ? (
              <>
                {" / 目标 "}
                <b>{targetDays}</b> 天 · {percent}%
              </>
            ) : (
              " · 还没设目标"
            )}
          </p>
        </div>

        <dl className="challenge__streaks">
          <div>
            <dt>连续</dt>
            <dd>{stats.streak} 天</dd>
          </div>
          <div>
            <dt>最长</dt>
            <dd>{stats.longest} 天</dd>
          </div>
        </dl>

        <button className="challenge__setup" onClick={() => setEditing((v) => !v)}>
          {editing ? "收起" : "设置挑战"}
        </button>
      </section>

      {stats.broken ? (
        <p className="challenge__state is-broken">
          连续已中断 · 上次打卡{stats.lastDay ? relativeDay(stats.lastDay, today) : "——"}。
          （只提示，没有清掉你任何记录）
        </p>
      ) : stats.checkedToday ? (
        <p className="challenge__state is-done">今天已打卡 ✓</p>
      ) : (
        <p className="challenge__state">今天还没打卡</p>
      )}

      {rules && <p className="challenge__rules">规则：{rules}</p>}

      {editing && (
        <div className="challenge__settings">
          <label className="challenge__field">
            <span>目标天数</span>
            <input
              type="number"
              min={1}
              placeholder="30"
              value={draftTarget}
              onChange={(e) => setDraftTarget(e.target.value)}
            />
          </label>
          <label className="challenge__field">
            <span>挑战规则</span>
            <textarea
              rows={3}
              placeholder="每天至少跑 1 公里"
              value={draftRules}
              onChange={(e) => setDraftRules(e.target.value)}
            />
          </label>
          <div className="challenge__settings-actions">
            <button className="is-primary" onClick={() => void saveConfig()} disabled={busy}>
              保存
            </button>
            <button onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      )}

      <div className="challenge__compose">
        <input
          value={note}
          placeholder="今天练了什么？（可留空）"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void checkInText();
          }}
        />
        <button className="is-ghost" onClick={() => void checkInWithPhotos()} disabled={busy}>
          导入照片…
        </button>
        <button onClick={() => void checkInText()} disabled={busy || !note.trim()}>
          记一笔
        </button>
      </div>

      {error && <p className="challenge__error">{error}</p>}

      {cells.length === 0 ? (
        <p className="challenge__empty">
          还没有打卡。点「导入照片…」选今天的照片——<b>一张照片算一格</b>。
          <br />
          如果这里没显示打卡墙，去场景行的「⋯ → 切换主题…」里绑上「{scene.name}」。
        </p>
      ) : (
        <ul className="wall">
          {cells.map(({ item, iso }) => {
            const src = displayableSrc(item);
            return (
              <li key={item.id} className="wall__cell">
                <button
                  className="wall__btn"
                  title={`${item.name} · ${formatBytes(item.bytes)}`}
                  onClick={() => setPreview(item)}
                >
                  {src ? (
                    <img loading="lazy" src={assetUrl(src)} alt={item.name} />
                  ) : (
                    <span className="wall__fallback">{item.ext.toUpperCase()}</span>
                  )}
                  <time className="wall__date" dateTime={item.takenAt ?? undefined}>
                    {iso ? formatDay(iso) : "日期未知"}
                  </time>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {preview && <MediaLightbox item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
