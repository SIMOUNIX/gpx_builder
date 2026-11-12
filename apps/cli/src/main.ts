import { createInterface } from "node:readline/promises";
import {
  createSecrets,
  createOrsRouter,
  type AppSecrets,
  createPhotonGeocoder,
} from "@gpx-builder/adapters";
import {
  TripId,
  chatIdOf,
  mintTripId,
  type Trip,
  type TripStorePort,
} from "@gpx-builder/core/server";
import {
  createStrongModel,
  pendingQuestion,
  providerFromEnv,
  providerKey,
  runTurn,
  toolCallingSelfTest,
  type PendingQuestion,
} from "@gpx-builder/agent";
import {
  createChatStore,
  createDiskCache,
  createTripStore,
  resolveDirs,
} from "@gpx-builder/store";

export { chatIdOf };

export type Args =
  | { cmd: "repl" | "trips"; trip?: string; verbose: boolean }
  | { error: string };

export function parseArgs(argv: string[]): Args {
  let cmd: "repl" | "trips" = "repl";
  let trip: string | undefined;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "trips") cmd = "trips";
    else if (a === "--verbose") verbose = true;
    else if (a === "--trip") {
      trip = argv[++i];
      if (!trip) return { error: "--trip needs a trip id" };
    } else return { error: `unknown argument ${a}` };
  }
  return { cmd, trip, verbose };
}

/** Drops control characters (ANSI/OSC escapes included) from text the model or a provider wrote; keeps \n and \t. */
export const sanitize = (s: string): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");

/** `style` lets the host dim the options; the default is plain text. */
export const renderQuestion = (
  q: PendingQuestion,
  style: (s: string) => string = (s) => s,
): string =>
  q.tool === "export_trip"
    ? "Write the GPX files? [y/N]"
    : q.options?.length
      ? `${sanitize(q.question)} ${style(`(${sanitize(q.options.join(" / "))})`)}`
      : sanitize(q.question);

export const statusWord = (tool?: string): string =>
  tool === "find_place"
    ? "geocoding…"
    : tool === "route"
      ? "routing…"
      : "thinking…";

const tty = Boolean(process.stdout.isTTY);
// Colors only on a terminal, and never when NO_COLOR is set.
const color = tty && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) =>
  color ? `\x1b[${code}m${s}\x1b[0m` : s;
const dim = paint("2");
const bold = paint("1");
const red = paint("31");
const green = paint("1;32");
const yellow = paint("1;33");
const cyan = paint("36");
const banner = (name: string, id: string) =>
  console.log(`${bold("⛰ gpx-builder")} ${dim("·")} ${name} ${dim(`· ${id}`)}`);
const fail = (msg: string) => console.error(red(`✗ error: ${msg}`));
const ask = (q: PendingQuestion) =>
  console.log(`${yellow("?")} ${renderQuestion(q, dim)}`);
const CLEAR = tty ? "\r\x1b[2K" : "";

// Streamed text rarely ends in a newline; end the line before drawing over it.
let midLine = false;
const breakLine = () => {
  if (!midLine) return;
  process.stdout.write("\n");
  midLine = false;
};
const LOGO = "⛰"; // one fixed glyph: ⛰ 🏔 🗻 differ in width and shifted the line

function createSpinner() {
  let active = false;
  return {
    start(tool?: string) {
      if (!tty) return;
      breakLine();
      active = true;
      process.stdout.write(`${CLEAR}${LOGO} ${dim(statusWord(tool))}`);
    },
    stop() {
      if (!active) return;
      active = false;
      process.stdout.write(CLEAR);
    },
  };
}

function printTrips(trips: TripStorePort) {
  const list = trips.list();
  if (!list.ok) return fail(`${sanitize(list.error.message)}`);
  if (list.value.length === 0) return console.log("no trips yet");
  const names = list.value.map((t) => sanitize(t.name));
  const width = Math.max(...names.map((n) => n.length));
  list.value.forEach((t, i) =>
    console.log(
      `${dim(t.id)}  ${bold(names[i]!.padEnd(width))}  ${dim(t.updatedAt)}`,
    ),
  );
}

/** What `main` calls out to; tests swap these so no key, network or model is needed. */
export type Collaborators = {
  secrets: AppSecrets;
  createStrongModel: typeof createStrongModel;
  toolCallingSelfTest: typeof toolCallingSelfTest;
  pendingQuestion: typeof pendingQuestion;
  runTurn: typeof runTurn;
};

