import { fieldText, type FieldDecl } from "./manifest";
import "./SceneFields.css";

type Props = {
  fields: FieldDecl[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** 同一页可能有多个表单，用前缀避免 id 撞车 */
  idPrefix: string;
};

/**
 * 把主题的**声明**渲染成表单。核心提供，主题只管"把哪个声明放在哪里"。
 *
 * 这就是"特殊功能怎么对外给接口"的答案：主题写两行声明，
 * 不用自己写 input、label、单位、校验提示。
 */
export default function SceneFields({ fields, values, onChange, idPrefix }: Props) {
  if (fields.length === 0) return null;

  return (
    <div className="fields">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const value = values[field.key];

        return (
          <div className="field" key={field.key}>
            <label className="field__label" htmlFor={id}>
              {field.label}
              {field.unit && <span className="field__unit">（{field.unit}）</span>}
            </label>

            {field.type === "textarea" ? (
              <textarea
                id={id}
                className="field__control"
                rows={4}
                placeholder={field.placeholder}
                value={fieldText(value)}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
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
