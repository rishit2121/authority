"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateApplicationReturnUrlsAction } from "@/app/app/settings/applications/actions";

export function ReturnUrlsForm({
  applicationId,
  initialUrls,
}: {
  applicationId: string;
  initialUrls: string[];
}) {
  const router = useRouter();
  const [text, setText] = useState(initialUrls.join("\n"));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-paper-raised p-5">
      <h2 className="text-[15px] font-semibold text-ink">Allowed return URLs</h2>
      <p className="text-[13px] text-ink-soft">
        Where an embedded connection session may redirect back to after a customer connects a provider — one
        per line, exact match only. Never a pattern or wildcard, so this can never become an open redirect.
      </p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
        rows={4}
        placeholder="https://app.acme.com/settings/integrations"
        className="rounded-lg border border-line-strong bg-paper px-2.5 py-1.5 font-mono-code text-[12px] text-ink"
        data-testid="application-return-urls"
      />
      {error ? (
        <p role="alert" className="text-[13px] text-deny">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-[13px] text-allow">
          Saved.
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          setSaved(false);
          const urls = text
            .split("\n")
            .map((u) => u.trim())
            .filter((u) => u.length > 0);
          startTransition(async () => {
            const result = await updateApplicationReturnUrlsAction(applicationId, urls);
            if (result.ok) {
              setSaved(true);
              router.refresh();
            } else {
              setError(result.error ?? "Could not save.");
            }
          });
        }}
        className="self-start rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-black/[0.03] disabled:opacity-50"
        data-testid="application-return-urls-save"
      >
        Save
      </button>
    </div>
  );
}
