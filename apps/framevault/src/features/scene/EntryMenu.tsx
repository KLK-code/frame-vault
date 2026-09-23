import { useEffect, useRef } from "react";
import "./EntryMenu.css";

export type EntryMenuItem = {
  label: string;
  /** 危险动作（删除）用红色 */
  danger?: boolean;
  onSelect: () => void;
};

export type EntryMenuState = { x: number; y: number; items: EntryMenuItem[] } | null;

/**
 * 记录的**右键菜单**（桌面右键 / 触摸长按都走它）。
 *
 * 为什么是公共件：删除这类动作不属于某个主题 —— 写作台先接上，普通日记那条时间线
 * 迟早也要用同一个菜单（AGENTS §6：公共件别写第二份）。
 *
 * 位置用 `position: fixed` + 指针坐标：菜单是"贴着鼠标弹"的东西，
 * 不需要跟着某个容器滚动（点一下、选一项就关）。
 */
export default function EntryMenu({
  menu,
  onClose,
}: {
  menu: EntryMenuState;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  // 点外面 / 按 Esc / 滚一下就关掉（与侧栏那些浮层菜单同一套手感）
  useEffect(() => {
    if (!menu) return;
    function onDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onClose, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onClose);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return (
    <div
      className="entry-menu"
      role="menu"
      ref={box}
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {menu.items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={item.danger ? "entry-menu__item is-danger" : "entry-menu__item"}
          onClick={item.onSelect}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
