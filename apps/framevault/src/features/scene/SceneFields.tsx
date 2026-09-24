import { Suspense, lazy } from "react";
import { fieldText, type FieldDecl } from "./manifest";
import "./SceneFields.css";

// 唯一那个 Markdown 控件（CodeMirror 6 + livePreview）比较重，按需加载 ——
// 表单本身（文本 / 数字 / 日期 / 勾选）不该陪着它一起进首屏（AGENTS §9）。
const MarkdownWysiwyg = lazy(() => import("./markdown/MarkdownWysiwyg"));

type Props = {
  fields: FieldDecl[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** 同一页可能有多个表单，用前缀避免 id 撞车 */
  idPrefix: string;
  /** 这个表单里第一个多行字段要不要自动获得焦点（时间线"点一下就改"用） */
  focusRich?: boolean;
};

/**
 * 把主题的**声明**渲染成表单。核心提供，主题只管"把哪个声明放在哪里"。
 *
 * 这就是"特殊功能怎么对外给接口"的答案：主题写两行声明，
 * 不用自己写 input、label、单位、校验提示。
 *
 * 多行字段（`type: "textarea"`）**一律**是 CodeMirror 6 的所见即所得编辑器 ——
 * 全项目只有这一个 Markdown 控件（读态、编辑态、设置表单都用它）。
 */
export default function SceneFields({
  fields,
  values,
  onChange,
  idPrefix,
  focusRich,
}: Props) {
  if (fields.length === 0) return null;

  const firstTextarea = fields.findIndex((field) => field.type === "textarea");

  return (
    <div className="fields">
      {fields.map((field, index) => {
        const id = `${idPrefix}-${field.key}`;
        const value = values[field.key];
        const multiline = field.type === "textarea";

        return (
          <div className="field" key={field.key}>
            {/* CM6 里没有能被 htmlFor 指到的元素，多行字段的标签改为不给 htmlFor，
                无障碍名走编辑器的 aria-label（见下） */}
            {multiline ? (
              <span className="field__label">
                {field.label}
                {field.unit && <span className="field__unit">（{field.unit}）</span>}
              </span>
            ) : (
              <label className="field__label" htmlFor={id}>
                {field.label}
                {field.unit && <span className="field__unit">（{field.unit}）</span>}
              </label>
            )}

            {multiline ? (
              <Suspense fallback={<p className="field__loading">编辑器加载中…</p>}>
                <MarkdownWysiwyg
                  value={fieldText(value)}
                  placeholder={field.placeholder}
                  ariaLabel={field.label}
                  variant="inline"
                  mode={field.editor}
                  focus={Boolean(focusRich) && index === firstTextarea}
                  onChange={(next) => onChange(field.key, next)}
                />
              </Suspense>
            ) : field.type === "select" ? (
              <select
                id={id}
                className="field__control"
                value={fieldText(value)}
                onChange={(e) => onChange(field.key, e.target.value)}
              >
                <option value="">未选择</option>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === "bool" ? (
              <input
                id={id}
                type="checkbox"
                checked={value === true}
                onChange={(e) => onChange(field.key, e.target.checked)}
              />
            ) : (
              <input
                id={id}
                className="field__control"
                type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                placeholder={field.placeholder}
                value={fieldText(value)}
                onChange={(e) =>
                  onChange(
                    field.key,
                    field.type === "number"
                      ? e.target.value === ""
                        ? ""
                        : Number(e.target.value)
                      : e.target.value,
                  )
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
