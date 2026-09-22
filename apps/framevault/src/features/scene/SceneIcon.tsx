import type { SceneManifest } from "./manifest";

type Icon = NonNullable<SceneManifest["presentation"]>["icon"] | "photo" | "refresh";

/** 少量共用的线性图标；主题声明只存名字。 */
export default function SceneIcon({ name = "book", size = 20 }: { name?: Icon; size?: number }) {
  const paths: Record<Icon, string> = {
    book: "M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5Z",
    mountain: "m2 20 7-15 5 10 3-6 5 11H2Zm4-8 3 2 2-2",
    bolt: "m13 2-9 12h7l-1 8 10-13h-8l1-7Z",
    photo: "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm-1 14 5-5 4 4 4-6 5 7M8 7h.01",
    refresh: "M20 8a8 8 0 1 0 0 8M20 3v5h-5",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
