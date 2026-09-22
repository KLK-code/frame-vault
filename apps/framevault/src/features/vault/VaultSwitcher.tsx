import { useEffect, useRef, useState } from "react";
import { listVaults, onVaultChanged, openVaultManager, switchVault, type VaultInfo } from "../../lib/api";
import "./VaultSwitcher.css";

/**
 * 侧栏底部的仓库切换器。
 *
 * 它**只负责切换**——新建 / 添加 / 移除都在独立的管理窗口里（见 VaultManagerPanel）。
 * 理由：菜单是"快速切一下"的地方，放写操作会让误点代价变大，
 * 而且新增仓库需要选目录 + 填名字，悬浮菜单本来就装不下这些交互。
 */
export default function VaultSwitcher() {
  const [open, setOpen] = useState(false);
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [status, setStatus] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const active = vaults.find((v) => v.active) ?? null;

  async function refresh() {
    try {
      setVaults(await listVaults());
      setStatus("");
    } catch (e) {
      setStatus(String(e));
    }
  }

  // 自己挂载时拉一次；管理窗口改了仓库列表（新建/添加/移除）会广播事件，这里跟着刷新
  useEffect(() => {
    void refresh();
    return onVaultChanged(() => {
      void refresh();
    });
  }, []);

  // 点菜单外面 / 按 Esc 关闭
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleSwitch(path: string) {
    try {
      await switchVault(path);
      await refresh();
      setOpen(false);
    } catch (e) {
      setStatus(String(e));
    }
  }

  return (
    <div className="vault-switcher" ref={boxRef}>
      <button
        className="vault-switcher__button"
        onClick={() => setOpen((v) => !v)}
        title={active?.path ?? "还没有选择仓库"}
      >
        <span className="vault-switcher__dot" />
        <span className="vault-switcher__name">{active?.name ?? "未选择仓库"}</span>
        <span className="vault-switcher__caret">▾</span>
      </button>

      {open && (
        <div className="vault-switcher__menu" role="menu">
          {vaults.length === 0 ? (
            <p className="vault-switcher__empty">
              还没有仓库。
              <br />
              打开下面的「管理仓库…」新建或添加。
            </p>
          ) : (
            vaults.map((v) => (
              <button
                key={v.path}
                role="menuitem"
                className={"vault-switcher__item" + (v.active ? " is-active" : "")}
                onClick={() => handleSwitch(v.path)}
                disabled={v.active}
              >
                <span className="vault-switcher__item-name">
                  {v.active ? "✓ " : ""}
                  {v.name}
                </span>
                <span className={"vault-switcher__path" + (v.exists ? "" : " is-missing")}>
                  {v.exists ? v.path : v.path + "（目录不存在）"}
                </span>
              </button>
            ))
          )}

          <div className="vault-switcher__sep" />

          <button
            role="menuitem"
            className="vault-switcher__item"
            onClick={() => {
              setOpen(false);
              openVaultManager();
            }}
          >
            <span className="vault-switcher__item-name">管理仓库…</span>
            <span className="vault-switcher__path">新建 / 添加 / 移除仓库</span>
          </button>

          {status && <p className="vault-switcher__error">{status}</p>}
        </div>
      )}
    </div>
  );
}
