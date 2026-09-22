import { useEffect, useMemo, useState } from "react";
import { assetUrl, type MediaItem } from "../../../../lib/api";
import MediaLightbox from "../../MediaLightbox";
import { displayableSrc, formatBytes, formatDay, localDay } from "../../mediaFormat";
import type { SceneViewProps } from "../../registry";
import { useSceneData } from "../../useSceneData";
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
 * 与普通记录的区别**只在编排**：打卡时一张照片建一条记录（所以一格 = 一张照片），
 * 墙按拍摄日倒序铺。文字编辑、追加照片这些能力来自 `useSceneData`，
 * 和普通记录是同一套——挑战只是把它们摆在"点开照片之后"。
 */
export default function ChallengeScene({ folder, scene, onSceneConfigChange }: SceneViewProps) {
  const data = useSceneData(folder);

  const config = (folder.sceneConfig ?? {}) as ChallengeConfig;
  const targetDays =
    typeof config.targetDays === "number" && config.targetDays > 0 ? Math.round(config.targetDays) : 0;
  const rules = typeof config.rules === "string" ? config.rules : "";

  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftTarget, setDraftTarget] = useState(targetDays > 0 ? String(targetDays) : "");
  const [draftRules, setDraftRules] = useState(rules);

  const today = localDay(new Date().toISOString()) ?? "";

  // 保存完（或外部改了配置）就把表单拉回最新值；正在编辑时不打扰
  useEffect(() => {
    if (editing) return;
    setDraftTarget(targetDays > 0 ? String(targetDays) : "");
    setDraftRules(rules);
  }, [editing, targetDays, rules]);

  const entryById = useMemo(
    () => new Map(data.entries.map((entry) => [entry.id, entry])),
    [data.entries],
  );

  /** 一格一张照片；日期优先用拍摄时间，没有就退回记录时间 */
  const cells = useMemo(() => {
    return data.media
      .map((item) => ({
        item,
        iso: item.takenAt ?? entryById.get(item.entryId as string)?.createdAt ?? "",
      }))
      .sort((a, b) => b.iso.localeCompare(a.iso));
  }, [data.media, entryById]);

  const stats = useMemo(() => {
    const days = new Set<string>();
    for (const entry of data.entries) {
      const day = localDay(data.dateOf(entry));
      if (day) days.add(day);
    }
    return computeChallenge(days, today);
  }, [data.entries, data.dateOf, today]);

  const percent = targetDays > 0 ? Math.min(100, Math.round((stats.checked / targetDays) * 100)) : 0;

  function openItem(item: MediaItem) {
    setPreview(item);
    setDraftNote(item.entryId ? (entryById.get(item.entryId)?.title ?? "") : "");
  }

  /** 打卡主路径：选一批照片，**一张照片建一条记录**（所以一格就是一格） */
  async function checkInWithPhotos() {
    const files = await data.pickPhotos();
    if (files.length === 0) return;

    const text = note.trim();
    for (const file of files) {
      const entry = await data.create(text);
      if (!entry) break;
      await data.importPhotos(entry.id, [file]);
    }
    setNote("");
  }

  /** 没有照片也能打卡（比如今天只是拉伸了一下） */
  async function checkInText() {
    const text = note.trim();
    if (!text) return;
    const entry = await data.create(text);
    if (entry) setNote("");
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

  const previewEntry = preview?.entryId ? entryById.get(preview.entryId) : undefined;

  return (
    <div className="challenge">
      <section className="challenge__head">
        <div className="challenge__progress">
          <div
            className="challenge__bar"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
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
            <button className="is-primary" onClick={() => void saveConfig()} disabled={data.busy === "new"}>
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
        <button
          className="is-ghost"
          onClick={() => void checkInWithPhotos()}
          disabled={data.busy === "new"}
        >
          导入照片…
        </button>
        <button onClick={() => void checkInText()} disabled={data.busy === "new" || !note.trim()}>
          记一笔
        </button>
      </div>

      {data.error && <p className="challenge__error">{data.error}</p>}

      {cells.length === 0 ? (
        <p className="challenge__empty">
          还没有打卡。点「导入照片…」选今天的照片——<b>一张照片一条记录，墙上一格一张</b>。
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
                  onClick={() => openItem(item)}
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

      {preview && (
        <MediaLightbox
          item={preview}
          onClose={() => setPreview(null)}
          footer={
            previewEntry ? (
              <div className="challenge__note">
                <input
                  value={draftNote}
                  placeholder="这条的说明…（比如 1000m / 5 分钟）"
                  onChange={(e) => setDraftNote(e.target.value)}
                />
                <div className="challenge__note-actions">
                  <button
                    className="is-primary"
                    onClick={() => void data.edit(previewEntry, { title: draftNote.trim() })}
                    disabled={data.busy === previewEntry.id}
                  >
                    保存说明
                  </button>
                  <button
                    onClick={() => void data.attachPhotos(previewEntry.id)}
                    disabled={data.busy === previewEntry.id}
                  >
                    {data.busy === previewEntry.id ? "导入中…" : "＋ 加照片到这条"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="challenge__note-hint">这张照片没有挂到任何记录上。</p>
            )
          }
        />
      )}
    </div>
  );
}
