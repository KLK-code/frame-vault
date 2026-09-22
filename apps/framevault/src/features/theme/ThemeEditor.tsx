import { useState } from "react";
import { TOKEN_GROUPS } from "./tokenSchema";
import { useColorScheme, useThemeOverrides, type ColorScheme } from "./useThemeOverrides";
import "./ThemeEditor.css";

/** 尽量把任意颜色写法转成 #rrggbb，给 <input type="color"> 用 */
function toHex(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  const m = v.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) {
    const hex = (n: string) => Number(n).toString(16).padStart(2, "0");
    return "#" + hex(m[1]) + hex(m[2]) + hex(m[3]);
  }
  return "#000000";
}

export default function ThemeEditor() {
  const { overrides, set, reset, resetOne, exportCss } = useThemeOverrides();
  const { scheme, setScheme } = useColorScheme();
  const [status, setStatus] = useState("");

  /** 当前生效值：有覆盖用覆盖，没有就读 tokens 算出来的值 */
  function current(key: string): string {
    if (overrides[key]) return overrides[key];
    return getComputedStyle(document.documentElement).getPropertyValue(key).trim();
  }

  function currentPx(key: string, fallback: number): number {
    const n = Number.parseFloat(current(key));
    return Number.isFinite(n) ? n : fallback;
  }

  async function copyCss() {
    try {
      await navigator.clipboard.writeText(exportCss());
      setStatus("已复制到剪贴板，可以直接粘进 tokens.css");
    } catch {
      setStatus("复制失败：可在控制台执行 copy(document.documentElement.style.cssText)");
    }
  }

  return (
    <div className="theme-editor">
      <h3 className="settings__group-title">配色模式</h3>
      <div className="settings__card">
        <div className="settings__row">
          <div className="settings__text">
            <span className="settings__label">配色模式</span>
            <span className="settings__desc">深色主题是覆盖同一批变量，组件不用改</span>
          </div>
          <div className="theme-editor__control">
            <select
              className="theme-editor__select"
              value={scheme}
              onChange={(e) => setScheme(e.target.value as ColorScheme)}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </div>
        </div>
      </div>

      {TOKEN_GROUPS.map((group) => (
        <div key={group.title}>
          <h3 className="settings__group-title">{group.title}</h3>

          <div className="settings__card">
            {group.tokens.map((token) => {
              const changed = token.key in overrides;
              return (
                <div className="settings__row" key={token.key}>
                  <div className="settings__text">
                    <span className="settings__label" title={token.key}>
                      {token.label}
                      {changed && <em className="theme-editor__dot" title="已修改" />}
                    </span>
                    {token.desc && <span className="settings__desc">{token.desc}</span>}
                  </div>

                  <div className="theme-editor__control">
                    {token.kind === "color" ? (
                      <input
                        className="theme-editor__color"
                        type="color"
                        value={toHex(current(token.key))}
                        onChange={(e) => set(token.key, e.target.value)}
                      />
                    ) : (
                      <>
                        <input
                          className="theme-editor__range"
                          type="range"
                          min={token.min}
                          max={token.max}
                          step={token.step}
                          value={currentPx(token.key, token.min ?? 0)}
                          onChange={(e) => set(token.key, e.target.value + "px")}
                        />
                        <span className="theme-editor__value">
                          {currentPx(token.key, token.min ?? 0)}px
                        </span>
                      </>
                    )}

                    <button
                      className="theme-editor__reset"
                      disabled={!changed}
                      title="还原这一项"
                      onClick={() => resetOne(token.key)}
                    >
                      ↺
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="theme-editor__actions">
        <button className="settings__action" onClick={copyCss}>
          复制当前覆盖为 CSS
        </button>
        <button
          className="settings__action"
          onClick={reset}
          disabled={Object.keys(overrides).length === 0}
        >
          全部重置
        </button>
      </div>

      {status && <p className="settings__status">{status}</p>}
    </div>
  );
}
