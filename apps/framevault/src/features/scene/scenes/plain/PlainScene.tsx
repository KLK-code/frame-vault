import EntryTimeline from "../../EntryTimeline";
import SceneComposer from "../../SceneComposer";
import SceneNotice from "../../SceneNotice";
import type { SceneViewProps } from "../../registry";
import { useSceneData } from "../../useSceneData";
import manifest from "./manifest";
import "./PlainScene.css";

export default function PlainScene({ folder, scene }: SceneViewProps) {
  const data = useSceneData(folder);
  return (
    <div className="plain-scene">
      <SceneComposer data={data} className="plain-scene__compose" placeholder="今天想记录什么…" />
      <SceneNotice message={data.notice} onUndo={data.undo} onDismiss={data.dismissNotice} />
      {data.error && <p className="plain-scene__error" role="alert">{data.error}</p>}
      <EntryTimeline data={data} sceneId={scene.id} fields={manifest.entryFields ?? []}
        emptyText="让今天留下一个小小的印记。写点什么，或选几张照片，开始第一篇日记。" />
      <p className="plain-scene__count">把日子写下来，让平凡变得有迹可循。</p>
    </div>
  );
}
