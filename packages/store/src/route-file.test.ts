import { expect, test } from "bun:test";
import type { Position3 } from "@gpx-builder/core/server";
import { parseRoute, routeIdOf, serializeRoute } from "./route-file";

const line: Position3[] = [
  [2.7, 48.4, 100],
  [2.71, 48.41, 120.5],
];

test("serialization is canonical: one line, fixed key order", () => {
  expect(serializeRoute(line)).toBe(
    '{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[[2.7,48.4,100],[2.71,48.41,120.5]]}}',
  );
});

test("golden id: these bytes always give this route id", () => {
  expect(String(routeIdOf(serializeRoute(line)))).toBe(
    "route_5c75417c4c219a99",
  );
});

test("same geometry gives the same id, even with sub-precision jitter", () => {
  const jitter: Position3[] = [
    [2.70000001, 48.4, 100.01],
    [2.71, 48.41000002, 120.49],
  ];
  expect(routeIdOf(serializeRoute(jitter))).toBe(
    routeIdOf(serializeRoute(line)),
  );
});

test("different geometry gives a different id", () => {
  const other: Position3[] = [line[0]!, [2.72, 48.41, 120.5]];
  expect(routeIdOf(serializeRoute(other))).not.toBe(
    routeIdOf(serializeRoute(line)),
  );
});

test("round trip", () => {
  expect(parseRoute(serializeRoute(line))).toEqual(line);
});
