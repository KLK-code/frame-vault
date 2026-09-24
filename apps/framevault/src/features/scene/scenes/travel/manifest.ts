import type { SceneManifest } from "../../manifest";

const manifest: SceneManifest = {
  presentation: {
    icon: "mountain",
  },
  entryFields: [
    { key: "location", label: "地点", type: "text", placeholder: "这一站，在哪里？" },
    { key: "text", label: "旅途见闻", type: "textarea", note: true, placeholder: "记下沿途的风景和心情…" },
  ],
  // 有地点就用地点命名；没填地点时那个变量自己消失，名字退成「日期_序号」
  mediaNameTemplate: "{date}_{field:location}_{n}",
};

export default manifest;
