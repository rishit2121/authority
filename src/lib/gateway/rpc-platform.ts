import "server-only";

import { gatewayQuery } from "./db";

export interface DayCount {
  day: string;
  count: number;
}

export interface RecentSignup {
  email: string;
  createdAt: string;
  confirmed: boolean;
  hasConnection: boolean;
  hasAgent: boolean;
  hasCall: boolean;
}

export interface PlatformMetrics {
  generatedAt: string;
  users: { total: number; confirmed: number; last7d: number; last30d: number; signedIn7d: number };
  workspaces: {
    total: number;
    withConnection: number;
    withAgent: number;
    withCall: number;
    active7d: number;
  };
  calls: { authorized7d: number; authorized30d: number; executed7d: number };
  connectionsByService: Record<string, number>;
  signupsByDay: DayCount[];
  callsByDay: DayCount[];
  recentSignups: RecentSignup[];
}

/** Cross-tenant aggregates for the operator dashboard. Callers must gate on isPlatformAdmin() first. */
export async function getPlatformMetrics(): Promise<PlatformMetrics> {
  const rows = await gatewayQuery<{ metrics: PlatformMetrics }>(
    "select gateway.platform_metrics() as metrics",
  );
  return rows[0].metrics;
}
