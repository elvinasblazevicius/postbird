/**
 * Postbird logo: a swallow carrying a letter, the classic sign of mail and
 * of news from far away. The envelope uses the highlight colour from
 * site.config.ts. Replace this SVG to change the logo (also update
 * src/app/icon.svg, the browser-tab icon).
 */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0B2C78" />
      <g transform="translate(-0.6 -2.3) scale(1.06)">
        <g transform="rotate(-8 26.2 17)">
          <rect x="23.2" y="14.9" width="6.2" height="4.4" rx="0.7" fill="var(--highlight, #FFD23F)" />
          <path d="M23.5 15.3 L26.3 17.4 L29.1 15.3" fill="none" stroke="#0B2C78" strokeWidth="0.7" strokeLinejoin="round" />
        </g>
        <path
          d="M3.4 19.4 L8.6 20.6 C10.4 19.6 11.6 18.6 12.8 17.6 C15 16.1 17.2 13.6 20.2 13.4 C22.2 13.3 23.4 14.2 23.9 15.3 C22.6 18.9 19.4 21.4 15.2 22.2 C12.4 22.7 9.4 22.8 6.6 22.5 L4.6 24.2 L5.6 21.9 Z"
          fill="#fff"
        />
        <path d="M11.6 18.3 C12.6 14.2 14.6 10 18.6 7.2 C18.9 10.6 18.3 13.9 16.4 16.6 Z" fill="#fff" />
        <circle cx="21.3" cy="15" r="0.75" fill="#0B2C78" />
      </g>
    </svg>
  );
}
