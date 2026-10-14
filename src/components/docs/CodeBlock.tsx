"use client";

import { useState } from "react";

export function CodeBlock({
  code,
  language,
  copyAlwaysVisible = false,
  "data-testid": testId,
}: {
  code: string;
  language?: string;
  /** Show the Copy button at rest, not only on hover -- for blocks the user must copy (e.g. one-time secrets). */
  copyAlwaysVisible?: boolean;
  "data-testid"?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group relative rounded-[10px] border border-line bg-ink text-paper" data-testid={testId}>
      <button
        type="button"
        onClick={copy}
        className={`absolute right-2 top-2 rounded-md border border-paper/20 bg-ink px-2 py-1 font-mono-code text-[11px] text-paper/70 transition-opacity hover:text-paper group-hover:opacity-100 ${copyAlwaysVisible ? "opacity-100" : "opacity-0"}`}
        data-testid={testId ? `${testId}-copy` : undefined}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto px-4 py-3.5 text-[12.5px] leading-[1.6]">
        <code className={language ? `language-${language}` : undefined}>{code}</code>
      </pre>
    </div>
  );
}
