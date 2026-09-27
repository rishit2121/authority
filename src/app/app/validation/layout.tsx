import type { Metadata } from "next";

import { SyntheticBadge } from "@/components/validation/Pill";
import { ValidationTabs } from "@/components/validation/Tabs";

export const metadata: Metadata = { title: "Validation Lab" };

export default function ValidationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-space-lg">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-on-surface md:text-[2rem]">
            Validation Lab
          </h1>
          <SyntheticBadge />
        </div>
        <p className="mt-space-sm max-w-3xl font-body-md text-body-md text-on-surface-variant">
          Attack your own agents and controls in safe simulations. Every run happens in a throwaway sandbox
          tenant with synthetic data and mock integrations, through the real authorization gateway, and is
          cleaned up automatically. It never touches real integrations or arbitrary hosts.
        </p>
      </header>
      <ValidationTabs />
      {children}
    </div>
  );
}
