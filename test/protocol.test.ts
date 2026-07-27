import { describe, expect, it } from "vitest";

import { makeTaskValueSync, parseTaskChanges } from "../src/protocol/messages.js";
import { makePacket, readPacket } from "../src/protocol/packet.js";
import { decodeFields, firstNumber } from "../src/protocol/protobuf.js";

describe("game protocol", () => {
  it("round-trips the packet header", () => {
    const payload = Buffer.from("0801", "hex");
    const packet = readPacket(makePacket(1048, 7, payload));
    expect(packet.command).toBe(1048);
    expect(packet.serial).toBe(7);
    expect(packet.payload).toEqual(payload);
  });

  it("encodes task sync and decodes task changes", () => {
    const payload = makeTaskValueSync({ 65551: 6, 262181: 3 });
    const outer = decodeFields(payload);
    expect(outer).toHaveLength(2);
    const first = outer[0];
    expect(first).toBeDefined();
    expect(Buffer.isBuffer(first?.value)).toBe(true);
    const firstTask = decodeFields(first?.value as Buffer);
    expect(firstNumber(firstTask, 1)).toBe(65551);
    expect(firstNumber(firstTask, 2)).toBe(6);
    expect(parseTaskChanges(payload)).toEqual([
      { id: 65551, value: 6 },
      { id: 262181, value: 3 },
    ]);
  });
});
