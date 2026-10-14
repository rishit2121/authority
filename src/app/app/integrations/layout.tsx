import { Suspense, type ReactNode } from "react";

import { BackToSetup } from "./BackToSetup";

export default function IntegrationsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <BackToSetup />
      </Suspense>
      {children}
    </>
  );
}
