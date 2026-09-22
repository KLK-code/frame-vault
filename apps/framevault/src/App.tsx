import { useEffect, useRef, useState } from "react";
import VaultSwitcher from "./features/vault/VaultSwitcher";
import { PAGES } from "./lib/pages";
import "./App.css";

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;
const WIDTH_KEY = "fv.sidebarWidth";

function readWidth(): number {
  const saved = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(saved) && saved >= MIN_WIDTH ? saved : DEFAULT_WIDTH;
}

function App() {
  const [activeId, setActiveId] = useState(PAGES[0].id);
  const [sidebarWidth, setSidebarWidth] = useState(readWidth);
  const dragging = useRef(false);
  const widthRef = useRef(sidebarWidth);

  const active = PAGES.find((p) => p.id === activeId) ?? PAGES[0];
  const ActivePage = active.Page;

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

  return (
    <main className="app">
      <aside className="sidebar" style={{ width: sidebarWidth }}>
        <h2>FrameVault</h2>

        <nav>
          {PAGES.map(({ id, label }) => (
            <button
              key={id}
              className={id === activeId ? "active" : ""}
              onClick={() => setActiveId(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <VaultSwitcher />
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
        <ActivePage />
      </section>
    </main>
  );
}

export default App;
