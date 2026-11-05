import { tool } from "ai";
import { z } from "zod";
import { exportTrip as exportFiles } from "@gpx-builder/core/server";
import type { AgentDeps } from "../deps";
import { failStore } from "../results";

/** The host asks the user to approve this call before it runs. */
export const exportTrip = (deps: AgentDeps) =>
  tool({
    needsApproval: true,
    description:
      "Write the trip's GPX files (one per day, the merged route, and the waypoints) into the trip folder. Only routed stages are exported. Tell the user, in their language, what will be written before calling it.",
    inputSchema: z.object({}),
    async execute() {
      const written = exportFiles(deps.trips, deps.tripId);
      if (!written.ok) return failStore(written.error);
      return { ok: true as const, files: written.value };
    },
  });
