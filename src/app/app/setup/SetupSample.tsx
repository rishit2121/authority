import { capturedRun, describeResult, engineeringUpdateRecipe } from "@/lib/proof-run/recipe";

/**
 * The Setup page's sample path: the checked-in Proof Run transcript, never a live result.
 *
 * TODO(proof-run playback): replace the static table below with
 * `src/components/marketing/proof-run/ProofRunPlayback.tsx` (being built on the homepage branch), keeping the
 * `label` prop and the "not a live result" framing.
 */
export function SetupSample({ label }: { label: string }) {
  const recipe = engineeringUpdateRecipe;
  const byId = new Map(capturedRun.attempts.map((attempt) => [attempt.id, attempt]));
  const sourceNote =
    capturedRun.source === "local-fixture"
      ? "Captured from the local runner against a mock Slack transport."
      : "Illustrative transcript, written by hand to show the format.";

  return (
    <section
      className="flex flex-col gap-3 rounded-[14px] border border-dashed border-line-strong bg-paper-raised p-6"
      data-testid="setup-sample"
      aria-label={label}
    >
      <p className="inline-flex w-fit items-center rounded border border-line-strong px-2 py-0.5 text-[12px] font-medium text-ink-soft">
        {label}
      </p>
      <h2 className="text-[16px] font-semibold text-ink">{recipe.title}</h2>
      <p className="text-[14px] text-ink-soft">
        Request: &ldquo;{recipe.request}&rdquo; · Connection: {recipe.connection.identity} (
        {recipe.connection.note})
      </p>
      <div className="overflow-x-auto rounded-[10px] border border-line">
        <table className="w-full border-collapse text-left text-[13px]">
          <caption className="sr-only">Sample attempts and what Authority decided</caption>
          <thead>
            <tr className="border-b border-line text-[12px] text-ink-soft">
              <th className="px-3 py-2 font-medium">Attempt</th>
              <th className="px-3 py-2 font-medium">Decision</th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="px-3 py-2 font-medium">Reached provider</th>
              <th className="px-3 py-2 font-medium">What happened</th>
            </tr>
          </thead>
          <tbody>
            {recipe.attempts.map((attempt) => {
              const got = byId.get(attempt.id);
              return (
                <tr key={attempt.id} className="border-b border-line last:border-b-0 align-top">
                  <td className="px-3 py-2 text-ink">{attempt.label}</td>
                  <td className="px-3 py-2 font-mono-code text-[12px] text-ink">{got?.decision ?? "n/a"}</td>
                  <td className="px-3 py-2 font-mono-code text-[12px] text-ink-soft">
                    {got?.reasonCodes.join(", ") || "none"}
                  </td>
                  <td className="px-3 py-2 text-ink">{got ? `${got.dispatches}×` : "n/a"}</td>
                  <td className="px-3 py-2 text-ink-soft">
                    {got ? describeResult(got.result) : "Not captured."}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-ink-soft">{sourceNote} Nothing on this panel touched a real account.</p>
    </section>
  );
}
