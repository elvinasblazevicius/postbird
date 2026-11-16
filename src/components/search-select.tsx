"use client";

import { useId, useMemo, useRef, useState } from "react";

/**
 * `covers`: places the option stands for, shown when one matches ("Covers Geneva" under Switzerland);
 * `keys`: other names it is found by without saying so (country aliases: "USA", "DRC").
 */
export type SearchOption = { value: string; label: string; covers?: string[]; keys?: string[] };

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * A single choice from a long list that you can type to search (the ARIA combobox pattern: a text
 * field that controls a listbox), for the calculators' duty station pickers. Typing matches the
 * label and the option's other names, best matches first: a name that starts with the text, then a
 * word that does, then anywhere. Down/Up move through the list, Enter picks, Escape closes and puts
 * the current choice back.
 */
export function SearchSelect({ label, options, value, onChange, placeholder, keyPrefix = "" }: {
  label: string;
  /** Shown before the other name a match was found by: "Covers " gives "Covers Geneva". */
  keyPrefix?: string;
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const uid = useId();
  const ids = { input: `ss-input${uid}`, list: `ss-list${uid}`, opt: (i: number) => `ss-opt${uid}-${i}` };
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return options.map((o) => ({ o, via: undefined as string | undefined }));
    const scored: { o: SearchOption; rank: number; via?: string }[] = [];
    // The text from the start of any word ("united st" in "United States", "york" in "USA, New York").
    const words = (text: string) => ` ${fold(text).replace(/[^a-z0-9]+/g, " ").trim()}`;
    const qw = ` ${q.replace(/[^a-z0-9]+/g, " ").trim()}`;
    const startsAWord = (text: string) => words(text).includes(qw);
    for (const o of options) {
      const name = fold(o.label);
      const cover = o.covers?.find(startsAWord);
      let rank = -1;
      if (name.startsWith(q)) rank = 0;
      else if (startsAWord(o.label)) rank = 1;
      else if (cover || o.keys?.some(startsAWord)) rank = 2;
      // Inside a word only for longer text, so "usa" doesn't find "Jerusalem".
      else if (q.length >= 4 && name.includes(q)) rank = 3;
      if (rank >= 0) scored.push({ o, rank, via: rank === 2 ? cover : undefined });
    }
    return scored.sort((a, b) => a.rank - b.rank).map(({ o, via }) => ({ o, via }));
  }, [options, query]);

  function openList() {
    setQuery("");
    setOpen(true);
    const i = options.findIndex((o) => o.value === value);
    setActive(Math.max(0, i));
    // Show the current choice in the list.
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-i="${Math.max(0, i)}"]`)?.scrollIntoView({ block: "center" }));
  }

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  function move(to: number) {
    const i = Math.min(Math.max(to, 0), shown.length - 1);
    setActive(i);
    listRef.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="relative">
      <label htmlFor={ids.input} className="text-sm font-medium text-ink">{label}</label>
      <input
        id={ids.input}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={ids.list}
        aria-autocomplete="list"
        aria-activedescendant={open && shown.length ? ids.opt(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={open ? (placeholder ?? "Type to search") : undefined}
        value={open ? query : (current?.label ?? "")}
        onFocus={openList}
        onClick={() => { if (!open) openList(); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); listRef.current?.scrollTo({ top: 0 }); }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); if (!open) openList(); else move(active + 1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); move(active - 1); }
          else if (e.key === "Enter") { if (open && shown[active]) { e.preventDefault(); pick(shown[active].o.value); } }
          else if (e.key === "Escape") { if (open) { e.preventDefault(); setOpen(false); setQuery(""); } }
        }}
        className="mt-1 block min-h-11 w-full rounded-lg border border-rule bg-paper bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat px-3 pr-9 text-[1rem] text-ink"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4' fill='none' stroke='%23475569' stroke-width='1.6'/%3E%3C/svg%3E\")" }}
      />
      {open ? (
        <ul
          id={ids.list}
          ref={listRef}
          role="listbox"
          aria-label={label}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-lg border border-rule bg-paper py-1 text-[1rem] shadow-lg"
        >
          {shown.length ? shown.map(({ o, via }, i) => (
            <li
              key={o.value}
              id={ids.opt(i)}
              data-i={i}
              role="option"
              aria-selected={o.value === value}
              // Keep focus in the field so the click lands before the list closes.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o.value)}
              onMouseMove={() => { if (active !== i) setActive(i); }}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-tint" : ""} ${o.value === value ? "font-semibold" : ""}`}
            >
              {o.label}
              {via ? <span className="block text-sm font-normal text-slate">{keyPrefix}{via}</span> : null}
            </li>
          )) : <li className="px-3 py-2 text-slate">No duty station matches &ldquo;{query.trim()}&rdquo;</li>}
        </ul>
      ) : null}
    </div>
  );
}
