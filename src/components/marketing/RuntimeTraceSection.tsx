import { MarketingContainer } from "@/components/marketing/MarketingContainer";
import { RuntimeTrace, type RuntimeTraceEntry } from "@/components/marketing/RuntimeTrace";
import { SectionHeading } from "@/components/marketing/SectionHeading";

const ENTRIES: RuntimeTraceEntry[] = [
  { time: "09:41:02", label: "Read order #4821", operationId: "postgres.select", status: "allowed" },
  {
    time: "09:41:03",
    label: "Read payment",
    operationId: "stripe.payment_intents.retrieve",
    status: "allowed",
  },
  {
    time: "09:41:04",
    label: "Read repository secret",
    operationId: "github.get_repository_secrets",
    status: "denied",
  },
  { time: "09:41:05", label: "Create exact refund", operationId: "stripe.refunds.create", status: "allowed" },
  { time: "09:41:07", label: "Email customer", operationId: "gmail.messages.send", status: "allowed" },
  { time: "09:41:08", label: "Permissions revoked", note: "0 standing permissions" },
];

export function RuntimeTraceSection() {
  return (
    <section id="trace" className="py-20 md:py-28">
      <MarketingContainer>
        <SectionHeading
          eyebrow="Tool calls"
          title="Every call, checked and recorded."
          description="A real decision trace — human-readable action names first, operation ids secondary."
        />
        <div className="mt-10">
          <RuntimeTrace entries={ENTRIES} />
        </div>
      </MarketingContainer>
    </section>
  );
}
