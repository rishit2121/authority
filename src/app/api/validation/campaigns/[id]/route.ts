import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  loadRunsWithSteps,
  toCampaignView,
  toFindingView,
  toRemediationView,
} from "@/lib/validation/read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Polling endpoint for the live campaign view. Everything is read through the caller's own RLS scope. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: row } = await db.from("validation_campaigns").select("*").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [runs, findings] = await Promise.all([
    loadRunsWithSteps(db, id),
    db.from("validation_findings").select("*").eq("campaign_id", id).limit(500),
  ]);
  const findingIds = (findings.data ?? []).map((f) => f.id);
  const remediations = findingIds.length
    ? await db.from("validation_remediations").select("*").in("finding_id", findingIds)
    : { data: [] };
  return NextResponse.json(
    {
      campaign: toCampaignView(row),
      runs,
      findings: (findings.data ?? []).map(toFindingView),
      remediations: (remediations.data ?? []).map(toRemediationView),
      synthetic: true,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
