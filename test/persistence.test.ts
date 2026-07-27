import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  FIRST_LEVEL_TASK_ID,
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
        name: "offline",
        level: 1,
        exp: 0,
        fightPower: 0,
        serverZone: 8,
        firstLevelComplete: true,
      },
      logger,
    });

    const player = await repository.getOrCreate("tester");
    expect(player.taskValues[FIRST_LEVEL_TASK_ID]).toBe(6);
    await repository.setTaskValues("tester", [{ id: 123, value: 9 }]);

    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted.players.tester.taskValues["123"]).toBe(9);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
