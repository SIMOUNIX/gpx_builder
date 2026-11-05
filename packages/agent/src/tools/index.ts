import type { AgentDeps } from "../deps";
import { askUser } from "./ask-user";
import { exportTrip } from "./export-trip";
import { findPlace } from "./find-place";
import { route } from "./route";
import { submitBrief } from "./submit-brief";
import { submitItinerary } from "./submit-itinerary";

/** The M1 tool set, bound to one trip. */
export const createTools = (deps: AgentDeps) => ({
  ask_user: askUser,
  find_place: findPlace(deps),
  submit_brief: submitBrief(deps),
  submit_itinerary: submitItinerary(deps),
  route: route(deps),
  export_trip: exportTrip(deps),
});
