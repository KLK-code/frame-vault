import EntryTimeline from "../../EntryTimeline";
import SceneComposer from "../../SceneComposer";
import SceneNotice from "../../SceneNotice";
import type { SceneViewProps } from "../../registry";
import { useSceneData } from "../../useSceneData";
import manifest from "./manifest";
import "./TravelScene.css";

export default function TravelScene({ folder, scene }: SceneViewProps) {
  const data = useSceneData(folder);
  return (
    <div className="travel-scene">
      <SceneComposer data={data} placeholder="记录这段旅程的点滴…" />
      <SceneNotice message={data.notice} onUndo={data.undo} onDismiss={data.dismissNotice} />
      {data.error && <p className="travel-scene__error" role="alert">{data.error}</p>}
      <EntryTimeline data={data} sceneId={scene.id} fields={manifest.entryFields ?? []}
        emptyText="每一段旅程，都从第一条记录开始。写下此刻的心情，或导入沿途的照片；点「改文字」补上地点与见闻。" />
      <p className="travel-scene__footer">走过的路，遇见的风景，都值得收藏。</p>
    </div>
  );
}
