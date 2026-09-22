import type { SceneManifest } from "../../manifest";

const manifest: SceneManifest = {
  presentation: {
    icon: "mountain", eyebrow: "COLLECT MOMENTS", suggestedAppearance: "preset.tide",
    subtitle: "收藏世界，也收藏自己",
    signature: "On the road", motto: "去看更大的世界，记录每一段旅程。",
  },
  entryFields: [
    { key: "location", label: "地点", type: "text", placeholder: "这一站，在哪里？" },
    { key: "text", label: "旅途见闻", type: "textarea", placeholder: "记下沿途的风景和心情…" },
  ],
};

export default manifest;
