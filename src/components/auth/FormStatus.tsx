"use client";

import { useFormStatus } from "react-dom";

import { Icon } from "@/components/ui/Icon";

/**
 * Inline error banner.
 *
 * `role="alert"` so the message is announced when it appears, rather than
 * silently changing colour for anyone using a screen reader.
 */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-space-sm rounded-lg border border-deny/40 bg-deny/10 px-space-md py-2.5 font-body-md text-body-sm text-on-surface"
    >
      <Icon name="error" size={16} className="mt-px text-deny" />
      <span>{message}</span>
    </div>
  );
}

/** Confirmation banner, used for the neutral "check your inbox" states. */
export function FormSuccess({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-space-sm rounded-lg border border-allow/40 bg-allow/10 px-space-md py-2.5 font-body-md text-body-sm text-on-surface"
    >
      <Icon name="mail" size={16} className="mt-px text-allow" />
      <span>{message}</span>
    </div>
  );
}

/**
 * Submit button wired to the enclosing form's pending state.
 *
 * Disabled while submitting so a double click cannot fire the action twice,
 * and `aria-busy` so the state is exposed rather than implied by the label.
 */
export function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="flex h-11 w-full items-center justify-center rounded-lg bg-primary px-space-lg font-headline-sm text-body-md font-medium text-on-primary transition-all hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
