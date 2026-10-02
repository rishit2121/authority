import type { Metadata } from "next";

import { PolicyForm } from "@/components/dashboard/PolicyForm";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = {
  title: "Create policy",
};

export default function NewPolicyPage() {
  return (
    <div className="flex flex-col gap-space-lg">
      <PageHeader
        title="Create policy"
        description="A deterministic rule that constrains tasks and tool calls."
      />
      <PolicyForm />
    </div>
  );
}
