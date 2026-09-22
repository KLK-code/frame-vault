import { useState } from "react";

export type Item = {
  /** 将来的接口名，先用它做占位反馈 */
  id: string;
  label: string;
  /** 计划在哪个里程碑实现 */
  hint?: string;
};

/** 一组还没实现的设置项：现在只负责"看起来像设置项 + 点一下有反馈" */
export default function PlaceholderSection({ items }: { items: Item[] }) {
  const [status, setStatus] = useState("");

  return (
    <>
      <div className="settings__rows">
        {items.map((item) => (
          <button
            key={item.id}
            className="settings__row"
            onClick={() => setStatus(`「${item.label}」还没实现（接口占位：${item.id}）`)}
          >
            <span className="settings__label">{item.label}</span>
            {item.hint && <span className="settings__badge">{item.hint}</span>}
          </button>
        ))}
      </div>

      {status && <p className="settings__status">{status}</p>}
    </>
  );
}
