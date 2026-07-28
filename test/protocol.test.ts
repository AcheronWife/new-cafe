import { describe, expect, it } from "vitest";

import {
  makeItemNotification,
  makeItemUpdateNotification,
  makeFormationUpdateNotification,
  makeHouseInfoResponse,
  makeMoneyUpdateNotification,
  makePhoneMessageNotification,
  makePlayerNotification,
  makeServerLuaCall,
  makeTaskValueSync,
  makeVerifyResponse,
  parseRenameName,
  parseTaskChanges,
} from "../src/protocol/messages.js";
import { makePacket, readPacket } from "../src/protocol/packet.js";
import { decodeFields, firstNumber, firstString } from "../src/protocol/protobuf.js";

describe("game protocol", () => {
  const rosterPlayer = {
    account: "roster-user",
    roleId: 1,
    name: "Commander",
    level: 1,
    exp: 0,
    fightPower: 0,
    serverZone: 8,
    registerTime: 1,
    lastLoginAt: null,
    taskValues: {},
    items: [],
    nextItemGuid: 20_001,
    money: [
      { id: 1, count: 28 },
      { id: 2, count: 0 },
      { id: 3, count: 0 },
    ],
    cards: [
      {
        guid: 10_001,
        genre: 1,
        detail: 7,
        particular: 1,
        templateLevel: 1,
        count: 1,
        createTime: 1,
        enhanceLevel: 1,
        enhanceExp: 0,
        breakLevel: 0,
      },
      {
        guid: 10_002,
        genre: 1,
        detail: 9,
        particular: 1,
        templateLevel: 3,
        count: 1,
        createTime: 1,
        enhanceLevel: 1,
        enhanceExp: 0,
        breakLevel: 0,
      },
      {
        guid: 10_003,
        genre: 1,
        detail: 2,
        particular: 1,
        templateLevel: 1,
        count: 1,
        createTime: 1,
        enhanceLevel: 1,
        enhanceExp: 0,
        breakLevel: 0,
      },
    ],
    girls: [7, 9, 2].map((girlId) => ({
      girlId,
      level: 1,
      exp: 0,
      modelId: 1,
      moodValue: 100,
      vigor: 100,
      flag: 0,
    })),
    formations: [
      {
        id: 1,
        title: "初始阵容",
        fightCards: [10_001, 10_002, 10_003].map((guid) => ({
          mainCardGuid: guid,
          secondaryCardGuids: [],
          usedCardGuid: guid,
          weaponGuid: 0,
          runeItemGuids: [],
        })),
      },
    ],
    levels: [{ id: 65_793, star: 15 }],
    cafe: { coffees: [] },
    phone: {
      letters: [
        {
          topicId: 10_001,
          initiator: 7,
          createTime: 1,
          replyIds: [],
        },
      ],
    },
  };

  it("encodes the 1-5 guide letter in PhoneMsgNtf", () => {
    const phoneFields = decodeFields(makePhoneMessageNotification({
      ...rosterPlayer,
    }));
    const letter = phoneFields[0]?.value;
    expect(Buffer.isBuffer(letter)).toBe(true);
    const letterFields = decodeFields(letter as Buffer);
    expect(firstNumber(letterFields, 1)).toBe(7);
    expect(firstNumber(letterFields, 3)).toBe(1);

    const topic = letterFields.find(({ fieldNumber }) => fieldNumber === 4)?.value;
    expect(Buffer.isBuffer(topic)).toBe(true);
    expect(firstNumber(decodeFields(topic as Buffer), 1)).toBe(10_001);
    expect(
      makePhoneMessageNotification({
        ...rosterPlayer,
        phone: { letters: [] },
      }),
    ).toEqual(Buffer.alloc(0));
  });

  it("round-trips the packet header", () => {
    const payload = Buffer.from("0801", "hex");
    const packet = readPacket(makePacket(1048, 7, payload));
    expect(packet.command).toBe(1048);
    expect(packet.serial).toBe(7);
    expect(packet.payload).toEqual(payload);
  });

  it("encodes the initial cafe, rest and dorm rooms", () => {
    expect(makeHouseInfoResponse(7).toString("hex")).toBe(
      "0807120e08072202080122020802220208061a00",
    );
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

  it("marks a newly created role in VerifyRsp", () => {
    const payload = makeVerifyResponse(
      {
        account: "new-user",
        roleId: 1,
        name: "",
        level: 1,
        exp: 0,
        fightPower: 0,
        serverZone: 8,
        registerTime: 1,
        lastLoginAt: null,
        taskValues: {},
        items: [],
        nextItemGuid: 20_001,
        money: [],
        cards: [],
        girls: [],
        formations: [],
        levels: [],
        cafe: { coffees: [] },
        phone: { letters: [] },
      },
      {
        id: 1,
        aid: 1,
        sid: 1,
        name: "test",
        state: 1,
        level: 1,
      },
      true,
    );
    expect(firstNumber(decodeFields(payload), 9)).toBe(1);

    const returningPayload = makeVerifyResponse(
      {
        account: "returning-user",
        roleId: 2,
        name: "",
        level: 1,
        exp: 0,
        fightPower: 0,
        serverZone: 8,
        registerTime: 1,
        lastLoginAt: "2026-07-28T00:00:00.000Z",
        taskValues: {},
        items: [],
        nextItemGuid: 20_001,
        money: [],
        cards: [],
        girls: [],
        formations: [],
        levels: [],
        cafe: { coffees: [] },
        phone: { letters: [] },
      },
      {
        id: 1,
        aid: 1,
        sid: 1,
        name: "test",
        state: 1,
        level: 1,
      },
      false,
    );
    expect(firstNumber(decodeFields(returningPayload), 9)).toBe(0);
  });

  it("decodes the player name from RenameReq field 3", () => {
    expect(parseRenameName(Buffer.from("1a06797979797979", "hex"))).toBe("yyyyyy");
  });

  it("encodes an NtfS2CCall callback", () => {
    const payload = makeServerLuaCall("GirlLogic", {
      sCmd: "HeadTouched",
      nId: 9,
      nType: 2,
    });
    const fields = decodeFields(payload);
    expect(firstString(fields, 1)).toBe("GirlLogic");
    expect(JSON.parse(firstString(fields, 2))).toEqual({
      sCmd: "HeadTouched",
      nId: 9,
      nType: 2,
    });
  });

  it("encodes the starter girls and default formation in PlayerNtf", () => {
    const fields = decodeFields(makePlayerNotification(rosterPlayer));
    const girlList = decodeFields(
      fields.find((field) => field.fieldNumber === 10)?.value as Buffer,
    );
    const girlIds = girlList.map((field) =>
      firstNumber(decodeFields(field.value as Buffer), 1),
    );
    expect(girlIds).toEqual([7, 9, 2]);

    const formation = decodeFields(
      fields.find((field) => field.fieldNumber === 11)?.value as Buffer,
    );
    expect(firstNumber(formation, 1)).toBe(1);
    expect(formation.filter((field) => field.fieldNumber === 2)).toHaveLength(3);

    const levelList = decodeFields(
      fields.find((field) => field.fieldNumber === 12)?.value as Buffer,
    );
    const firstLevel = decodeFields(levelList[0]?.value as Buffer);
    expect(firstNumber(firstLevel, 1)).toBe(65_793);
    expect(firstNumber(firstLevel, 2)).toBe(15);

    const money = fields
      .filter((field) => field.fieldNumber === 5)
      .map((field) => decodeFields(field.value as Buffer));
    expect(
      money.map((entry) => [firstNumber(entry, 1), firstNumber(entry, 2)]),
    ).toEqual([
      [1, 28],
      [2, 0],
      [3, 0],
    ]);
  });

  it("encodes the three starter character cards in ItemNtf", () => {
    const fields = decodeFields(makeItemNotification(rosterPlayer));
    const cards = fields
      .filter((field) => field.fieldNumber === 1)
      .map((field) => decodeFields(field.value as Buffer));
    expect(cards).toHaveLength(3);
    expect(
      cards.map((card) => [
        firstNumber(card, 2),
        firstNumber(card, 3),
        firstNumber(card, 4),
        firstNumber(card, 5),
      ]),
    ).toEqual([
      [1, 7, 1, 1],
      [1, 9, 1, 3],
      [1, 2, 1, 1],
    ]);
    expect(firstNumber(fields, 2)).toBe(3);
  });

  it("encodes a FormationInfoUpdateNtf", () => {
    const fields = decodeFields(
      makeFormationUpdateNotification(rosterPlayer.formations[0]!),
    );
    const formation = decodeFields(fields[0]?.value as Buffer);
    expect(firstNumber(formation, 1)).toBe(1);
    expect(formation.filter((field) => field.fieldNumber === 2)).toHaveLength(3);
  });

  it("encodes incremental item and money notifications", () => {
    const item = {
      ...rosterPlayer.cards[0]!,
      guid: 20_001,
      genre: 7,
      detail: 1,
      particular: 4,
      count: 2,
    };
    const itemFields = decodeFields(makeItemUpdateNotification([item]));
    const encodedItem = decodeFields(itemFields[0]?.value as Buffer);
    expect(firstNumber(encodedItem, 1)).toBe(20_001);
    expect(firstNumber(encodedItem, 6)).toBe(2);

    const moneyFields = decodeFields(makeMoneyUpdateNotification({ id: 1, count: 25 }));
    const encodedMoney = decodeFields(moneyFields[0]?.value as Buffer);
    expect(firstNumber(encodedMoney, 1)).toBe(1);
    expect(firstNumber(encodedMoney, 2)).toBe(25);
  });
});
