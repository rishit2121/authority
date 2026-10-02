import { DocsNav } from "@/components/docs/DocsNav";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] gap-10 px-margin py-space-2xl md:px-margin-lg">
      <aside className="hidden w-[220px] shrink-0 md:block">
        <div className="sticky top-[88px]">
          <DocsNav />
        </div>
      </aside>
      <div className="min-w-0 flex-1 pb-space-2xl">{children}</div>
    </div>
  );
}
