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

export type Result<T, E = AdapterError> =
  { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
