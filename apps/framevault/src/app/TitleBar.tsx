import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./TitleBar.css";

/* 画法约定：viewBox 10×10、描边 1.4，且**描边必须完整落在画布内**。
   之前正方形画在 x=0.5 处，1.4 的描边有一半超出了画布被裁掉，
   结果四边看起来粗细不一。现在统一按 0.7 起、跨度 8.6 来画：
   0.7 ± 0.7 = 0 到 1.4，9.3 ± 0.7 = 8.6 到 10 —— 四边各 1.4，且都不越界。 */
const STROKE = 1.4;

function IconMinimize() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 5h8" stroke="currentColor" strokeWidth={STROKE} />
    </svg>
  );
}

function IconMaximize() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect
        x="0.7"
        y="0.7"
        width="8.6"
        height="8.6"
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
      />
    </svg>
  );
}

function IconRestore() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      {/* 后面那个方块只画上边和右边，避免和前面的方块叠线 */}
      <path d="M2.1 1.8H9.3V8.6" fill="none" stroke="currentColor" strokeWidth={STROKE} />
      <rect
        x="0.7"
        y="2.5"
        width="6.6"
        height="6.6"
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
      />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0.7 0.7l8.6 8.6M9.3 0.7L0.7 9.3" stroke="currentColor" strokeWidth={STROKE} />
    </svg>
  );
}

/**
 * 自绘标题栏：因为窗口设了 decorations: false，系统标题栏没有了。
 * 拖动靠 data-tauri-drag-region（需要 core:window:allow-start-dragging 权限）。
 */
export default function TitleBar({ title }: { title: string }) {
  const win = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const sync = () => {
      win.isMaximized().then(setMaximized).catch(() => {});
    };
    sync();
    win
      .onResized(sync)
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [win]);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar__title" data-tauri-drag-region>
        {title}
      </span>

      <div className="titlebar__actions">
        <button className="titlebar__btn" title="最小化" onClick={() => win.minimize()}>
          <IconMinimize />
        </button>
        <button
          className="titlebar__btn"
          title={maximized ? "向下还原" : "最大化"}
          onClick={() => win.toggleMaximize()}
        >
          {maximized ? <IconRestore /> : <IconMaximize />}
        </button>
        <button
          className="titlebar__btn titlebar__btn--close"
          title="关闭"
          onClick={() => win.close()}
        >
          <IconClose />
        </button>
      </div>
    </header>
  );
}
