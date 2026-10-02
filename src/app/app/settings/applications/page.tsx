import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusPill } from "@/components/ui/StatusPill";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

import { CreateApplicationForm } from "./CreateApplicationForm";

export const metadata: Metadata = { title: "Developer applications" };

export default async function ApplicationsPage() {
  const { identity, context } = await createRepositoriesForCurrentTenant("/app/settings/applications");
  const canAdmin = ["admin", "owner"].includes(identity.role);

  const { data: applications } = await context.supabase
    .from("applications")
    .select("id, name, slug, environment, status, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Developer applications"
        description="Each application can create its own customers, open connections on their behalf, and start tasks for them — none of them ever need an Authority account."
      />

      <Link
        href="/docs/customer-connections"
        className="text-[13px] text-outline underline underline-offset-2"
      >
        View docs
      </Link>

      {canAdmin ? <CreateApplicationForm /> : null}

      {!applications || applications.length === 0 ? (
        <EmptyState
          icon="token"
          heading="No applications yet"
          description={
            canAdmin
              ? "Create one above to issue its first backend credential."
              : "An admin has not created an application yet."
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {applications.map((app) => (
            <Link
              key={app.id}
              href={`/app/settings/applications/${app.id}`}
              className="flex items-center justify-between rounded-[10px] border border-line bg-paper-raised p-5 transition-colors hover:bg-black/[0.02]"
              data-testid={`application-${app.id}`}
            >
              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-semibold text-ink">{app.name}</span>
                <span className="font-mono-code text-[12px] text-ink-soft">{app.slug}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded border border-line px-2 py-0.5 font-mono-code text-[11px] text-ink-soft">
                  {app.environment}
                </span>
                <StatusPill tone={app.status === "active" ? "positive" : "muted"}>{app.status}</StatusPill>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
