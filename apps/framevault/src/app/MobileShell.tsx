import { useEffect, useRef, useState } from "react";
import SceneHost from "../features/scene/SceneHost";
import SceneMedia from "../features/scene/SceneMedia";
import SceneIcon from "../features/scene/SceneIcon";
import SceneTree from "../features/scene/SceneTree";
import type { SceneShellProps } from "../features/scene/useFolders";
import SettingsPanel from "../features/settings/SettingsPanel";
import { confirm } from "../lib/api";
import { isMobileOS } from "../lib/platform";
import TitleBar from "./TitleBar";
import "./MobileShell.css";

type Tab = "record" | "photos" | "folders";

const TABS: { id: Tab; label: string }[] = [
  { id: "record", label: "记录" },
  { id: "photos", label: "照片" },
  // 「文件夹」= 场景列表本身（桌面端那是左侧一栏）。仓库管理不在这儿 —— 它在设置里
  { id: "folders", label: "文件夹" },
];

/**
 * 手机骨架：顶部场景切换 + 主体 + 底部标签栏。
 *
 * 和桌面骨架**共用同一份能力与数据**（`SceneShellProps` 由 App 传进来，
 * 里面就是 useFolders / useActiveFolder 的那份状态），区别只有编排。
 * 这里只留"用完就扔"的视图状态：当前标签、横滑停在哪一页。
 *
 * 三件移动端特有的事在这里解决：
 * 1. 独立窗口开不出来 → 「设置」做成内嵌页面（**仓库管理也住在设置里**）；
 * 2. 拇指可达 → 主要切换放在底部，场景切换放在顶部（点一下跳到底部那一栏）；
 * 3. **设置页住在"记录"左边**（2026-09 用户拍板）：在记录界面向右滑就露出来，
 *    所以底部标签栏里没有「设置」——它是横滑出来的那一页。
 *    顶栏右侧仍留一个齿轮：纯手势没人找得到入口。
 */
export default function MobileShell({ tree, selected, scene }: SceneShellProps) {
  const {
    folders,
    scenes,
    topics,
    groups,
    topicGroups,
    error,
    create,
    rename,
    remove,
    togglePinned,
    reorder,
    bindScene,
    createTopic,
    renameTopic,
    deleteTopic,
  } = tree;
  const { activeId, setActiveId, active } = selected;
  const [tab, setTab] = useState<Tab>("record");
  /** 横滑容器里当前是不是"设置"那一页（只用于无障碍与高亮，真相在滚动位置上） */
  const [onSettings, setOnSettings] = useState(false);
  const pager = useRef<HTMLDivElement | null>(null);

  /** 滚到某一页：0 = 设置（左边那页），1 = 记录 / 照片 / 文件夹 */
  function goToPage(index: 0 | 1) {
    const el = pager.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  }

  // 初始停在右边那页（记录）：设置页在左边，不能一进来就露出来
  useEffect(() => {
    const el = pager.current;
    if (el) el.scrollLeft = el.clientWidth;
  }, []);

  // 转屏 / 改窗口大小：页宽变了，按当前页重新对齐，免得停在两页之间
  useEffect(() => {
    function onResize() {
      const el = pager.current;
      if (!el) return;
      el.scrollLeft = (onSettings ? 0 : 1) * el.clientWidth;
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [onSettings]);

  /** 滑过一半就算换了页（浏览器只会给 scroll 事件，页是它自己吸附的） */
  function onPagerScroll() {
    const el = pager.current;
    if (!el || el.clientWidth === 0) return;
    const next = el.scrollLeft < el.clientWidth / 2;
    setOnSettings((prev) => (prev === next ? prev : next));
  }

  function pickTab(id: Tab) {
    setTab(id);
    goToPage(1);
  }

  async function handleDelete(folder: { id: string; name: string }) {
    const ok = await confirm(
      "删除文件夹「" + folder.name + "」？\n里面的记录不会被删除，但会失去归属。",
      "删除文件夹",
    );
    if (!ok) return false;
    return remove(folder.id);
  }

  return (
    <div className="app-root">
      {/*
        桌面窗口必须保留自绘标题栏：Windows 上窗口是 decorations: false，
        它是**唯一**能拖动 / 最小化 / 关闭的地方。去掉就变成"窗口卡死在那儿"。
        只有真正的移动端（系统自己管窗口）才不渲染它。
      */}
      {!isMobileOS && <TitleBar title="FrameVault" />}

      <div className="mobile">
        <header className="mobile__bar">
          {/* 点场景名 = 跳到底部的「文件夹」那一栏（以前是开弹层） */}
          <button className="mobile__scene" onClick={() => pickTab("folders")}>
            <span className="mobile__scene-name">{active?.name ?? "选择文件夹"}</span>
            {scene && <span className="mobile__scene-theme">{scene.name}</span>}
            <span className="mobile__caret">▾</span>
          </button>
          <button
            className="mobile__gear"
            onClick={() => goToPage(0)}
            aria-label="设置"
            title="设置（也可以向右滑）"
          >
            <SceneIcon name="settings" size={18} />
          </button>
        </header>

        {/* 横滑两页：左 = 设置，右 = 记录 / 照片 / 文件夹。
            "在记录上向右滑 → 设置"就是这一层，手势交给浏览器的 scroll-snap（见 CSS）。 */}
        <div className="mobile__pager" ref={pager} onScroll={onPagerScroll}>
          <section className="mobile__page" aria-hidden={!onSettings}>
            <div className="mobile__page-head">
              <span className="mobile__page-title">设置</span>
              <button className="mobile__page-back" onClick={() => goToPage(1)}>
                返回记录
              </button>
            </div>
            <div className="mobile__settings">
              <SettingsPanel />
            </div>
          </section>

          <section className="mobile__page" aria-hidden={onSettings}>
            <main className="mobile__body">
              {!active && tab !== "folders" ? (
                <p className="mobile__hint">
                  还没有场景。到「文件夹」那一栏，点右上角 ＋ 新建一个。
                </p>
              ) : tab === "record" ? (
                <SceneHost
                  folder={active!}
                  scene={scene}
                  onSceneConfigChange={(config) => bindScene(active!.id, active!.scene, config)}
                />
              ) : tab === "photos" ? (
                <SceneMedia folder={active!} />
              ) : (
                <SceneTree
                  folders={folders}
                  groups={groups}
                  topicGroups={topicGroups}
                  topics={topics}
                  scenes={scenes}
                  activeId={activeId}
                  onSelect={(id) => {
                    setActiveId(id);
                    // 选完就回记录那一栏 —— 跟以前弹层"选完就关"是同一个动作
                    pickTab("record");
                  }}
                  onCreate={create}
                  onRename={rename}
                  onDelete={handleDelete}
                  onTogglePinned={(folder) => togglePinned(folder.id, !folder.pinned)}
                  onReorder={reorder}
                  onBindScene={bindScene}
                  onCreateTopic={(name) => createTopic(name)}
                  onRenameTopic={(topic, next) => renameTopic(topic, next)}
                  onDeleteTopic={(topic) => deleteTopic(topic)}
                />
              )}

              {error && <p className="mobile__error">{error}</p>}
            </main>
          </section>
        </div>

        <nav className="mobile__tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              className={"mobile__tab" + (tab === item.id && !onSettings ? " is-active" : "")}
              onClick={() => pickTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
