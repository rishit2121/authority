import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";

/** Public marketing surface: fixed header, offset main, footer. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="min-h-screen w-full bg-surface-container-lowest pt-[68px]">
        <div className="flex w-full flex-col">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
