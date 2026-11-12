import { randomBytes } from "node:crypto";
import { resolveDirs, acquireInstanceLock } from "@gpx-builder/store";
import { compose } from "./composition-root";
import { startServer } from "./server";

// Headless entry (`bun run serve`): the Electrobun shell replaces this later.
// ponytail: dev origin only; the real webview origin is decided with Electrobun.
const allowedOrigins = (
  process.env.GPX_BUILDER_ALLOWED_ORIGINS ?? "http://localhost:5173"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (import.meta.main) {
  // One writer per store: refuse to start next to another running instance.
  const lock = acquireInstanceLock(resolveDirs().dataDir);
  if (!lock.ok) {
    console.error("another gpx-builder instance is running");
    process.exit(1);
  }
  process.on("exit", lock.value.release);
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.on(sig, () => process.exit(0));

  const token = randomBytes(32).toString("hex");
  const { url } = startServer({
    token,
    allowedOrigins,
    deps: await compose(),
  });
  // Dev webview link (read once by the webview's dev-only `?api=&token=` handling, then stripped).
  const open = new URL(allowedOrigins[0] ?? "http://localhost:5173");
  open.search = new URLSearchParams({ api: url, token }).toString();
  console.log(`listening on ${url}\nopen ${open}`);
}
