interface StatusDotProps {
  /** Tailwind background colour class, e.g. `bg-allow`. */
  className?: string;
  /** Renders the expanding ping ring behind the dot. */
  ping?: boolean;
  size?: number;
}

export function StatusDot({ className = "bg-allow", ping = true, size = 6 }: StatusDotProps) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {ping ? (
        <span
          className={`absolute inset-0 animate-ping rounded-full opacity-75 ${className}`}
          aria-hidden="true"
        />
      ) : null}
      <span className={`relative inline-flex h-full w-full rounded-full ${className}`} aria-hidden="true" />
    </span>
  );
}
