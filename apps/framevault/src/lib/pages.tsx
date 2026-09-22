import type { ComponentType } from "react";
import Placeholder from "../pages/Placeholder";
import VaultPage from "../pages/VaultPage";
import VaultManagerPage from "../pages/VaultManagerPage";

export type PageDef = {
  id: string;
  label: string;
  Page: ComponentType;
};

export const PAGES: PageDef[] = [
  { id: "timeline", label: "时间线", Page: () => <Placeholder title="时间线" /> },
  { id: "gallery", label: "图库", Page: () => <Placeholder title="图库" /> },
  { id: "calendar", label: "日历", Page: () => <Placeholder title="日历" /> },
  { id: "vault", label: "仓库", Page: VaultPage },
  { id: "vaults", label: "管理仓库", Page: VaultManagerPage },
];
