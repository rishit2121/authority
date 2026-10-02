/**
 * A single 1px rule in the marketing hairline color — the redesign's
 * replacement for bordered cards as the primary way to separate content.
 */
export function HairlineDivider({ className = "" }: { className?: string }) {
  return <hr className={`m-0 border-0 border-t border-mkt-hairline ${className}`} />;
}
