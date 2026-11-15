import { useEffect, useId, useRef, useState } from "react";
import { MapPin, Search } from "lucide-react";
import type { Region } from "@/types/domain";
import { searchPlaces } from "@/services/geo";
import { cn } from "@/utils/cn";

/** Accessible combobox searching countries, named regions and coordinates. */
export function PlaceSearch({ onSelect, placeholder = "Search a country, region, or 31.9, 35.9", className, autoFocus }: { onSelect: (r: Region) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Region[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      searchPlaces(q).then((r) => {
        if (alive) {
          setResults(r);
          setActive(0);
        }
      });
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const choose = (r: Region) => {
    onSelect(r);
    setQ("");
    setResults([]);
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-3)]" />
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
        aria-label="Search for a place"
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] pl-9 pr-3 text-sm placeholder:text-[var(--color-ink-4)] hover:border-[var(--color-line-bright)] focus:border-[var(--color-cyan)] focus:outline-none"
      />
      {open && results.length > 0 && (
        <ul id={listId} role="listbox" className="glass absolute z-30 mt-1.5 max-h-72 w-full overflow-auto rounded-[var(--radius-md)] p-1 shadow-[var(--shadow-float)]">
          {results.map((r, i) => (
            <li
              id={`${listId}-${i}`}
              key={r.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm", i === active ? "bg-white/[0.07]" : "")}
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--color-ice)]" />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="label-mono text-[9.5px]">{r.kind === "named" ? "region" : r.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
