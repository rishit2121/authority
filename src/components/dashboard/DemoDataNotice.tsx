import { Icon } from "@/components/ui/Icon";

/**
 * Says plainly that the product records below are fixtures.
 *
 * Authentication, profiles and tenant membership are real as of Part 2A; the
 * tasks, agents, policies, integrations and approvals are not. Leaving that
 * ambiguous in a security product would be the wrong kind of quiet.
 */
export function DemoDataNotice({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-start gap-space-sm rounded-lg border border-outline-variant/30 bg-surface-container px-space-md py-2.5 ${className ?? ""}`}
    >
      <Icon name="warning" size={15} className="mt-0.5 text-outline" />
      <p className="font-body-md text-body-sm text-on-surface-variant">
        <span className="font-medium text-on-surface">Demo data.</span> Your account and workspace are real.
        The tasks, agents, policies, integrations and approvals below are fixtures — no agent, credential or
        external service is connected yet.
      </p>
    </div>
  );
}
