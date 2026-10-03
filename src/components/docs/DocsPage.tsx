export function DocsPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="max-w-[720px]">
      <h1 className="font-headline-lg text-[1.75rem] font-semibold leading-[1.2] tracking-tight text-ink md:text-[2rem]">
        {title}
      </h1>
      {description ? <p className="mt-2 text-[15px] leading-[1.6] text-ink-soft">{description}</p> : null}
      <div className="docs-prose mt-8 flex flex-col gap-6">{children}</div>
    </article>
  );
}

export function DocsSection({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="flex flex-col gap-3">
      <h2 className="font-headline-sm text-[1.1rem] font-semibold text-ink">{title}</h2>
      <div className="flex flex-col gap-3 text-[14px] leading-[1.65] text-ink-soft [&_a]:underline [&_a]:underline-offset-2 [&_strong]:text-ink [&_code:not(pre_code)]:rounded [&_code:not(pre_code)]:bg-black/[0.05] [&_code:not(pre_code)]:px-1 [&_code:not(pre_code)]:py-0.5 [&_code:not(pre_code)]:font-mono-code [&_code:not(pre_code)]:text-[12.5px] [&_code:not(pre_code)]:text-ink">
        {children}
      </div>
    </section>
  );
}

export function DocsTable({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line bg-paper-raised">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium text-ink">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 align-top text-ink-soft">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
