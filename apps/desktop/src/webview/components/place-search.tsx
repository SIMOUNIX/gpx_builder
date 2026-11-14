import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { trpc } from "@/api";
import type { LngLat } from "@gpx-builder/core/browser";

type Candidate = {
  placeId: string;
  label: string;
  kind: string;
  lngLat: LngLat;
};

// Waits for typing to pause so the public geocoder isn't hit on every keystroke.
function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Search box overlaid on the map: type a place, pick a result, `onPick` flies there. Saves nothing. */
export function PlaceSearch({ onPick }: { onPick: (c: Candidate) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const query = useDebounced(text.trim(), 400);
  const enabled = query.length >= 3;
  const { data, isError, isFetching } = useQuery({
    ...trpc.places.search.queryOptions({ query }),
    enabled,
    retry: false,
  });

  // Stale `data` stays visible while the next query loads; hide it until it settles.
  const settled = enabled && query === text.trim() && !isFetching;
  const note = !settled
    ? undefined
    : isError
      ? "Search unavailable"
      : data?.length === 0
        ? "No results"
        : undefined;

  return (
    <div className="absolute top-2.5 left-2.5 w-72">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          value={text}
          placeholder="Search a place"
          aria-label="Search a place"
          className="bg-background pl-8"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        />
      </div>
      {open && settled && (
        <ul className="bg-background mt-1 max-h-72 overflow-y-auto rounded-md border text-sm shadow-xs">
          {note && <li className="text-muted-foreground px-3 py-2">{note}</li>}
          {!isError &&
            data?.map((c) => (
              <li key={c.placeId}>
                <button
                  className="hover:bg-accent flex w-full flex-col px-3 py-2 text-left"
                  onClick={() => {
                    onPick(c);
                    setOpen(false);
                  }}
                >
                  <span>{c.label}</span>
                  <span className="text-muted-foreground text-xs">
                    {c.kind}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
