export type Backend = { url: string; token: string };

declare global {
  // Set by the Electrobun preload before the bundle loads.
  var __GPX_BACKEND__: Backend | undefined;
}

let backend: Backend | undefined;

/** Production: the shell's preload (or a test) hands over the loopback origin and token. */
export function setBackend(b: Backend) {
  backend = b;
}

const KEY = "gpx-dev-backend";

const asBackend = (
  url: string | null | undefined,
  token: string | null | undefined,
) => (url && token ? { url, token } : undefined);

/** `?api=<url>&token=<token>` first, else what an earlier load stored. */
export function parseDevBackend(
  search: string,
  stored: string | null,
): Backend | undefined {
  const q = new URLSearchParams(search);
  const fromUrl = asBackend(q.get("api"), q.get("token"));
  if (fromUrl || !stored) return fromUrl;
  try {
    const b = JSON.parse(stored) as Partial<Backend>;
    return asBackend(b.url, b.token);
  } catch {
    return undefined;
  }
}

export function getBackend(): Backend {
  backend ??= globalThis.__GPX_BACKEND__;
  // A dev exception to §3.1; `import.meta.env.DEV` is false in a build, so the token is never read from the URL there.
  if (!backend && import.meta.env.DEV) {
    const found = parseDevBackend(location.search, sessionStorage.getItem(KEY));
    if (found) {
      sessionStorage.setItem(KEY, JSON.stringify(found));
      history.replaceState(null, "", location.pathname + location.hash); // keep the token out of the URL bar
      backend = found;
    }
  }
  if (!backend)
    throw new Error("no backend: open the link printed by `bun run serve`");
  return backend;
}
