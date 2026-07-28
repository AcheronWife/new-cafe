import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import {
  DAILY_SIGN_UP_TODAY_TASK,
  DAILY_SIGN_UP_TOTAL_TASK,
  makeDailySignUpTaskId,
} from "../src/game-data/daily-sign-up-data.js";
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

it("persists one reward per operational day and resets the month", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-sign-up-"));
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

    const first = await repository.signUpDaily(
      "tester",
      Date.parse("2026-07-27T20:00:00Z"),
    );
    expect(first.fresh).toBe(true);
    expect(first.award).toEqual([15, 1, 1, 1, 5_000]);
    expect(first.updatedMoney).toEqual([{ id: 2, count: 5_000 }]);

    const duplicate = await repository.signUpDaily(
      "tester",
      Date.parse("2026-07-28T19:59:59Z"),
    );
    expect(duplicate.fresh).toBe(false);
    expect(duplicate.updatedMoney).toEqual([]);

    const nextDay = await repository.signUpDaily(
      "tester",
      Date.parse("2026-07-28T20:00:00Z"),
    );
    expect(nextDay.fresh).toBe(true);
    expect(nextDay.award).toEqual([10, 1, 1, 2, 1]);
    expect(nextDay.updatedItems).toMatchObject([
      { genre: 10, detail: 1, particular: 1, templateLevel: 2, count: 1 },
    ]);

    const nextMonth = await repository.signUpDaily(
      "tester",
      Date.parse("2026-07-31T20:00:00Z"),
    );
    expect(nextMonth.fresh).toBe(true);
    expect(nextMonth.award).toEqual([15, 1, 1, 1, 5_000]);
    expect(
      nextMonth.player.taskValues[
        String(makeDailySignUpTaskId(DAILY_SIGN_UP_TODAY_TASK))
      ],
    ).toBe(1);
    expect(
      nextMonth.player.taskValues[
        String(makeDailySignUpTaskId(DAILY_SIGN_UP_TOTAL_TASK))
      ],
    ).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
