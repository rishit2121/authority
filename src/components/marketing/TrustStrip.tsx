const STACK = [
  { label: "OpenAI" },
  { label: "Anthropic" },
  { label: "LangGraph" },
  { label: "MCP Protocol", highlighted: true },
  { label: "GitHub" },
  { label: "PostgreSQL" },
  { label: "Slack" },
  { label: "AWS Bedrock" },
];

export function TrustStrip() {
  return (
    <section className="w-full border-y border-outline-variant/20 bg-band py-space-xl">
      <div className="mx-auto flex max-w-[1280px] flex-col items-center justify-between gap-space-lg px-margin md:flex-row md:px-margin-lg">
        <p className="shrink-0 font-mono-code text-[11px] uppercase tracking-wider text-outline">
          Designed to work across the modern agent stack
        </p>
        <div className="flex flex-wrap items-center gap-x-space-xl gap-y-space-md font-headline-sm text-body-md text-on-surface-variant">
          {STACK.map((item) => (
            <span
              key={item.label}
              className={`flex cursor-default items-center gap-1.5 transition-colors hover:text-on-surface ${
                item.highlighted ? "font-medium text-primary" : ""
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${item.highlighted ? "bg-primary" : "bg-primary/40"}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
