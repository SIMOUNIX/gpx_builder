export type AdapterError = {
  kind:
    | "rate-limit"
    | "quota"
    | "timeout"
    | "unavailable"
    | "not-found"
    | "invalid";
  message: string;
  retryAfterSec?: number;
};

/**
 * A local file store failed. `corrupt` = unparseable, `invalid` = fails the schema,
 * `unrouted` = an export was refused because `stageIds` have no route yet.
 */
export type StoreError = {
  kind:
    | "not-found"
    | "invalid"
    | "corrupt"
    | "newer-version"
    | "duplicate"
    | "io"
    | "unrouted";
  message: string;
  path?: string;
  stageIds?: string[];
};

export type Result<T, E = AdapterError> =
  { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
