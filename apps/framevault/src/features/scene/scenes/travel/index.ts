import type { SceneUnit } from "../../manifest";
import manifest from "./manifest";
import TravelScene from "./TravelScene";

export default { manifest, View: TravelScene } satisfies SceneUnit;
