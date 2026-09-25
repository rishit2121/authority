import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CandidatePlanForm } from "@/components/contract/CandidatePlanForm";
import { Icon } from "@/components/ui/Icon";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";

export const metadata: Metadata = {
  title: "Create authority contract",
};

/**
 * Enter/edit a structured candidate plan and compile the minimum Task
 * Authority Contract it needs — no LLM anywhere in this path. Everything
 * on this page is informational until "Propose contract" persists it, and
 * even then the result is `proposed`, never active.
 */
export default async function NewContractPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const { repositories } = await createRepositoriesForCurrentTenant(`/app/tasks/${taskId}/contract/new`);

  const task = await repositories.tasks.findById(taskId);
  if (!task) notFound();

  return (
    <div className="flex flex-col gap-space-lg">
      <div>
        <Link
          href={`/app/tasks/${taskId}`}
          className="inline-flex w-fit items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <Icon name="arrow_forward" size={14} className="rotate-180" />
          Back to task
        </Link>
        <h1 className="mt-space-md max-w-3xl font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          Create authority contract
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          Enter a structured candidate plan for &ldquo;{task.intent}&rdquo; below — no model is involved.
          Authority validates it deterministically, computes the minimum permissions it needs, and narrows
          them to exactly this plan&apos;s operations, resources and arguments. Proposing a contract creates
          no runtime authority by itself; it starts in <code>proposed</code> and requires a separate, explicit
          activation step that does not exist yet in this build.
        </p>
      </div>

      <CandidatePlanForm taskId={taskId} />
    </div>
  );
}
