import type { StageId } from "@gpx-builder/core/browser";
import { create } from "zustand";

// UI-only state. Server data (trips, chat history) lives in TanStack Query.
type UiState = {
  selectedStageId: StageId | null;
  selectStage: (id: StageId | null) => void;
  mapExpanded: boolean;
  setMapExpanded: (open: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  selectedStageId: null,
  selectStage: (selectedStageId) => set({ selectedStageId }),
  mapExpanded: false,
  setMapExpanded: (mapExpanded) => set({ mapExpanded }),
}));
