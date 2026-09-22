"use client";

import { useState, type FormEvent } from "react";

interface Field {
  name: string;
  label: string;
  placeholder: string;
  type: string;
  required: boolean;
}

const FIELDS: Field[] = [
  { name: "email", label: "Work Email", placeholder: "alex@company.com", type: "email", required: true },
  {
    name: "company",
    label: "Company / Organization",
    placeholder: "Acme Systems Inc.",
    type: "text",
    required: true,
  },
  {
    name: "useCase",
    label: "Agent Use Case",
    placeholder: "Automated code remediation & PR generation",
    type: "text",
    required: true,
  },
  {
    name: "stack",
    label: "Current Stack / Models",
    placeholder: "Claude Opus 5, LangGraph, MCP GitHub server",
    type: "text",
    required: false,
  },
];

export function FinalCta() {
  const [submitted, setSubmitted] = useState(false);

  // No backend in this build: the form confirms inline instead of posting.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
  };

  return (
    <section
      id="request-access"
      className="relative w-full border-t border-outline-variant/30 bg-band py-space-2xl md:py-[130px]"
    >
      <div className="mx-auto w-full max-w-[1280px] px-margin md:px-margin-lg">
        <div className="mx-auto mb-space-2xl max-w-3xl text-center">
          <span className="font-label-caps text-label-caps uppercase tracking-widest text-primary">
            Start Small, Run Secure
          </span>
          <h2 className="mt-space-sm font-headline-lg text-[2.25rem] font-semibold leading-[1.15] tracking-tight text-on-surface md:text-[3rem]">
            Put your first production agent behind least privilege.
          </h2>
          <p className="mt-space-md font-body-lg text-body-lg text-on-surface-variant">
            Bring one agent, one workflow, and one integration. We&apos;ll help define and enforce the task
            boundary in under 30 minutes.
          </p>
        </div>

        <div className="mx-auto max-w-xl rounded-xl border border-outline-variant/40 bg-surface-container-low p-space-xl shadow-2xl">
          <form className="flex flex-col gap-space-md" onSubmit={handleSubmit}>
            {FIELDS.map((field) => (
              <div key={field.name}>
                <label
                  htmlFor={field.name}
                  className="mb-1 block font-label-caps text-label-caps uppercase text-outline"
                >
                  {field.label}
                </label>
                <input
                  id={field.name}
                  name={field.name}
                  type={field.type}
                  required={field.required}
                  placeholder={field.placeholder}
                  className="h-10 w-full rounded border border-outline-variant/40 bg-surface-container-lowest px-space-md font-body-md text-[13px] text-on-surface transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            ))}

            <button
              type="submit"
              className="mt-space-md h-11 w-full rounded-lg bg-primary font-headline-sm text-body-md font-medium text-on-primary shadow-[0_0_20px_-4px_rgba(85,216,255,0.35)] transition-all hover:bg-primary-fixed"
            >
              Request early access
            </button>
          </form>

          <p aria-live="polite" className="mt-space-md text-center font-mono-code text-[11px] text-outline">
            {submitted
              ? "Request received — our runtime security team will follow up shortly."
              : "Strict confidentiality · SOC2-compliant test clusters · White-glove setup"}
          </p>
        </div>
      </div>
    </section>
  );
}
