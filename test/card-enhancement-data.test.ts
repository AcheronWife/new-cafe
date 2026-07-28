import { describe, expect, it } from "vitest";

import {
  addCardExperience,
  CARD_EXP_MATERIALS,
  parseCardEnhancementRequest,
} from "../src/game-data/card-enhancement-data.js";

describe("card enhancement data", () => {
  it("parses the request observed in the tutorial", () => {
    expect(
      parseCardEnhancementRequest({
        guid: 10_003,
        clientSkillLv: 0,
        clientlv: 1,
        items: [[1, 1, 1]],
      }),
    ).toEqual({
      guid: 10_003,
      clientLevel: 1,
      clientSkillLevel: 0,
      materials: [{ kind: 1, reference: 1, count: 1 }],
    });
  });

  it("unwraps the LuaCall envelope received by the gateway", () => {
    expect(
      parseCardEnhancementRequest({
        sCmd: 5,
        tbParam: {
          guid: 10_003,
          clientSkillLv: 0,
          clientlv: 2,
          items: [[1, 6, 1]],
        },
      }),
    ).toEqual({
      guid: 10_003,
      clientLevel: 2,
      clientSkillLevel: 0,
      materials: [{ kind: 1, reference: 6, count: 1 }],
    });
  });

  it("maps client material indices in CardCommon order", () => {
    expect(CARD_EXP_MATERIALS.get(1)).toEqual({
      genre: 7,
      detail: 1,
      particular: 1,
      templateLevel: 1,
      experience: 150,
    });
    expect(CARD_EXP_MATERIALS.get(6)).toMatchObject({
      particular: 4,
      templateLevel: 1,
    });
  });

  it("carries experience across card levels", () => {
    expect(addCardExperience(1, 0, 150)).toEqual({
      level: 2,
      experience: 17,
    });
  });
});
