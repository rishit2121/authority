"use client";

import { useState } from "react";

/**
 * A one-click copy for a non-secret id (never render a secret through this
 * -- it has no masking, no one-time-reveal, and no audit trail, unlike the
 * credential-issuance modals). The caller supplies its own className so
 * this fits a page's existing button styling rather than imposing one.
 */
export function CopyButton({
  value,
  className,
  testId,
}: {
  value: string;
  className: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button type="button" onClick={copy} className={className} data-testid={testId}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
