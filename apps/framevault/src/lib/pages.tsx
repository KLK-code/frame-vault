import type { ComponentType } from "react";
import Placeholder from "../pages/Placeholder";
import TimelinePage from "../pages/TimelinePage";

export type PageDef = {
  id: string;
  label: string;
  Page: ComponentType;
};

export const PAGES: PageDef[] = [
  { id: "timeline", label: "时间线", Page: TimelinePage },
  { id: "gallery", label: "图库", Page: () => <Placeholder title="图库" /> },
  { id: "calendar", label: "日历", Page: () => <Placeholder title="日历" /> },
  { id: "notes", label: "笔记", Page: () => <Placeholder title="笔记" /> },
];
