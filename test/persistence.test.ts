import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    expect(player.taskValues).toEqual({});
    expect(
      player.cards.map(({ genre, detail, particular, templateLevel }) => [
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
    expect(player.items).toEqual([]);
    const loggedInPlayer = await repository.markLogin("tester");
    expect(loggedInPlayer.lastLoginAt).not.toBeNull();
    const renamedPlayer = await repository.rename("tester", "Commander");
    expect(renamedPlayer.name).toBe("Commander");
    await repository.setTaskValues("tester", [{ id: 123, value: 9 }]);
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
      ],
      6,
    );
    expect(settlement.player.levels).toEqual([{ id: 65_793, star: 11 }]);
    expect(settlement.player.exp).toBe(6);
    expect(settlement.updatedMoney).toEqual([{ id: 2, count: 1_000 }]);
    expect(settlement.updatedItems).toMatchObject([
      { genre: 7, detail: 1, particular: 4, templateLevel: 1, count: 2 },
    ]);
    const completedPlayer = await repository.completeLevel("tester", 1, 1, 1, 5);
    expect(completedPlayer.levels).toEqual([{ id: 65_793, star: 23 }]);

    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted.schemaVersion).toBe(4);
    expect(persisted.players.tester.name).toBe("Commander");
    expect(persisted.players.tester.taskValues["123"]).toBe(9);
    expect(persisted.players.tester.levels).toEqual([{ id: 65_793, star: 23 }]);
    expect(persisted.players.tester.money).toEqual([
      { id: 1, count: 25 },
      { id: 2, count: 1_000 },
      { id: 3, count: 0 },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
