import type { Metadata } from "next";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { loadNavBadges } from "@/lib/data/nav";

export const metadata: Metadata = {
  title: "Control plane",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const badges = await loadNavBadges();

  return <DashboardShell badges={badges}>{children}</DashboardShell>;
}
