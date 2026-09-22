import { useEffect, useState } from "react";
import SceneHost from "../features/scene/SceneHost";
import SceneMedia from "../features/scene/SceneMedia";
import SceneTree from "../features/scene/SceneTree";
import { useActiveFolder, useFolders } from "../features/scene/useFolders";
import SettingsPanel from "../features/settings/SettingsPanel";
import VaultManagerPanel from "../features/vault/VaultManagerPanel";
import { confirm, listVaults } from "../lib/api";
import { isMobileOS } from "../lib/platform";
import TitleBar from "./TitleBar";
import "./MobileShell.css";

type Tab = "record" | "photos" | "settings";
type Sheet = null | "scenes" | "vault";

const TABS: { id: Tab; label: string }[] = [
  { id: "record", label: "记录" },
  { id: "photos", label: "照片" },
  { id: "settings", label: "设置" },
];

/** 场景列表弹层顶部的"当前仓库"入口 —— 移动端开不出第二个窗口，所以仓库管理内嵌 */
function VaultEntry({ onClick }: { onClick: () => void }) {
  const [name, setName] = useState("仓库");

  useEffect(() => {
    void listVaults()
      .then((list) => {
        const current = list.find((vault) => vault.active);
        if (current) setName(current.name);
      })
      .catch(() => undefined);
  }, []);

  return (
    <button className="mobile__vault" onClick={onClick}>
      <span className="mobile__vault-dot" />
      <span className="mobile__vault-name">{name}</span>
      <span className="mobile__caret">›</span>
    </button>
  );
}

/**
 * 手机骨架：顶部场景切换 + 主题渲染区 + 底部标签栏。
 *
 * 和桌面骨架**共用同一份能力与数据**（useFolders / useSceneData / SceneHost …），
 * 区别只有编排。两件移动端特有的事在这里解决：
 * 1. 独立窗口开不出来 → 「仓库管理」「设置」都做成内嵌页面；
 * 2. 拇指可达 → 主要切换放在底部，场景切换放在顶部（点开才是整屏列表）。
 */
export default function MobileShell() {
  const { folders, scenes, groups, error, create, rename, remove, togglePinned, bindScene } =
    useFolders();
  const { activeId, setActiveId, active } = useActiveFolder(folders);
  const [tab, setTab] = useState<Tab>("record");
  const [sheet, setSheet] = useState<Sheet>(null);

  const activeScene = active ? (scenes.find((s) => s.id === active.effectiveScene) ?? null) : null;

  async function handleDelete(folder: { id: string; name: string }) {
    const ok = await confirm(
      "删除场景「" + folder.name + "」？\n里面的记录不会被删除，但会失去归属。",
      "删除场景",
    );
    if (!ok) return false;
    return remove(folder.id);
  }

  return (
    <div className="app-root" data-scene={active?.effectiveScene}>
      {/*
        桌面窗口必须保留自绘标题栏：Windows 上窗口是 decorations: false，
        它是**唯一**能拖动 / 最小化 / 关闭的地方。去掉就变成"窗口卡死在那儿"。
        只有真正的移动端（系统自己管窗口）才不渲染它。
      */}
      {!isMobileOS && <TitleBar title="FrameVault" />}

      <div className="mobile">
        <header className="mobile__bar">
        <button className="mobile__scene" onClick={() => setSheet("scenes")}>
          <span className="mobile__scene-name">{active?.name ?? "选择场景"}</span>
          {activeScene && <span className="mobile__scene-theme">{activeScene.name}</span>}
          <span className="mobile__caret">▾</span>
        </button>
      </header>

      <main className={"mobile__body" + (tab === "settings" ? " is-fill" : "")}>
        {!active ? (
          <p className="mobile__hint">
            还没有场景。点上面的场景名，再点右上角 ＋ 新建一个。
          </p>
        ) : tab === "record" ? (
          <SceneHost
            folder={active}
            scene={activeScene}
            onSceneConfigChange={(config) => bindScene(active.id, active.scene, config)}
          />
        ) : tab === "photos" ? (
          <SceneMedia folder={active} />
        ) : (
          <div className="mobile__settings">
            <SettingsPanel />
          </div>
        )}

        {error && <p className="mobile__error">{error}</p>}
      </main>

      <nav className="mobile__tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={"mobile__tab" + (tab === item.id ? " is-active" : "")}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {sheet === "scenes" && (
        <div className="mobile__sheet" role="dialog" aria-modal="true">
          <div className="mobile__sheet-head">
            <span className="mobile__sheet-title">场景</span>
            <button className="mobile__sheet-done" onClick={() => setSheet(null)}>
              完成
            </button>
          </div>

          <VaultEntry onClick={() => setSheet("vault")} />

          <div className="mobile__sheet-body">
            <SceneTree
              groups={groups}
              scenes={scenes}
              activeId={activeId}
              onSelect={(id) => {
                setActiveId(id);
                setSheet(null);
              }}
              onCreate={create}
              onRename={rename}
              onDelete={handleDelete}
              onTogglePinned={(folder) => togglePinned(folder.id, !folder.pinned)}
              onBindScene={bindScene}
            />
          </div>
        </div>
      )}

      {sheet === "vault" && (
        <div className="mobile__sheet" role="dialog" aria-modal="true">
          <div className="mobile__sheet-head">
            <span className="mobile__sheet-title">仓库</span>
            <button className="mobile__sheet-done" onClick={() => setSheet(null)}>
              完成
            </button>
          </div>
          <div className="mobile__sheet-body is-padded">
            <VaultManagerPanel />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
