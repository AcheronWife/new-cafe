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
    const loggedInPlayer = await repository.markLogin("tester");
    expect(loggedInPlayer.lastLoginAt).not.toBeNull();
    const renamedPlayer = await repository.rename("tester", "Commander");
    expect(renamedPlayer.name).toBe("Commander");
    await repository.setTaskValues("tester", [{ id: 123, value: 9 }]);

    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted.players.tester.name).toBe("Commander");
    expect(persisted.players.tester.taskValues["123"]).toBe(9);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
