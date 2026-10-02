export interface StatusRowItem {
  label: string;
  value: number | string;
  /** Rare: only for a value that itself needs a warning color, e.g. a nonzero denied count. */
  emphasis?: "attention";
}

/**
 * A compact strip of a few key numbers, separated by hairlines rather than
 * boxed into individual cards — used where a page needs an at-a-glance
 * summary without competing with the content below it for visual weight.
 */
export function StatusRow({ items }: { items: StatusRowItem[] }) {
  return (
    <div className="flex flex-wrap divide-x divide-line rounded-[10px] border border-line bg-paper-raised">
      {items.map((item) => (
        <div key={item.label} className="min-w-[140px] flex-1 px-5 py-4">
          <div className="text-[13px] text-ink-soft">{item.label}</div>
          <div
            className={`mt-1 text-[26px] font-semibold leading-none ${
              item.emphasis === "attention" && Number(item.value) > 0 ? "text-deny" : "text-ink"
            }`}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
