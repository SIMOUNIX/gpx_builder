import { expect, test } from "bun:test";
import { mintTripId as fromBrowser } from "@gpx-builder/core/browser";
import { mintTripId as fromServer } from "@gpx-builder/core/server";
import { createTripStore } from "@gpx-builder/store";
import { createPhotonGeocoder } from "@gpx-builder/adapters";
import { createTools } from "@gpx-builder/agent";
import { mintTripId } from "@gpx-builder/core/server";
import { chatIdOf, parseArgs, renderQuestion, statusWord } from "./main";

test("workspace packages resolve", () => {
  expect(fromBrowser).toBe(fromServer);
  expect(typeof createTripStore).toBe("function");
  expect(typeof createPhotonGeocoder).toBe("function");
  expect(typeof createTools).toBe("function");
});

test("parseArgs reads the command, --trip and --verbose", () => {
  expect(parseArgs([])).toEqual({
    cmd: "repl",
    trip: undefined,
    verbose: false,
  });
  expect(parseArgs(["trips"])).toMatchObject({ cmd: "trips" });
  expect(parseArgs(["--verbose", "--trip", "trip_x"])).toEqual({
    cmd: "repl",
    trip: "trip_x",
    verbose: true,
  });
  expect(parseArgs(["--trip"])).toHaveProperty("error");
  expect(parseArgs(["--home", "x"])).toHaveProperty("error");
});

test("the chat id shares the trip's uuid", () => {
  const t = mintTripId();
  expect(String(chatIdOf(t))).toBe(`chat_${t.slice("trip_".length)}`);
});

test("questions show their options inline", () => {
  expect(
    renderQuestion({ tool: "ask_user", toolCallId: "c", question: "Where?" }),
  ).toBe("Where?");
  expect(
    renderQuestion({
      tool: "ask_user",
      toolCallId: "c",
      question: "Where?",
      options: ["A", "B"],
    }),
  ).toBe("Where? (A / B)");
});

test("the export approval is a plain y/N prompt", () => {
  expect(renderQuestion({ tool: "export_trip", toolCallId: "c" })).toBe(
    "Write the GPX files? [y/N]",
  );
});

test("tools map to a status word", () => {
  expect(statusWord("find_place")).toBe("geocoding…");
  expect(statusWord("route")).toBe("routing…");
  expect(statusWord("submit_brief")).toBe("thinking…");
  expect(statusWord()).toBe("thinking…");
});
