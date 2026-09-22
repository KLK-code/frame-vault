import { useState } from "react";

export type Item = {
  /** 将来的接口名，先用它做占位反馈 */
  id: string;
  label: string;
  /** 一句话说明（Obsidian 的设置项都有，很影响"正经感"） */
  desc?: string;
  /** 右侧按钮文字，默认「打开」 */
  action?: string;
  /** 计划在哪个里程碑实现 */
  hint?: string;
};

/** 一组还没实现的设置项：现在只负责"看起来像设置项 + 点一下有反馈" */
export default function PlaceholderSection({ items }: { items: Item[] }) {
  const [status, setStatus] = useState("");

  return (
    <>
      <div className="settings__card">
        {items.map((item) => (
          <div className="settings__row" key={item.id}>
            <div className="settings__text">
              <span className="settings__label">
                {item.label}
                {item.hint && <span className="settings__badge">{item.hint}</span>}
              </span>
              {item.desc && <span className="settings__desc">{item.desc}</span>}
            </div>

            <button
              className="settings__action"
              onClick={() => setStatus(`「${item.label}」还没实现（接口占位：${item.id}）`)}
            >
              {item.action ?? "打开"}
            </button>
          </div>
        ))}
      </div>

      {status && <p className="settings__status">{status}</p>}
    </>
  );
}
