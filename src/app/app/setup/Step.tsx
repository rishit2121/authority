import type { ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import type { CallTone } from "@/lib/setup/state";

/** One numbered section of the Setup page. No hooks: rendered from both the server page and client panels. */
export function Step({
  number,
  title,
  done,
  active,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-[14px] border bg-paper-raised p-6 ${active ? "border-line-strong" : "border-line"}`}
      data-testid={`setup-step-${number}`}
      data-done={done}
      aria-labelledby={`setup-step-${number}-title`}
    >
      <h2
        id={`setup-step-${number}-title`}
        className="flex items-center gap-3 text-[16px] font-semibold text-ink"
      >
        {done ? (
          <Icon name="check_circle" size={22} className="text-allow" />
        ) : (
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-line-strong text-[12px] text-ink-soft">
            {number}
          </span>
        )}
        {title}
        {done ? <span className="sr-only">(done)</span> : null}
      </h2>
      <div className="mt-4 flex flex-col gap-4 sm:pl-[34px]">{children}</div>
    </section>
  );
}

const TONE: Record<CallTone, string> = {
  positive: "border-allow/30 bg-allow/10 text-allow",
  negative: "border-deny/30 bg-deny/10 text-deny",
  attention: "border-secondary/40 bg-secondary/10 text-secondary",
  neutral: "border-line-strong bg-surface-container-high text-ink-soft",
};

/** A status label that always carries its meaning in text, with color only as a second signal. */
export function Pill({ tone, children, testId }: { tone: CallTone; children: string; testId?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[12px] font-medium ${TONE[tone]}`}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

export const BTN_PRIMARY =
  "inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-[14px] font-medium text-on-primary transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-60";
export const BTN_SECONDARY =
  "inline-flex h-9 items-center justify-center rounded-lg border border-line-strong px-4 text-[13px] font-medium text-ink transition-colors hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-60";
export const INPUT = "h-10 rounded-lg border border-line-strong bg-paper px-3 text-[14px] text-ink";
