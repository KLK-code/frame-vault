import { useRef, useState } from "react";
import SceneIcon from "./SceneIcon";
import type { SceneData } from "./useSceneData";
import "./SceneComposer.css";

type Props = {
  data: SceneData;
  placeholder: string;
  className?: string;
  /** 挑战保留一张照片一条记录的导入编排。 */
  individualPhotos?: boolean;
};

export default function SceneComposer({ data, placeholder, className = "", individualPhotos }: Props) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const disabled = submitting || data.busy !== null;

  async function submit(photos: boolean) {
    if (pending.current || data.busy !== null || (!photos && !title.trim())) return;
    pending.current = true;
    setSubmitting(true);
    try {
      let ok = false;
      if (photos && individualPhotos) {
        const files = await data.pickPhotos();
        if (files.length === 0) return;
        for (const file of files) {
          const entry = await data.create(title.trim());
          if (!entry || !(await data.importPhotos(entry.id, [file]))) return;
        }
        ok = true;
      } else {
        ok = Boolean(await (photos ? data.createWithPhotos(title.trim()) : data.create(title.trim())));
      }
      if (ok) setTitle("");
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form className={`scene-composer ${className}`} onSubmit={(event) => {
      event.preventDefault();
      void submit(false);
    }}>
      <input aria-label="新记录标题" value={title} placeholder={placeholder}
        disabled={disabled} onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => { if (event.nativeEvent.isComposing) event.preventDefault(); }} />
      <div className="scene-composer__actions">
        <button type="button" className="scene-composer__photo" title="新建并导入照片或视频"
          aria-label="新建并导入照片或视频" disabled={disabled} onClick={() => void submit(true)}>
          <SceneIcon name="photo" /><span>照片</span>
        </button>
        <button type="submit" className="scene-composer__submit" disabled={disabled || !title.trim()}>
          {submitting ? "保存中…" : "记录"}
        </button>
      </div>
    </form>
  );
}