export async function main(
  argv = process.argv.slice(2),
  c: Collaborators = {
    secrets: createSecrets(),
    createStrongModel,
    toolCallingSelfTest,
    pendingQuestion,
    runTurn,
  },
) {
  const args = parseArgs(argv);
  if ("error" in args) {
    fail(`${args.error}`);
    process.exit(1);
  }
  const dirs = resolveDirs();
  const trips = createTripStore({ tripsDir: dirs.tripsDir });
  if (args.cmd === "trips") return printTrips(trips);

  const { secrets } = c;
  const provider = providerFromEnv(process.env);
  if (!provider.ok) {
    fail(sanitize(provider.error.message));
    process.exit(1);
  }
  const modelKey = providerKey(provider.value);
  const orsKey = await secrets.get("ORS_API_KEY");
  const modelKeyValue = await secrets.get(modelKey);
  if (!orsKey || !modelKeyValue) {
    const missing = [
      !orsKey && "ORS_API_KEY",
      !modelKeyValue && modelKey,
    ].filter(Boolean);
    fail(`missing ${missing.join(" and ")} (set in .env)`);
    process.exit(1);
  }
  const sources = await Promise.all(
    ["ORS_API_KEY", modelKey].map(
      async (n) => `${n} ← ${await secrets.sourceOf(n)}`,
    ),
  );
  console.log(dim(`secrets: ${sources.join(", ")}`));
  const model = await c.createStrongModel(secrets, provider.value);
  if (!model.ok) {
    fail(`${sanitize(model.error.message)}`);
    process.exit(1);
  }
  const selfTest = await c.toolCallingSelfTest(model.value);
  if (!selfTest.ok)
    console.log(
      yellow(`warning: ${provider.value} tool-calling self-test failed: `) +
        sanitize(selfTest.error.message),
    );

  const cache = createDiskCache({ cacheDir: dirs.cacheDir });
  const chats = createChatStore({ dataDir: dirs.dataDir });

  let tripId: TripId;
  if (args.trip) {
    const parsed = TripId.safeParse(args.trip);
    const loaded = parsed.success ? trips.load(parsed.data) : undefined;
    if (!parsed.success || !loaded?.ok) {
      const why = loaded?.ok === false ? loaded.error.message : "bad trip id";
      fail(`cannot resume ${args.trip}: ${why}`);
      process.exit(1);
    }
    tripId = parsed.data;
    banner(sanitize(loaded.value.name), tripId);
  } else {
    const at = new Date().toISOString();
    const trip: Trip = {
      v: 1,
      tripId: mintTripId(),
      name: "Untitled trip",
      createdAt: at,
      updatedAt: at,
      brief: {},
      stages: [],
      waypoints: {},
      registry: { places: {}, pois: {} },
    };
    const created = trips.create(trip);
    if (!created.ok) {
      fail(`${sanitize(created.error.message)}`);
      process.exit(1);
    }
    tripId = trip.tripId;
    banner(trip.name, tripId);
  }
  const chatId = chatIdOf(tripId);

  const deps = {
    tripId,
    trips,
    geocode: createPhotonGeocoder({ cache }),
    routing: createOrsRouter({ apiKey: orsKey, cache }),
    chats,
    chatId,
    model: model.value,
  };

  if (args.trip) {
    const pending = c.pendingQuestion(chats, chatId);
    if (pending.ok && pending.value) ask(pending.value);
  }

  // A new trip nobody wrote to is not worth keeping.
  let sent = false;
  const quit = (): never => {
    if (!args.trip && !sent) trips.delete(tripId);
    process.exit(0);
  };

  const spinner = createSpinner();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt(`${green("›")} `);
  // Ctrl-C only asks; a second one in a row (or typing exit) quits.
  let armed = false;
  rl.on("SIGINT", () => {
    if (armed) {
      spinner.stop();
      quit();
    }
    armed = true;
    spinner.stop();
    breakLine();
    console.log("\n(press Ctrl-C again or type exit to quit)");
    rl.prompt(true);
  });
  rl.prompt();
  for await (const line of rl) {
    armed = false;
    const text = line.trim();
    if (text === "/quit" || text === "exit") break;
    if (text === "/trips") printTrips(trips);
    else if (text) {
      sent = true;
      let labeled = false;
      spinner.start();
      const r = await c.runTurn(deps, text, {
        onText: (d) => {
          spinner.stop();
          const clean = sanitize(d);
          if (!labeled && clean) {
            process.stdout.write(`${cyan("gpx")} `);
            labeled = true;
          }
          if (clean) midLine = !clean.endsWith("\n");
          process.stdout.write(clean);
        },
        onToolCall: (name, input) => {
          spinner.start(name);
          if (args.verbose) {
            breakLine();
            console.log(
              `${CLEAR}${dim(`→ ${sanitize(name)} ${JSON.stringify(input)}`)}`,
            );
          }
        },
        onToolResult: (name, ok) => {
          if (args.verbose) {
            breakLine();
            console.log(
              `${CLEAR}${ok ? green("✓") : red("✗")} ${dim(sanitize(name))}`,
            );
          }
        },
      });
      spinner.stop();
      midLine = false;
      console.log();
      if (!r.ok) fail(`${sanitize(r.error.message)}`);
      else if (r.value.pending) ask(r.value.pending);
    }
    rl.prompt();
  }
  rl.close();
  quit();
}

if (import.meta.main) await main();
