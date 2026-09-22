import { useEffect, useRef, useState } from "react";
import {
  addVault,
  createVault,
  listVaults,
  openVaultManager,
  pickFolder,
  switchVault,
  type VaultInfo,
} from "../../lib/api";
import "./VaultSwitcher.css";

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

  useEffect(() => {
    refresh();
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

  async function handleCreate() {
    const picked = await pickFolder("选择一个文件夹作为新 Vault");
    if (!picked) return;
    try {
      // 名字留空：让 Rust 从目录名推导（路径解析归 Rust）
      setVaults(await createVault(picked));
      setOpen(false);
      setStatus("已创建仓库 ✅");
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function handleAdd() {
    const picked = await pickFolder("选择一个文件夹作为 Vault");
    if (!picked) return;
    try {
      await addVault(picked);
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
            <p className="vault-switcher__empty">还没有仓库</p>
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

          <button role="menuitem" className="vault-switcher__item" onClick={handleCreate}>
            <span className="vault-switcher__item-name">新建仓库…</span>
            <span className="vault-switcher__path">在一个文件夹里创建 vault.json</span>
          </button>

          <button role="menuitem" className="vault-switcher__item" onClick={handleAdd}>
            <span className="vault-switcher__item-name">添加已有仓库…</span>
            <span className="vault-switcher__path">必须是已经带 vault.json 的目录</span>
          </button>

          <button
            role="menuitem"
            className="vault-switcher__item"
            onClick={() => {
              setOpen(false);
              openVaultManager();
            }}
          >
            <span className="vault-switcher__item-name">管理仓库…</span>
          </button>

          {status && <p className="vault-switcher__error">{status}</p>}
        </div>
      )}
    </div>
  );
}
