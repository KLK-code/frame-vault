import type { FolderNode, SceneInfo } from "../../lib/api";
import { sceneOf } from "./registry";
import PlainScene from "./scenes/plain/PlainScene";
import "./SceneHost.css";

type Props = {
  folder: FolderNode | null;
  scene: SceneInfo | null;
  /** 透传给主题视图：写完 sceneConfig 后由外壳刷新场景列表 */
  onSceneConfigChange: (config: Record<string, unknown>) => Promise<boolean>;
};

/**
 * 右侧 = 当前场景（记录方式）的舞台。
 *
 * **只做两件事**：按 `effectiveScene` 找视图、把视图渲染出来。
 * 具体"记录长什么样、怎么录入"全部由场景视图决定 —— 核心不掺和。
 *
 * **刻意没有标题区**（2026-09 删掉的）：以前这里横着一条"场景自我标榜"的横幅
 * （场景图标 + 标语 + 文件夹名 + 场景徽章），占了 164px 却什么信息都不给 ——
 * 文件夹名侧栏里就写着，场景是"怎么记"而不是内容，没必要在正文上方再喊一遍。
 * 舞台现在整块归内容。
 */
export default function SceneHost({ folder, scene, onSceneConfigChange }: Props) {
  if (!folder) {
    return (
      <div className="scene-host scene-host--empty">
        <p>
          左边选一个文件夹开始记录，
          <br />
          或者点「文件夹」旁边的小 ＋ 新建一个。
        </p>
      </div>
    );
  }

  const View = sceneOf(folder.effectiveScene)?.View;

  // data-scene 挂在**舞台容器**上：场景的样式作用域碰不到外壳（标题栏 / 侧栏 / 设置窗口）
  return (
    <div className="scene-host" data-scene={folder.effectiveScene}>
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
