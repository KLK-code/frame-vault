import type { SceneManifest } from "../../manifest";

/**
 * 挑战：设置里要填"目标天数"和"规则"——声明出来，核心生成表单。
 *
 * 想加"距离 / 时长"这类记录字段？在 entryFields 里写两行就行，
 * 核心会自动给它生成录入控件——**不用改核心，也不用改别的主题**。
 */
const manifest: SceneManifest = {
  presentation: {
    icon: "bolt",
  },
  entryFields: [
    { key: "text", label: "打卡心得", type: "textarea", note: true, placeholder: "记录今天的进步…" },
  ],
  // 打卡照按「日期_场景_序号」命名：同一天同一个挑战的连拍排在一起
  mediaNameTemplate: "{date}_{scene}_{n}",
  configSchema: [
    { key: "targetDays", label: "目标天数", type: "number", unit: "天", placeholder: "30" },
    { key: "rules", label: "挑战规则", type: "textarea", placeholder: "每天至少跑 1 公里" },
  ],
};

export default manifest;
