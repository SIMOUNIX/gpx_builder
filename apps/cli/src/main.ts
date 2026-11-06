import { createInterface } from "node:readline/promises";
import {
  createEnvSecrets,
  createOrsRouter,
  createPhotonGeocoder,
} from "@gpx-builder/adapters";
import {
  ChatId,
  TripId,
  mintTripId,
  type Trip,
  type TripStorePort,
} from "@gpx-builder/core/server";
import {
  createStrongModel,
  pendingQuestion,
  runTurn,
  type PendingQuestion,
} from "@gpx-builder/agent";
import {
  createChatStore,
  createDiskCache,
  createTripStore,
  resolveDirs,
} from "@gpx-builder/store";

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

/** The chat of a trip shares its uuid: `trip_<uuid>` ↔ `chat_<uuid>`. */
export const chatIdOf = (tripId: TripId): ChatId =>
  ChatId.parse(`chat_${tripId.slice("trip_".length)}`);

/** Drops control characters (ANSI/OSC escapes included) from text the model or a provider wrote; keeps \n and \t. */
export const sanitize = (s: string): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");

export const renderQuestion = (q: PendingQuestion): string =>
  q.tool === "export_trip"
    ? "Write the GPX files? [y/N]"
    : sanitize(
        q.options?.length
          ? `${q.question} (${q.options.join(" / ")})`
          : q.question,
      );

export const statusWord = (tool?: string): string =>
  tool === "find_place"
    ? "geocoding…"
    : tool === "route"
      ? "routing…"
      : "thinking…";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const tty = Boolean(process.stdout.isTTY);
const CLEAR = tty ? "\r\x1b[2K" : "";

// Streamed text rarely ends in a newline; end the line before drawing over it.
let midLine = false;
const breakLine = () => {
  if (!midLine) return;
  process.stdout.write("\n");
  midLine = false;
};
const FRAMES = ["⛰", "🏔", "🗻"];

function createSpinner() {
  let timer: ReturnType<typeof setInterval> | undefined;
  let word = statusWord();
  let n = 0;
  const draw = () => process.stdout.write(`${CLEAR}${FRAMES[n++ % 3]} ${word}`);
  return {
    start(tool?: string) {
      if (!tty) return;
      breakLine();
      word = statusWord(tool);
      if (!timer) timer = setInterval(draw, 150);
      draw();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
      process.stdout.write(CLEAR);
    },
  };
}

function printTrips(trips: TripStorePort) {
  const list = trips.list();
  if (!list.ok) return console.error(`error: ${sanitize(list.error.message)}`);
  if (list.value.length === 0) return console.log("no trips yet");
  for (const t of list.value)
    console.log(`${t.id}  ${sanitize(t.name)}  ${t.updatedAt}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(`error: ${args.error}`);
    process.exit(1);
  }
  const dirs = resolveDirs();
  const trips = createTripStore({ tripsDir: dirs.tripsDir });
  if (args.cmd === "trips") return printTrips(trips);

  const secrets = createEnvSecrets();
  const orsKey = await secrets.get("ORS_API_KEY");
  const anthropicKey = await secrets.get("ANTHROPIC_API_KEY");
  if (!orsKey || !anthropicKey) {
    const missing = [
      !orsKey && "ORS_API_KEY",
      !anthropicKey && "ANTHROPIC_API_KEY",
    ].filter(Boolean);
    console.error(`error: missing ${missing.join(" and ")} (set in .env)`);
    process.exit(1);
  }
  const model = await createStrongModel(secrets);
  if (!model.ok) {
    console.error(`error: ${sanitize(model.error.message)}`);
    process.exit(1);
  }

  const cache = createDiskCache({ cacheDir: dirs.cacheDir });
  const chats = createChatStore({ dataDir: dirs.dataDir });

  let tripId: TripId;
  if (args.trip) {
    const parsed = TripId.safeParse(args.trip);
    const loaded = parsed.success ? trips.load(parsed.data) : undefined;
    if (!parsed.success || !loaded?.ok) {
      const why = loaded?.ok === false ? loaded.error.message : "bad trip id";
      console.error(`error: cannot resume ${args.trip}: ${why}`);
      process.exit(1);
    }
    tripId = parsed.data;
    console.log(`resuming "${sanitize(loaded.value.name)}" (${tripId})`);
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
      console.error(`error: ${sanitize(created.error.message)}`);
      process.exit(1);
    }
    tripId = trip.tripId;
    console.log(`new trip ${tripId}`);
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
    const pending = pendingQuestion(chats, chatId);
    if (pending.ok && pending.value) console.log(renderQuestion(pending.value));
  }

  const spinner = createSpinner();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt("> ");
  // Ctrl-C only asks; a second one in a row (or typing exit) quits.
  let armed = false;
  rl.on("SIGINT", () => {
    if (armed) {
      spinner.stop();
      process.exit(0);
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
      spinner.start();
      const r = await runTurn(deps, text, {
        onText: (d) => {
          spinner.stop();
          const clean = sanitize(d);
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
              `${CLEAR}${dim(`${ok ? "✓" : "✗"} ${sanitize(name)}`)}`,
            );
          }
        },
      });
      spinner.stop();
      midLine = false;
      console.log();
      if (!r.ok) console.error(`error: ${sanitize(r.error.message)}`);
      else if (r.value.pending) console.log(renderQuestion(r.value.pending));
    }
    rl.prompt();
  }
  rl.close();
}

if (import.meta.main) await main();
