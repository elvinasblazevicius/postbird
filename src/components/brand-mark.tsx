/** Simple globe-and-meridian mark. Replace this SVG to change the logo. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--brand)" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="white" strokeWidth="1.6" />
      <ellipse cx="16" cy="16" rx="4.2" ry="9.5" fill="none" stroke="white" strokeWidth="1.4" />
      <path d="M6.8 13.2h18.4M6.8 18.8h18.4" stroke="white" strokeWidth="1.2" strokeOpacity="0.75" />
    </svg>
  );
}
