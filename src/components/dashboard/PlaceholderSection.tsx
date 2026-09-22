import type { ReactNode } from "react";

/**
 * Sections that exist in the navigation but are not part of this build.
 * Says so plainly rather than implying functionality that isn't there.
 */
export function PlaceholderSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
          {title}
        </h1>
        <p className="mt-space-sm max-w-2xl font-body-md text-body-md text-on-surface-variant">
          {description}
        </p>
      </header>
      {children}
      <p className="rounded-lg border border-outline-variant/30 bg-surface-container px-space-lg py-space-md font-mono-code text-[11px] text-outline">
        This section is not implemented in the current build.
      </p>
    </div>
  );
}
