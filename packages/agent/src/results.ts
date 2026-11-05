import type { AdapterError, StoreError } from "@gpx-builder/core/server";
import type { z } from "zod";

/** One thing the model must fix, with the path of the input it concerns. */
export type Issue = { path: string; message: string };

/** What a tool returns when it did nothing: `issues` to fix, or an `error` to report. */
export type Failure = { ok: false; issues?: Issue[]; error?: string };

export const issuesOf = (error: z.ZodError): Issue[] =>
  error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));

export const failIssues = (issues: Issue[]): Failure => ({ ok: false, issues });

export const failStore = (e: StoreError): Failure => ({
  ok: false,
  error: `${e.kind}: ${e.message}`,
});

export const failAdapter = (e: AdapterError): Failure => ({
  ok: false,
  error: `${e.kind}: ${e.message}`,
});
