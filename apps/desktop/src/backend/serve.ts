import { randomBytes } from "node:crypto";
import { compose } from "./composition-root";
import { startServer } from "./server";

// Headless entry (`bun run serve`): the Electrobun shell replaces this later.
// ponytail: dev origin only; the real webview origin is decided with Electrobun.
const allowedOrigins = (
  process.env.GPX_BUILDER_ALLOWED_ORIGINS ?? "http://localhost:5173"
).split(",");

if (import.meta.main) {
  const token = randomBytes(32).toString("hex");
  const { url } = startServer({
    token,
    allowedOrigins,
    deps: await compose(),
  });
  console.log(`listening on ${url}\ntoken ${token}`);
}
