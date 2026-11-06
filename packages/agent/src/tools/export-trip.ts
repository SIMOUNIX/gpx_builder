import { tool } from "ai";
import { z } from "zod";

/**
 * Client-side like `ask_user`: no `execute`, so the loop stops and the host asks
 * the user y/N. The planner runs the export when the answer is yes.
 */
export const exportTrip = tool({
  description:
    "Write the trip's GPX files (one per day, the merged route, and the waypoints) into the trip folder. Only routed stages are exported. Tell the user, in their language, what will be written before calling it.",
  inputSchema: z.object({}),
});
