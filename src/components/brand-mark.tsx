/**
 * Logo mark: a globe drawn as the letter G, with the "hub" as a dot where the
 * bar of the G meets the centre. Replace this SVG to change the logo.
 */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0B2C78" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="white" strokeOpacity="0.08" />
      <ellipse cx="16" cy="16" rx="4.1" ry="9" fill="none" stroke="white" strokeOpacity="0.45" strokeWidth="1.3" />
      <path d="M22.9 10.2A9 9 0 1 0 25 16h-6.4" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="2.5" fill="var(--highlight)" />
    </svg>
  );
}
