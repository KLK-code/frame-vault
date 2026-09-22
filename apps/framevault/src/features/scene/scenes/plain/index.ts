import type { SceneUnit } from "../../manifest";
import manifest from "./manifest";
import View from "./PlainScene";

/** 主题单元：声明 + 视图。丢一个目录就是完整的主题（将来打包分发也是这个形状） */
const plainScene: SceneUnit = { manifest, View };

export default plainScene;
