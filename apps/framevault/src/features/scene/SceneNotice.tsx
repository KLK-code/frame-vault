import "./SceneNotice.css";

type Props = {
  message: string | null;
  onUndo: () => Promise<boolean>;
  onDismiss: () => void;
  undoLabel?: string;
};

/**
 * 一句可撤销的提示。**公共件**——"能后悔"是所有主题都该有的基础能力，
 * 所以它由核心提供，主题只管摆在哪儿（通常放在场景顶部）。
 */
export default function SceneNotice({ message, onUndo, onDismiss, undoLabel = "撤销" }: Props) {
  if (!message) return null;

  return (
    <div className="scene-notice" role="status">
      <span className="scene-notice__text">{message}</span>
      <button className="scene-notice__action" onClick={() => void onUndo()}>
        {undoLabel}
      </button>
      <button className="scene-notice__close" onClick={onDismiss} title="关掉">
        ✕
      </button>
    </div>
  );
}
