import { CopyTextButton } from "./CopyTextButton";

/**
 * A short monospace block of shell commands with one copy button for the whole block. The commands come from
 * src/lib/proof-run/commands.ts, never typed in here, so the page cannot drift from what the CLI tests exercise.
 */
export function CommandPanel({
  title,
  commands,
  copyLabel,
  testId,
  className = "",
}: {
  title: string;
  commands: readonly string[];
  /** Accessible name of the copy button, e.g. "Copy demo commands". */
  copyLabel: string;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 rounded-[12px] border border-ink bg-ink text-paper ${className}`}
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-3 border-b border-paper/15 px-4 py-2">
        <span className="font-mono-code text-[12px] text-line-strong">{title}</span>
        <CopyTextButton
          text={commands.join("\n")}
          aria-label={copyLabel}
          data-testid={testId ? `${testId}-copy` : undefined}
          className="min-h-[32px] rounded-[7px] border border-paper/25 px-3 font-mono-code text-[12px] text-paper transition-colors hover:bg-paper/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-bright"
        />
      </div>
      {/* Long lines wrap with a hanging indent under the prompt instead of scrolling, so nothing is cut off at
          360px; the copy button always copies the unwrapped commands. */}
      <pre className="px-4 py-3 font-mono-code text-[12.5px] leading-[1.75]">
        <code>
          {commands.map((command) => (
            <span
              key={command}
              className="block whitespace-pre-wrap pl-[2ch] -indent-[2ch] [overflow-wrap:anywhere]"
            >
              <span aria-hidden="true" className="select-none text-line-strong">
                ${" "}
              </span>
              {command}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
