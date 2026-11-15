import { Search } from "lucide-react";
import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";

/** The overlay search field shared by the trips and place searches. */
export function SearchInput(props: ComponentProps<"input">) {
  return (
    <div className="relative">
      <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 z-10 size-4" />
      <Input
        {...props}
        className="bg-card/80 rounded-full pl-9 backdrop-blur"
      />
    </div>
  );
}
