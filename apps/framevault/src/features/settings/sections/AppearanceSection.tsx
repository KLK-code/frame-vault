import ThemeEditor from "../../theme/ThemeEditor";
import PlaceholderSection from "./PlaceholderSection";

export default function AppearanceSection() {
  return (
    <>
      <ThemeEditor />

      <div className="settings__spacer" />

      <PlaceholderSection
        items={[{ id: "theme.install", label: "安装外观主题包…", hint: "M3" }]}
      />
    </>
  );
}
