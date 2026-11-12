import { expect, test } from "bun:test";
import { parseDevBackend } from "./backend";

test("parseDevBackend reads the query, else the stored value", () => {
  const b = { url: "http://127.0.0.1:1234", token: "abc" };
  expect(parseDevBackend("?api=http://127.0.0.1:1234&token=abc", null)).toEqual(
    b,
  );
  expect(parseDevBackend("", JSON.stringify(b))).toEqual(b);
  expect(parseDevBackend("?api=x", null)).toBeUndefined();
  expect(parseDevBackend("", "not json")).toBeUndefined();
  expect(parseDevBackend("", '{"url":"u"}')).toBeUndefined();
});
