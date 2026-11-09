"use client";

import { useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

export type ComboOption = { value: string; name: string; count?: number };
export type ComboGroup = { label: string; options: ComboOption[] };

/** Most options listed at once; typing narrows the rest down. */
const SHOWN = 60;

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** True once the page has hydrated (false on the server and during hydration), so the no-JS form is what is first rendered. */
const noop = () => () => {};
function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}

/**
 * A type-ahead multi-select (the ARIA combobox pattern: a text input that controls a listbox) for
 * the Organization and Where fields. Each choice becomes a chip and a hidden field of the same name
 * as the native selects it replaces, so the URL parameters are identical ("where=region-africa&where=kenya",
 * "org=unicef"). `children` is the no-JavaScript fallback (the native selects), rendered on the
 * server and until the page has hydrated.
 *
 * Keyboard: Down/Up open the list and move through it, Enter adds the highlighted option, Escape
 * closes the list (or clears the text), Backspace in an empty field removes the last chip. Each
 * chip has its own remove button. Additions and removals are announced in a polite live region.
 * In a form with AutoSubmit (the desktop filter panel), a change applies at once (data-autosubmit).
 */
export function MultiCombobox({ name, label, idPrefix, groups, chosen: initial, max, placeholder, itemNoun, itemsNoun, anyHint, children }: {
  name: string;
  label: string;
  idPrefix: string;
  groups: ComboGroup[];
  chosen: string[];
  max: number;
  placeholder: string;
  itemNoun: string;
  itemsNoun: string;
  /** "Jobs in any of the places you choose." */
  anyHint: string;
  children: React.ReactNode;
}) {
  const hydrated = useHydrated();
  const uid = useId();
  const base = `${idPrefix}-${name}-combo`;
  const ids = { label: `${base}-label${uid}`, input: `${base}${uid}`, list: `${base}-list${uid}`, hint: `${base}-hint${uid}` };
  const [chosen, setChosen] = useState<string[]>(initial);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [announce, setAnnounce] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLDivElement>(null);

  const byValue = useMemo(() => new Map(groups.flatMap((g) => g.options.map((o) => [o.value, o] as const))), [groups]);
  const nameOf = (v: string) => byValue.get(v)?.name ?? v;

  // The options that match what is typed (any word starting with it first, then anywhere in the name), not yet chosen.
  const { shown, hidden } = useMemo(() => {
    const q = fold(query.trim());
    let total = 0;
    const out: { label: string; options: ComboOption[] }[] = [];
    for (const g of groups) {
      const matches = g.options.filter((o) => !chosen.includes(o.value) && (!q || fold(o.name).includes(q)));
      if (q) {
        const starts = (o: ComboOption) => fold(o.name).split(/[^a-z0-9]+/).some((w) => w.startsWith(q));
        matches.sort((a, b) => Number(starts(b)) - Number(starts(a)));
      }
      const room = Math.max(0, SHOWN - total);
      if (matches.length && room) out.push({ label: g.label, options: matches.slice(0, room) });
      total += matches.length;
    }
    const listed = out.reduce((n, g) => n + g.options.length, 0);
    return { shown: out, hidden: total - listed };
  }, [groups, chosen, query]);
  const flat = shown.flatMap((g) => g.options);
  const activeIndex = Math.min(active, Math.max(0, flat.length - 1));
  const optionId = (i: number) => `${base}-opt-${i}${uid}`;
  const full = chosen.length >= max;

  /** Tell a form with AutoSubmit that the choice changed (after React has updated the hidden fields). */
  const changed = () => {
    setTimeout(() => changeRef.current?.dispatchEvent(new Event("change", { bubbles: true })), 0);
  };
  const add = (o: ComboOption) => {
    if (full || chosen.includes(o.value)) return;
    const next = [...chosen, o.value];
    setChosen(next);
    setQuery("");
    setOpen(false);
    setActive(0);
    setAnnounce(`${o.name} added. ${next.length} of ${max} ${itemsNoun} chosen.`);
    changed();
  };
  const remove = (value: string, refocus = true) => {
    const next = chosen.filter((v) => v !== value);
    setChosen(next);
    setAnnounce(`${nameOf(value)} removed. ${next.length ? `${next.length} of ${max} ${itemsNoun} chosen.` : `No ${itemsNoun} chosen.`}`);
    if (refocus) inputRef.current?.focus();
    changed();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(e.key === "ArrowDown" ? 0 : Math.max(0, flat.length - 1));
        return;
      }
      if (!flat.length) return;
      setActive((activeIndex + (e.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length);
    } else if (e.key === "Enter") {
      // With the list open, Enter picks the highlighted option; otherwise it submits the form as usual.
      if (open && flat[activeIndex]) {
        e.preventDefault();
        add(flat[activeIndex]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      } else if (query) {
        e.preventDefault();
        setQuery("");
      }
    } else if (e.key === "Backspace" && !query && chosen.length) {
      remove(chosen[chosen.length - 1]);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  if (!hydrated) return <>{children}</>;

  // Where each group's options start in the flat list (for the option ids and the highlight).
  const starts = shown.map((_, gi) => shown.slice(0, gi).reduce((n, g) => n + g.options.length, 0));
  return (
    <div ref={changeRef} data-autosubmit="true" role="group" aria-labelledby={ids.label}>
      <label id={ids.label} htmlFor={ids.input} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      {chosen.map((v) => <input key={v} type="hidden" name={name} value={v} />)}
      {chosen.length ? (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={`Chosen ${itemsNoun}`}>
          {chosen.map((v) => (
            <li key={v} className="inline-flex max-w-full items-center rounded-md border border-rule bg-tint text-sm text-ink">
              <span className="min-w-0 truncate py-1 pl-2.5">{nameOf(v)}</span>
              <button
                type="button"
                onClick={() => remove(v)}
                aria-label={`Remove ${nameOf(v)}`}
                className="ml-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate hover:bg-rule hover:text-ink"
              >
                <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative">
        <input
          ref={inputRef}
          id={ids.input}
          type="text"
          role="combobox"
          aria-expanded={open && !full}
          aria-controls={ids.list}
          aria-autocomplete="list"
          aria-activedescendant={open && flat.length && !full ? optionId(activeIndex) : undefined}
          aria-describedby={ids.hint}
          readOnly={full}
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={full ? `Up to ${max} ${itemsNoun}` : chosen.length ? `Add another ${itemNoun}` : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(false)}
          onClick={() => !full && setOpen((o) => !o)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="w-full rounded-lg border border-rule bg-paper px-3 py-2.5 pr-8 text-[0.95rem] text-ink placeholder:text-slate focus:border-accent focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)] read-only:bg-mist"
        />
        <svg viewBox="0 0 12 12" className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-slate" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        <ul
          id={ids.list}
          role="listbox"
          aria-label={label}
          hidden={!open || full}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-rule bg-paper py-1 text-[0.95rem] shadow-[0_8px_24px_rgba(14,31,61,0.12)]"
        >
          {shown.map((g, gi) => (
            <li key={g.label || gi} role="presentation">
              {g.label ? <div id={`${base}-g${gi}${uid}`} role="presentation" className="px-3 pb-1 pt-2 text-xs font-medium text-slate">{g.label}</div> : null}
              <ul role="group" aria-labelledby={g.label ? `${base}-g${gi}${uid}` : undefined} aria-label={g.label ? undefined : label}>
                {g.options.map((o, oi) => {
                  const i = starts[gi] + oi;
                  const isActive = i === activeIndex;
                  return (
                    <li
                      key={o.value}
                      id={optionId(i)}
                      role="option"
                      aria-selected={isActive}
                      // Keep the focus in the input while choosing with the mouse.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => setActive(i)}
                      onClick={() => add(o)}
                      className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 ${isActive ? "bg-mist text-accent" : "text-ink"}`}
                    >
                      <span className="min-w-0">{o.name}</span>
                      {o.count !== undefined ? <span className="shrink-0 text-sm tabular-nums text-slate">{o.count}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {!flat.length ? <li role="presentation" className="px-3 py-2 text-slate">No {itemsNoun} match &ldquo;{query}&rdquo;</li> : null}
          {hidden > 0 ? <li role="presentation" className="px-3 py-2 text-xs text-slate">{hidden} more: keep typing to narrow the list</li> : null}
        </ul>
      </div>
      <p id={ids.hint} className="mt-1 text-xs text-slate">
        {full ? `Up to ${max} ${itemsNoun}. Remove one to add another.` : `Type to search, or press the down arrow for the list. ${anyHint}.`}
      </p>
      <p className="sr-only" aria-live="polite">{announce}</p>
    </div>
  );
}
