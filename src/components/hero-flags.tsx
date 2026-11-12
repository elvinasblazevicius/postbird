/**
 * The home page's flags: thirty countries where these employers post most (headquarters cities and
 * large duty stations), each once. Decorative, so hidden from screen readers. Phones show the first
 * two rows, unrotated; wide screens the whole tilted mosaic. Files from public/flags (flag-icons).
 */
const CODES = [
  "us", "gb", "ch", "ke", "fr", "de",
  "it", "at", "jp", "in", "br", "za",
  "ng", "eg", "et", "sn", "jo", "lb",
  "th", "ph", "au", "ca", "mx", "co",
  "pa", "tr", "ua", "nl", "be", "dk",
];

export function HeroFlags({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`grid grid-cols-6 gap-2 lg:-rotate-[4deg] lg:gap-3 ${className}`}>
      {CODES.map((code, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={code}
          src={`/flags/${code}.svg`}
          alt=""
          width={80}
          height={60}
          loading={i < 12 ? "eager" : "lazy"}
          decoding="async"
          className={`block aspect-[4/3] w-full rounded-md object-cover shadow-[0_2px_6px_rgba(11,31,58,0.16)] ${i % 2 === 1 ? "lg:mt-3.5" : ""} ${i >= 12 ? "max-lg:hidden" : ""}`}
        />
      ))}
    </div>
  );
}
