"use client";

import { useId, useState } from "react";

import { Icon } from "@/components/ui/Icon";

const inputClasses =
  "w-full rounded-lg border border-outline-variant/40 bg-surface-container px-space-md py-2.5 font-body-md text-body-md text-on-surface placeholder:text-outline/70 transition-colors focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container disabled:opacity-60";

/** Labelled text input. The label is always rendered — never a placeholder standing in for one. */
export function FormField({
  label,
  name,
  type = "text",
  autoComplete,
  required = true,
  defaultValue,
  placeholder,
  hint,
  disabled,
  readOnly,
  inputMode,
}: {
  label: string;
  name: string;
  type?: "text" | "email";
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  readOnly?: boolean;
  inputMode?: "text" | "email";
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-space-xs">
      <label htmlFor={id} className="font-body-md text-body-sm font-medium text-on-surface">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        inputMode={inputMode}
        aria-describedby={hintId}
        className={inputClasses}
      />
      {hint ? (
        <p id={hintId} className="font-body-sm text-body-sm text-outline">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Password input with a visibility toggle.
 *
 * The toggle is a real button with an accessible name that reflects its
 * action, and `aria-pressed` so its state is announced rather than inferred
 * from the icon.
 */
export function PasswordField({
  label,
  name,
  autoComplete,
  hint,
  disabled,
}: {
  label: string;
  name: string;
  autoComplete: "current-password" | "new-password";
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-space-xs">
      <label htmlFor={id} className="font-body-md text-body-sm font-medium text-on-surface">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          disabled={disabled}
          aria-describedby={hintId}
          className={`${inputClasses} pr-11`}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-outline transition-colors hover:text-on-surface focus-visible:text-on-surface"
        >
          <Icon name={visible ? "visibility_off" : "visibility"} size={17} />
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="font-body-sm text-body-sm text-outline">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
