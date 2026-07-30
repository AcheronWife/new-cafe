import { describe, expect, it } from "vitest";

import { chapterSettlementMatchesActiveLevel } from "../src/servers/gateway-server.js";

describe("chapter settlement session validation", () => {
  const activeLevel = {
    chapter: 3,
    index: 6,
    difficulty: 1,
  };

  it("accepts settlement coordinates for the level entered on this connection", () => {
    expect(chapterSettlementMatchesActiveLevel(activeLevel, 3, 6, 1)).toBe(true);
  });

  it("rejects a stale settlement from another level", () => {
    expect(chapterSettlementMatchesActiveLevel(activeLevel, 3, 5, 1)).toBe(false);
  });

  it("rejects settlement when this connection has not entered a level", () => {
    expect(chapterSettlementMatchesActiveLevel(null, 3, 6, 1)).toBe(false);
  });
});
