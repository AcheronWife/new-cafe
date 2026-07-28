import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { GachaCatalog } from "../src/game-data/gacha-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeGachaTaskId,
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

it("atomically consumes a ticket and persists gacha rewards and counters", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-gacha-"));
  try {
    const store = new JsonStore({
      filePath: path.join(directory, "state.json"),
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
    await repository.getOrCreate("tester");
    await repository.settleLevel("tester", 1, 1, 1, 3, [[9, 13, 1, 1, 1, 0]], 0);
    const player = repository.get("tester")!;
    const catalog = GachaCatalog.loadDefault();
    const pool = catalog.get(70)!;
    const roll = catalog.roll(
      70,
      true,
      { pity: 0, upPity: 0, total: 0 },
      new Set(
        player.inventory
          .filter(({ genre }) => genre === 1)
          .map(
            ({ genre, detail, particular, templateLevel }) =>
              `${genre}:${detail}:${particular}:${templateLevel}`,
          ),
      ),
      [],
      () => 0,
    );
    const result = await repository.performGacha("tester", pool, true, roll);

    expect(result.awards).toHaveLength(10);
    expect(
      result.player.inventory.find(({ genre, detail }) => genre === 9 && detail === 13)
        ?.count,
    ).toBe(0);
    expect(result.updatedItems.filter(({ genre }) => genre === 1)).toHaveLength(10);
    expect(
      result.player.inventory.find(
        ({ genre, detail, particular, templateLevel }) =>
          genre === 7 && detail === 1 && particular === 4 && templateLevel === 2,
      )?.count,
    ).toBe(10);
    expect(result.player.taskValues[String(makeGachaTaskId(2 + 70))]).toBe(10);
    expect(result.player.taskValues[String(makeGachaTaskId(3001 + 70))]).toBe(10);
    expect(result.player.taskValues[String(makeGachaTaskId(10_002))]).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
