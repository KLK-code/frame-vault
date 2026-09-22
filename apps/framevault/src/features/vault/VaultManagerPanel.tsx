import { useEffect, useState } from "react";
import {
  addVault,
  createVault,
  forgetVault,
  listVaults,
  onVaultChanged,
  pickFolder,
  switchVault,
  type VaultInfo,
} from "../../lib/api";
import "./VaultManagerPanel.css";

/**
 * 独立「管理仓库」窗口里的面板。
 *
 * **所有会改变仓库集合的操作都在这里**（新建 / 添加 / 移除），
 * 侧栏的切换菜单只管切换——一处写操作，一处切换，互不重叠。
 */
export default function VaultManagerPanel() {
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
    void refresh();
    // 另一个窗口（或本窗口）改了仓库集合时同步一下
    return onVaultChanged(() => {
      void refresh();
    });
  }, []);

  /** 新建：在选中的文件夹里写 vault.json（名字留空 = 用目录名） */
  async function handleCreate() {
    const picked = await pickFolder("选择一个文件夹，在里面创建新 Vault");
    if (!picked) return;
    try {
      setVaults(await createVault(picked));
      setStatus(`已新建并切换到：${picked}`);
    } catch (e) {
      setStatus(`新建失败：${e}`);
    }
  }

  /** 添加：只接受已经带 vault.json 的目录 */
  async function handleImport() {
    const picked = await pickFolder("选择已经带 vault.json 的仓库目录");
    if (!picked) return;
    try {
      setVaults(await addVault(picked));
      setStatus(`已添加并切换到：${picked}`);
    } catch (e) {
      setStatus(`添加失败：${e}`);
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
        <div className="manager__head-actions">
          <button
            className="is-primary"
            onClick={handleCreate}
            title="在一个文件夹里创建 vault.json"
          >
            新建仓库…
          </button>
          <button onClick={handleImport} title="必须是已经带 vault.json 的目录">
            添加已有仓库…
          </button>
        </div>
      </div>

      <p className="manager__hint">
        新建会在你选的文件夹里写一个 vault.json；添加要求那个目录里已经有 vault.json。
      </p>

      {vaults.length === 0 ? (
        <p className="manager__empty">
          还没有仓库。用上面的「新建仓库…」建一个，或用「添加已有仓库…」导入一个。
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
