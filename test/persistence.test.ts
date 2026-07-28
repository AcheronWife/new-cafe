import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  PlayerRepository,
} from "../src/persistence/player-repository.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

it("persists player and task changes atomically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-store-"));
  const filePath = path.join(directory, "state.json");
  try {
    const store = new JsonStore({
      filePath,
      initialState: makeInitialState(),
      logger,
    });
    await store.initialize();
    const repository = new PlayerRepository({
      store,
      defaults: {
        name: "",
        level: 1,
        exp: 0,
        fightPower: 0,
        serverZone: 8,
        firstLevelComplete: false,
      },
      logger,
    });

    const player = await repository.getOrCreate("tester");
    expect(player.name).toBe("");
    expect(player.lastLoginAt).toBeNull();
    expect(player.taskValues).toEqual({
      "1507329": 256,
      "1507330": 256,
      "1507331": 256,
      "1507332": 256,
    });
    expect(
      player.inventory
        .filter(({ genre }) => genre === 1)
        .map(({ genre, detail, particular, templateLevel }) => [
          genre,
          detail,
          particular,
          templateLevel,
        ]),
    ).toEqual([
      [1, 7, 1, 1],
      [1, 9, 1, 3],
      [1, 2, 1, 1],
    ]);
    expect(player.girls.map(({ girlId }) => girlId)).toEqual([7, 9, 2]);
    expect(player.formations[0]?.fightCards).toHaveLength(3);
    expect(player.levels).toEqual([]);
    expect(player.money).toEqual([
      { id: 1, count: 28 },
      { id: 2, count: 0 },
      { id: 3, count: 0 },
    ]);
    expect(player.inventory).toHaveLength(3);
    expect(player.cafe).toEqual({ coffees: [] });
    expect(player.phone).toEqual({ letters: [] });
    const loggedInPlayer = await repository.markLogin("tester");
    expect(loggedInPlayer.lastLoginAt).not.toBeNull();
    const renamedPlayer = await repository.rename("tester", "Commander");
    expect(renamedPlayer.name).toBe("Commander");
    await repository.setTaskValues("tester", [{ id: 123, value: 9 }]);
    const cafePlayer = await repository.makeCoffee("tester", 3, 240);
    expect(cafePlayer.cafe).toEqual({
      coffees: [{ coffeetype: 3, count: 240 }],
    });
    const enteredPlayer = await repository.enterLevel("tester", 3);
    expect(enteredPlayer.money[0]?.count).toBe(25);
    const settlement = await repository.settleLevel(
      "tester",
      1,
      1,
      1,
      3,
      [
        [15, 1, 1, 1, 1_000, 0],
        [7, 1, 4, 1, 2, 100],
        [1, 2, 1, 1, 2, 100],
      ],
      6,
    );
    expect(settlement.player.levels).toEqual([{ id: 65_793, star: 11 }]);
    expect(settlement.player.exp).toBe(6);
    expect(settlement.updatedMoney).toEqual([{ id: 2, count: 1_000 }]);
    expect(settlement.updatedItems).toMatchObject([
      { genre: 7, detail: 1, particular: 4, templateLevel: 1, count: 2 },
      { genre: 1, detail: 2, particular: 1, templateLevel: 1, count: 1 },
      { genre: 1, detail: 2, particular: 1, templateLevel: 1, count: 1 },
    ]);
    const awardedCards = settlement.updatedItems.filter(({ genre }) => genre === 1);
    expect(awardedCards).toHaveLength(2);
    expect(new Set(awardedCards.map(({ guid }) => guid)).size).toBe(2);
    const awardedCard = settlement.updatedItems.find(({ genre }) => genre === 1);
    expect(awardedCard).toBeDefined();
    const formationPlayer = await repository.updateFormation("tester", {
      id: 2,
      title: "",
      fightCards: [
        {
          mainCardGuid: awardedCard?.guid ?? 0,
          secondaryCardGuids: [],
          usedCardGuid: 0,
          weaponGuid: 0,
          runeItemGuids: [],
        },
      ],
    });
    expect(formationPlayer.formations[1]?.fightCards[0]?.mainCardGuid).toBe(
      awardedCard?.guid,
    );
    const enhancement = await repository.enhanceCard("tester", 10_003, [
      { kind: 1, reference: 6, count: 1 },
    ]);
    expect(enhancement.card).toMatchObject({
      guid: 10_003,
      enhanceLevel: 2,
      enhanceExp: 17,
    });
    expect(enhancement.consumedItems).toMatchObject([
      { genre: 7, detail: 1, particular: 4, templateLevel: 1, count: 1 },
    ]);
    const completedPlayer = await repository.completeLevel("tester", 1, 1, 1, 5);
    expect(completedPlayer.levels).toEqual([{ id: 65_793, star: 23 }]);
    const letterPlayer = await repository.addPhoneLetter("tester", {
      topicId: 10_001,
      initiator: 7,
    });
    expect(letterPlayer.phone.letters[0]).toMatchObject({
      topicId: 10_001,
      initiator: 7,
      replyIds: [],
    });
    const repliedPlayer = await repository.replyToPhoneLetter("tester", 10_001, 21);
    expect(repliedPlayer.phone.letters[0]?.replyIds).toEqual([21]);
    await repository.removePhoneLetter("tester", 10_001);
    const mysteryLetterPlayer = await repository.addPhoneLetter("tester", {
      topicId: 1,
      initiator: 111,
    });
    expect(mysteryLetterPlayer.phone.letters).toMatchObject([
      { topicId: 1, initiator: 111, replyIds: [] },
    ]);

    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted.schemaVersion).toBe(9);
    expect(persisted.players.tester.name).toBe("Commander");
    expect(persisted.players.tester.taskValues["123"]).toBe(9);
    expect(persisted.players.tester.levels).toEqual([{ id: 65_793, star: 23 }]);
    expect(persisted.players.tester.money).toEqual([
      { id: 1, count: 25 },
      { id: 2, count: 1_000 },
      { id: 3, count: 0 },
    ]);
    expect(persisted.players.tester.cafe).toEqual({
      coffees: [{ coffeetype: 3, count: 240 }],
    });
    expect(persisted.players.tester.phone.letters).toMatchObject([
      { topicId: 1, initiator: 111, replyIds: [] },
    ]);
    expect(persisted.players.tester).not.toHaveProperty("cards");
    expect(persisted.players.tester).not.toHaveProperty("items");
    expect(
      persisted.players.tester.inventory.find(
        ({ guid }: { guid: number }) => guid === 10_003,
      ),
    ).toMatchObject({
      guid: 10_003,
      enhanceLevel: 2,
      enhanceExp: 17,
    });

    const legacyPlayer = persisted.players.tester;
    legacyPlayer.cards = legacyPlayer.inventory.filter(
      ({ guid }: { guid: number }) => guid <= 10_003,
    );
    legacyPlayer.items = legacyPlayer.inventory.filter(
      ({ guid }: { guid: number }) => guid > 10_003,
    );
    delete legacyPlayer.inventory;
    persisted.schemaVersion = 6;
    await writeFile(filePath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

    const migratedStore = new JsonStore({
      filePath,
      initialState: makeInitialState(),
      logger,
    });
    await migratedStore.initialize();
    const migratedRepository = new PlayerRepository({
      store: migratedStore,
      defaults: {
        name: "",
        level: 1,
        exp: 0,
        fightPower: 0,
        serverZone: 8,
        firstLevelComplete: false,
      },
      logger,
    });
    const migratedPlayer = await migratedRepository.getOrCreate("tester");
    expect(migratedPlayer.inventory).toHaveLength(
      legacyPlayer.cards.length + legacyPlayer.items.length,
    );
    expect(migratedPlayer.inventory.find(({ guid }) => guid === 10_003)).toMatchObject({
      genre: 1,
      enhanceLevel: 2,
      enhanceExp: 17,
    });
    const migratedDocument = JSON.parse(await readFile(filePath, "utf8"));
    expect(migratedDocument.schemaVersion).toBe(9);
    expect(migratedDocument.players.tester).not.toHaveProperty("cards");
    expect(migratedDocument.players.tester).not.toHaveProperty("items");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
