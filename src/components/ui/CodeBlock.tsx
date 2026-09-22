import type { ReactNode } from "react";

interface CodeBlockProps {
  children: ReactNode;
  className?: string;
}

/**
 * Pre-formatted source listing. Highlighting is authored inline with the token
 * components below rather than pulled from a syntax-highlighting runtime — the
 * snippets are static marketing copy and never change.
 */
export function CodeBlock({ children, className = "" }: CodeBlockProps) {
  return (
    <pre
      className={`overflow-x-auto font-mono-code text-[12px] leading-relaxed text-on-surface ${className}`}
    >
      <code>{children}</code>
    </pre>
  );
}

type TokenProps = { children: ReactNode };

export const CodeKey = ({ children }: TokenProps) => <span className="text-primary">{children}</span>;
export const CodeString = ({ children }: TokenProps) => <span className="text-allow">{children}</span>;
export const CodeDeny = ({ children }: TokenProps) => <span className="text-error">{children}</span>;
export const CodeValue = ({ children }: TokenProps) => <span className="text-secondary">{children}</span>;
export const CodeKeyword = ({ children }: TokenProps) => <span className="text-secondary">{children}</span>;
export const CodeComment = ({ children }: TokenProps) => <span className="text-outline">{children}</span>;
export const CodePlain = ({ children }: TokenProps) => <span className="text-on-surface">{children}</span>;
export const CodeMuted = ({ children }: TokenProps) => (
  <span className="text-on-surface-variant">{children}</span>
);
