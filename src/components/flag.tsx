/**
 * Small country flag (4:3) from public/flags, copied from the flag-icons
 * package at build time. Decorative: the country name is always shown next
 * to it, so the image has empty alt text.
 */
export function Flag({ code, className = "" }: { code: string | null | undefined; className?: string }) {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flags/${code.toLowerCase()}.svg`}
      alt=""
      aria-hidden="true"
      width={20}
      height={15}
      decoding="async"
      className={`inline-block h-[0.9em] w-auto shrink-0 rounded-[2px] shadow-[0_0_0_1px_rgba(11,27,63,0.12)] ${className}`}
    />
  );
}
