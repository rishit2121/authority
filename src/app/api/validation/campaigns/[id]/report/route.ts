import { NextResponse, type NextRequest } from "next/server";

import { loadPilotViewer } from "@/lib/pilot/viewer";
import { createClient } from "@/lib/supabase/server";
import { buildReportHtml, buildReportJson, buildReportMarkdown } from "@/lib/validation/report";
import { buildReportInputFromDb } from "@/lib/validation/read-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?format=json|md|html` — a report rebuilt from persisted rows; no secrets, no raw arguments. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if ((await loadPilotViewer(db)).access !== "eligible") {
    return NextResponse.json({ error: "invite_only" }, { status: 403 });
  }

  const input = await buildReportInputFromDb(db, id);
  if (!input) return NextResponse.json({ error: "not_found_or_not_finished" }, { status: 404 });

  const format = request.nextUrl.searchParams.get("format") ?? "json";
  const base = `authority-validation-${id.slice(0, 8)}`;
  const headers = (type: string, ext: string) => ({
    "content-type": `${type}; charset=utf-8`,
    "content-disposition": `attachment; filename="${base}.${ext}"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  if (format === "md")
    return new NextResponse(buildReportMarkdown(input), { headers: headers("text/markdown", "md") });
  if (format === "html")
    return new NextResponse(buildReportHtml(input), {
      headers: {
        ...headers("text/html", "html"),
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  return new NextResponse(JSON.stringify(buildReportJson(input), null, 2), {
    headers: headers("application/json", "json"),
  });
}
