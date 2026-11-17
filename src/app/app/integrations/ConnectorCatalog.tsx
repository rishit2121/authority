"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { safeReturnTo } from "@/lib/setup/return-to";

export interface CatalogCard {
  id: string;
  name: string;
  description: string;
  category: string;
  href: string | null;
  logo: string;
}

/** The connector catalog with a search box and category filter, so 100+ services stay scannable. */
export function ConnectorCatalog({ entries, categories }: { entries: CatalogCard[]; categories: string[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  // Arriving from Setup: keep the way back on every connector page.
  const returnTo = safeReturnTo(useSearchParams().get("returnTo"));
  const withReturn = (href: string) =>
    returnTo ? `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}` : href;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (!category || e.category === category) &&
        (!q || `${e.name} ${e.description} ${e.category}`.toLowerCase().includes(q)),
    );
  }, [entries, query, category]);

  const chip = (label: string, value: string | null) => (
    <button
      key={label}
      type="button"
      onClick={() => setCategory(value)}
      aria-pressed={category === value}
      className={
        "rounded-full border px-3 py-1 text-[12px] transition-colors " +
        (category === value
          ? "border-ink bg-ink text-paper"
          : "border-line bg-paper-raised text-ink-soft hover:text-ink")
      }
      data-testid={`catalog-category-${value ?? "all"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <label className="flex max-w-md items-center gap-2 rounded-[10px] border border-line bg-paper-raised px-3 py-2">
          <Icon name="search" size={16} className="text-ink-soft" />
          <span className="sr-only">Search connectors</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${entries.length} services`}
            className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-soft"
            data-testid="catalog-search"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {chip("All", null)}
          {categories.map((c) => chip(c, c))}
        </div>
      </div>
      <p className="text-[12px] text-ink-soft" data-testid="catalog-count">
        {visible.length === entries.length
          ? `${entries.length} services`
          : `${visible.length} of ${entries.length}`}
      </p>
      {visible.length === 0 ? (
        <p className="text-[13px] text-ink-soft">
          No service matches. Any HTTPS API can still be connected with{" "}
          <Link href="/app/integrations/custom-api" className="text-ink underline">
            Custom API
          </Link>
          .
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((entry) => (
            <Link
              key={entry.id}
              href={withReturn(entry.href ?? "#")}
              data-testid={`${entry.id}-integration-link`}
              className="flex flex-col rounded-[14px] border border-line bg-paper-raised p-5 transition-colors hover:bg-black/[0.02]"
            >
              <div className="flex items-center justify-between gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- a small, locally bundled, static brand mark. */}
                <img src={entry.logo} alt="" width={28} height={28} className="shrink-0" loading="lazy" />
                <span className="text-[11px] text-ink-soft">{entry.category}</span>
              </div>
              <h3 className="mt-3 text-[14px] font-semibold text-ink">{entry.name}</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">{entry.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
