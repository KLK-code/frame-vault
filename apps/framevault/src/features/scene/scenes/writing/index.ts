import type { SceneUnit } from "../../manifest";
import manifest from "./manifest";
import View from "./WritingScene";

/** 写作台 = 声明 + 视图。注册表只认这个单元，不认识内部。 */
const scene: SceneUnit = { manifest, View };

export default scene;
