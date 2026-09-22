import { useEffect, useRef, useState } from "react";
import TitleBar from "./app/TitleBar";
import SceneHost from "./features/scene/SceneHost";
import SceneTree from "./features/scene/SceneTree";
import { useFolders } from "./features/scene/useFolders";
import VaultSwitcher from "./features/vault/VaultSwitcher";
import { confirm, openSettings } from "./lib/api";
import "./App.css";

function IconSettings() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4.5h12M2 11.5h12" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6" cy="4.5" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10.5" cy="11.5" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;
const WIDTH_KEY = "fv.sidebarWidth";

function readWidth(): number {
  const saved = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(saved) && saved >= MIN_WIDTH ? saved : DEFAULT_WIDTH;
}

/**
 * 主窗口 = 左（场景树）+ 右（场景舞台）。
 *
 * 中间那条可拖动的分隔条只影响显示（宽度记在 localStorage），不是数据。
 */
function App() {
  const { folders, scenes, groups, error, create, rename, remove, togglePinned, bindScene } =
    useFolders();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(readWidth);
  const dragging = useRef(false);
  const widthRef = useRef(sidebarWidth);

  // 选中的场景没了（被删/仓库换了）就自动落到第一个
  useEffect(() => {
    if (folders.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (!folders.some((folder) => folder.id === activeId)) {
      setActiveId(folders[0].id);
    }
  }, [folders, activeId]);

  const active = folders.find((folder) => folder.id === activeId) ?? null;
  const activeScene = active ? (scenes.find((s) => s.id === active.effectiveScene) ?? null) : null;

  function applyWidth(next: number, persist = false) {
    const clamped = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
    widthRef.current = clamped;
    setSidebarWidth(clamped);
    if (persist) localStorage.setItem(WIDTH_KEY, String(clamped));
  }

  // 拖动分隔条改宽度：用 Pointer 事件，鼠标和触摸都能用
  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (dragging.current) applyWidth(e.clientX);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // 松手才写盘，避免每一帧都写 localStorage
      localStorage.setItem(WIDTH_KEY, String(widthRef.current));
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  async function handleDelete(folder: { id: string; name: string }) {
    const ok = await confirm(
      `删除场景「${folder.name}」？\n里面的记录不会被删除，但会失去归属。`,
      "删除场景",
    );
    if (!ok) return false;
    return remove(folder.id);
  }

  return (
    <div className="app-root">
      <TitleBar title="FrameVault" />

      <main className="app">
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <SceneTree
            groups={groups}
            scenes={scenes}
            activeId={activeId}
            onSelect={setActiveId}
            onCreate={create}
            onRename={rename}
            onDelete={handleDelete}
            onTogglePinned={(folder) => togglePinned(folder.id, !folder.pinned)}
            onBindScene={bindScene}
          />

          {error && <p className="sidebar__error">{error}</p>}

          <div className="sidebar__footer">
            <VaultSwitcher />
            <button className="sidebar__icon" title="设置" onClick={() => openSettings()}>
              <IconSettings />
            </button>
          </div>
        </aside>

        <div
          className="app__divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整侧栏宽度，双击复位"
          aria-valuenow={sidebarWidth}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          tabIndex={0}
          onPointerDown={startDrag}
          onDoubleClick={() => applyWidth(DEFAULT_WIDTH, true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              applyWidth(widthRef.current - 16, true);
            }
            if (e.key === "ArrowRight") {
              e.preventDefault();
              applyWidth(widthRef.current + 16, true);
            }
          }}
        />

        <section className="content">
          <SceneHost
            folder={active}
            scene={activeScene}
            onSceneConfigChange={(config) =>
              active ? bindScene(active.id, active.scene, config) : Promise.resolve(false)
            }
          />
        </section>
      </main>
    </div>
  );
}

export default App;
