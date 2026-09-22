import { useEffect, useState } from "react";
import {
  addVault,
  forgetVault,
  listVaults,
  pickFolder,
  switchVault,
  type VaultInfo,
} from "../lib/api";
import "./VaultManagerPage.css";

export default function VaultManagerPage() {
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [status, setStatus] = useState("");

  async function refresh() {
    try {
      setVaults(await listVaults());
    } catch (e) {
      setStatus(`读取列表失败：${e}`);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleImport() {
    const picked = await pickFolder("选择要导入的仓库文件夹");
    if (!picked) return;
    try {
      setVaults(await addVault(picked));
      setStatus(`已导入：${picked}`);
    } catch (e) {
      setStatus(`导入失败：${e}`);
    }
  }

  async function handleSwitch(path: string) {
    try {
      await switchVault(path);
      await refresh();
      setStatus("已切换当前仓库");
    } catch (e) {
      setStatus(`切换失败：${e}`);
    }
  }

  async function handleForget(path: string) {
    try {
      setVaults(await forgetVault(path));
      setStatus("已从列表移除（磁盘上的文件没有动）");
    } catch (e) {
      setStatus(`移除失败：${e}`);
    }
  }

  return (
    <>
      <div className="manager__head">
        <h1>管理仓库</h1>
        <button onClick={handleImport}>导入文件夹…</button>
      </div>

      {vaults.length === 0 ? (
        <p className="manager__empty">
          还没有仓库。点「导入文件夹…」把已有的 Vault 目录加进来。
        </p>
      ) : (
        <ul className="manager__list">
          {vaults.map((v) => (
            <li key={v.path} className={v.active ? "is-active" : ""}>
              <div className="manager__info">
                <strong>
                  {v.name}
                  {v.active ? " · 当前" : ""}
                </strong>
                <span className={v.exists ? "" : "is-missing"}>
                  {v.exists ? v.path : `${v.path}（目录不存在）`}
                </span>
              </div>
              <div className="manager__actions">
                <button disabled={v.active} onClick={() => handleSwitch(v.path)}>
                  切换
                </button>
                <button onClick={() => handleForget(v.path)}>移除</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="manager__status">{status}</p>
    </>
  );
}
