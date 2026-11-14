import type { LngLat, Position3 } from "@gpx-builder/core/browser";
import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ElevationProfile } from "./elevation-profile";
import { MapView, type MapRoute } from "./map-view";

// The profile hover point lives here, not in TripView, so hovering re-renders only this subtree and not the chat.
export function ExpandedMap({
  routes,
  stages,
  onClose,
}: {
  routes: MapRoute[] | undefined;
  stages: { stageId: string; line: Position3[] }[] | undefined;
  onClose: () => void;
}) {
  const [hover, setHover] = useState<LngLat | null>(null);
  return (
    <div className="bg-background absolute inset-0 flex flex-col">
      <MapView routes={routes} marker={hover} className="min-h-0 flex-1" />
      {stages && (
        <div className="border-t p-3">
          <ElevationProfile stages={stages} onHover={setHover} />
        </div>
      )}
      <Button
        size="icon"
        variant="secondary"
        className="absolute top-3 right-3 rounded-full"
        onClick={onClose}
        aria-label="Close map"
      >
        <X />
      </Button>
    </div>
  );
}
