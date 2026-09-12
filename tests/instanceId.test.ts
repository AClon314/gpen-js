import { describe, expect, test } from "bun:test";

import { createInstanceId } from "../src/lib/instanceId.ts";

describe("createInstanceId", () => {
  test("returns a non-empty gpen-prefixed id", () => {
    const id = createInstanceId();
    expect(typeof id).toBe("string");
    expect(id.startsWith("gpen-")).toBe(true);
    expect(id.length).toBeGreaterThan("gpen-".length);
  });

  test("returns a different id on every call", () => {
    const ids = new Set(Array.from({ length: 100 }, () => createInstanceId()));
    expect(ids.size).toBe(100);
  });
});
