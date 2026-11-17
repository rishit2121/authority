import { ProofRunPlayback } from "@/components/marketing/proof-run/ProofRunPlayback";
import { transcriptMatchesRecipe } from "@/components/marketing/proof-run/ProofRunSection";

/**
 * The Setup page's sample path: the same Proof Run playback as the public site, from the checked-in transcript. It is
 * never a live result, makes no request and has no inputs; the live path is a separate, explicit choice.
 */
export function SetupSample({ label }: { label: string }) {
  return (
    <section
      className="flex flex-col gap-4 rounded-[14px] border border-dashed border-line-strong bg-paper-raised p-6"
      data-testid="setup-sample"
      aria-label={label}
    >
      <p className="inline-flex w-fit items-center rounded border border-line-strong px-2 py-0.5 text-[12px] font-medium text-ink-soft">
        {label}
      </p>
      <p className="text-[14px] text-ink-soft">
        A recorded run of one task, decided by Authority against a mock Slack. Pick an attempt to see the
        decision, the reason and whether anything reached the provider. Nothing here touches your workspace.
      </p>
      <ProofRunPlayback recipeHashMatches={transcriptMatchesRecipe()} />
      <p className="text-[13px] text-ink-soft">
        When you&apos;re ready, choose <strong className="font-medium text-ink">Connect a service</strong>{" "}
        above to make a real protected call with your own connection.
      </p>
    </section>
  );
}
