import { expect, it } from "vitest";

import {
  getPhoneLetterDefinition,
  makePhoneReplyId,
} from "../src/game-data/phone-message-data.js";

it("maps the guide reply to the protobuf reply id", () => {
  const definition = getPhoneLetterDefinition(10_001);
  expect(definition).toMatchObject({ initiator: 7, replyPositions: [2] });
  expect(makePhoneReplyId(definition!, 1, [])).toBe(21);
  expect(makePhoneReplyId(definition!, 1, [21])).toBeNull();
  expect(getPhoneLetterDefinition(1)).toMatchObject({
    initiator: 111,
    replyPositions: [],
  });
});
