import type { FolderNode, SceneInfo } from "../../lib/api";
import { sceneOf } from "./registry";
import PlainScene from "./scenes/plain/PlainScene";
import SceneIcon from "./SceneIcon";
import "./SceneHost.css";

type Props = {
  folder: FolderNode | null;
  scene: SceneInfo | null;
  /** 透传给主题视图：写完 sceneConfig 后由外壳刷新场景列表 */
  onSceneConfigChange: (config: Record<string, unknown>) => Promise<boolean>;
};

/**
 * 右侧 = 当前场景的舞台。
 *
 * 它只做三件事：显示场景名与主题、按 `effectiveScene` 找视图、把视图渲染出来。
 * 具体"记录长什么样、怎么录入"全部由主题视图决定——核心不掺和。
 */
export default function SceneHost({ folder, scene, onSceneConfigChange }: Props) {
  if (!folder) {
    return (
      <div className="scene-host scene-host--empty">
        <p>
          左边选一个场景开始记录，
          <br />
          或者点「场景」旁边的小 ＋ 新建一个。
        </p>
      </div>
    );
  }

  const View = sceneOf(folder.effectiveScene)?.View;
  const presentation = sceneOf(folder.effectiveScene)?.manifest.presentation;

  return (
    <div className="scene-host">
      <header className="scene-host__head">
        <div className="scene-host__intro">
          <span className="scene-host__eyebrow"><SceneIcon name={presentation?.icon} size={16} />{presentation?.eyebrow ?? "FRAMEVAULT"}</span>
          <div className="scene-host__heading">
            <h1 className="scene-host__name">{folder.name}</h1>
            <span className="scene-host__theme">{scene ? scene.name : folder.effectiveScene}</span>
          </div>
          <p className="scene-host__subtitle">{presentation?.subtitle ?? scene?.description}</p>
        </div>
        {presentation && <span className="scene-host__signature" aria-hidden="true">{presentation.signature}<SceneIcon name={presentation.icon} size={38} /></span>}
      </header>

      {!View && (
        <p className="scene-host__notice">
          主题「{folder.effectiveScene}」没有安装，暂时用普通记录显示。
        </p>
      )}

      {View && scene ? (
        <View key={`${folder.id}:${scene.id}`} folder={folder} scene={scene} onSceneConfigChange={onSceneConfigChange} />
      ) : (
        <PlainScene
          key={`${folder.id}:${folder.effectiveScene}`}
          folder={folder}
          scene={
            scene ?? {
              id: folder.effectiveScene,
              name: folder.effectiveScene,
              description: "",
              builtin: false,
            }
          }
          onSceneConfigChange={onSceneConfigChange}
        />
      )}
    </div>
  );
}
