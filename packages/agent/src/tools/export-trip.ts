import { tool } from "ai";
import { z } from "zod";

/**
 * Client-side like `ask_user`: no `execute`, so the loop stops and the host asks
 * the user y/N. The planner runs the export when the answer is yes.
 */
export const exportTrip = tool({
  description:
    "Write the trip's GPX files (one per day, the merged route, and the waypoints) into the trip folder. Every stage must be routed first: the export is refused otherwise and lists the unrouted stage ids. Tell the user, in their language, what will be written before calling it. Calling it asks the user yes/no, so do not ask for confirmation first.",
  inputSchema: z.object({}),
});
