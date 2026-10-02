/**
 * Standard eyebrow + heading + optional one-line description for a marketing
 * section. Deliberately plain: no card, no border, no background — typography
 * and whitespace carry the hierarchy.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
}) {
  const alignment = align === "center" ? "text-center items-center mx-auto" : "text-left items-start";
  return (
    <div className={`flex max-w-2xl flex-col gap-3 ${alignment}`}>
      {eyebrow ? (
        <span className="font-headline-sm text-mkt-eyebrow uppercase tracking-wider text-mkt-indigo">
          {eyebrow}
        </span>
      ) : null}
      <h2 className="font-headline-lg text-mkt-h2-mobile text-mkt-text md:text-mkt-h2">{title}</h2>
      {description ? (
        <p className="font-body-md text-mkt-body text-mkt-text-secondary">{description}</p>
      ) : null}
    </div>
  );
}
