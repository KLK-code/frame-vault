import { useEffect, useMemo, useState } from "react";
import { assetUrl, type MediaItem } from "../../../../lib/api";
import MediaLightbox from "../../MediaLightbox";
import SceneFields from "../../SceneFields";
import SceneNotice from "../../SceneNotice";
import EntryTimeline from "../../EntryTimeline";
import SceneComposer from "../../SceneComposer";
import { displayableSrc, formatBytes, formatDay, localDay } from "../../mediaFormat";
import type { SceneViewProps } from "../../registry";
import { useSceneData } from "../../useSceneData";
import { computeChallenge, relativeDay } from "./challengeStats";
import manifest from "./manifest";
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

  const [view, setView] = useState<"timeline" | "wall">("timeline");
  const [savingConfig, setSavingConfig] = useState(false);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [editing, setEditing] = useState(false);
  /** 设置表单的值：按 manifest.configSchema 的 key 存，主题不关心具体是哪些字段 */
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown>>({});

  const today = localDay(new Date().toISOString()) ?? "";

  // 保存完（或外部改了配置）就把表单拉回最新值；正在编辑时不打扰
  useEffect(() => {
    if (editing) return;
    setDraftConfig({
      targetDays: targetDays > 0 ? targetDays : "",
      rules,
    });
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

  async function saveConfig() {
    const target = Math.round(Number(draftConfig.targetDays));
    const next: ChallengeConfig = {
      ...config,
      targetDays: Number.isFinite(target) && target > 0 ? target : 0,
      rules: String(draftConfig.rules ?? "").trim(),
    };
    setSavingConfig(true);
    try {
      const ok = await onSceneConfigChange(next);
      if (ok) setEditing(false);
    } finally { setSavingConfig(false); }
  }

  const previewEntry = preview?.entryId ? entryById.get(preview.entryId) : undefined;

  return (
    <div className="challenge">
      <SceneComposer data={data} className="challenge__compose" placeholder="记录一次进步…" individualPhotos />
      <section className="challenge__head" aria-label="挑战进度">
        <div className="challenge__ring" role="img" aria-label={targetDays ? `目标完成 ${percent}%` : "尚未设置目标"}>
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle className="challenge__ring-track" cx="50" cy="50" r="42" />
            <circle className="challenge__ring-fill" cx="50" cy="50" r="42" pathLength="100" strokeDasharray={`${percent} 100`} />
          </svg>
          <strong>{targetDays ? `${percent}%` : "—"}</strong>
        </div>
        <div className="challenge__progress">
          <div
            className="challenge__bar"
            role="progressbar"
            aria-label="目标完成进度"
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
            <dt>连续打卡</dt>
            <dd>{stats.streak}<small> 天</small></dd>
          </div>
          <div>
            <dt>最长坚持</dt>
            <dd>{stats.longest}<small> 天</small></dd>
          </div>
        </dl>

        <button className="challenge__setup" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
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
          <SceneFields
            fields={manifest.configSchema ?? []}
            values={draftConfig}
            onChange={(key, value) => setDraftConfig((prev) => ({ ...prev, [key]: value }))}
            idPrefix="challenge-config"
          />
          <div className="challenge__settings-actions">
            <button className="is-primary" onClick={() => void saveConfig()} disabled={savingConfig}>
              保存
            </button>
            <button onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      )}

      <SceneNotice message={data.notice} onUndo={data.undo} onDismiss={data.dismissNotice} />

      {data.error && <p className="challenge__error">{data.error}</p>}

      <div className="challenge__views" role="group" aria-label="记录展示方式">
        <button aria-pressed={view === "timeline"} onClick={() => setView("timeline")}>打卡记录</button>
        <button aria-pressed={view === "wall"} onClick={() => setView("wall")}>照片墙</button>
      </div>

      {view === "timeline" ? (
        <EntryTimeline data={data} sceneId={scene.id} fields={manifest.entryFields ?? []}
          emptyText="每一次开始，都算进步。写下今天完成的小事，或导入一张照片，留下第一次打卡。" />
      ) : cells.length === 0 ? (
        <p className="challenge__empty">
          还没有打卡照片。点上方「照片」选择文件——<b>一张照片一条记录，墙上一格一张</b>。
          纯文字打卡会显示在「打卡记录」里。
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
                  <button
                    className="is-danger"
                    onClick={() => {
                      void data.remove(previewEntry).then((ok) => {
                        if (ok) setPreview(null);
                      });
                    }}
                    disabled={data.busy === previewEntry.id}
                  >
                    删除这条
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
