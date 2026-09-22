import { useEffect, useState } from "react";
import {
  addVault,
  listVaults,
  loadEntry,
  pickFolder,
  saveEntry,
  type Entry,
} from "../lib/api";

export default function VaultPage() {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [status, setStatus] = useState("");

  async function refreshVault() {
    try {
      const list = await listVaults();
      setVaultPath(list.find((v) => v.active)?.path ?? null);
    } catch (e) {
      setStatus(`读取仓库列表失败：${e}`);
    }
  }

  useEffect(() => {
    refreshVault();
  }, []);

  async function handlePickVault() {
    try {
      const picked = await pickFolder("选择一个文件夹作为 Vault");
      if (!picked) return;
      const list = await addVault(picked);
      setVaultPath(list.find((v) => v.active)?.path ?? picked);
      setStatus("仓库已设置 ✅");
    } catch (e) {
      setStatus(`出错：${e}`);
    }
  }

  async function handleSave() {
    try {
      const id = `entry-${Date.now()}`;
      const path = await saveEntry(id, "我的第一条记录", new Date().toISOString());
      setLastId(id);
      setStatus(`已写入：${path}`);
    } catch (e) {
      setStatus(`出错：${e}`);
    }
  }

  async function handleLoad() {
    if (!lastId) return;
    try {
      setEntry(await loadEntry(lastId));
      setStatus("读取成功");
    } catch (e) {
      setStatus(`出错：${e}`);
    }
  }

  return (
    <>
      <h1>仓库</h1>
      <p>当前仓库：{vaultPath ?? "（未选择）"}</p>

      <div className="row">
        <button onClick={handlePickVault}>选择仓库文件夹</button>
        <button onClick={handleSave} disabled={!vaultPath}>
          保存一条记录
        </button>
        <button onClick={handleLoad} disabled={!lastId}>
          读取刚才那条
        </button>
      </div>

      <p>{status}</p>

      {entry && <pre>{JSON.stringify(entry, null, 2)}</pre>}
    </>
  );
}
