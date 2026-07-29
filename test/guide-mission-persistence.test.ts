import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  makeGuideTaskId,
  GUIDE_PROGRESS_TASK_ID,
} from "../src/game-data/guide-mission-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  makeLevelId,
  PlayerRepository,
  type PersistedState,
} from "../src/persistence/player-repository.js";

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createRepository(): Promise<{
  repository: PlayerRepository;
  store: JsonStore<PersistedState>;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gcg2-guide-mission-"));
  directories.push(directory);
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
  return { repository, store };
}

describe("guide mission persistence", () => {
  it("reconciles completed levels from an existing save on login", async () => {
    const { repository, store } = await createRepository();
    await store.update((state) => {
      const player = state.players.tester;
      if (!player) throw new Error("missing test player");
      player.levels.push(
        { id: makeLevelId(1, 1, 1), star: 15 },
        { id: makeLevelId(1, 2, 1), star: 15 },
        { id: makeLevelId(1, 3, 1), star: 15 },
        { id: makeLevelId(1, 6, 1), star: 15 },
      );
    });

    const player = await repository.markLogin("tester");

    expect(player.taskValues).toMatchObject({
      [makeGuideTaskId(40_001)]: 2,
      [makeGuideTaskId(40_002)]: 2,
      [makeGuideTaskId(40_003)]: 2,
      [makeGuideTaskId(40_004)]: 2,
    });
  });

  it("updates from domain events and enforces sequential mission claims", async () => {
    const { repository } = await createRepository();
    await repository.completeLevel("tester", 1, 1, 1, 3);
    await repository.completeLevel("tester", 1, 2, 1, 3);

    await expect(
      repository.claimGuideMissionAward("tester", 40_002),
    ).rejects.toMatchObject({
      reason: "prerequisite_not_claimed",
    });

    const first = await repository.claimGuideMissionAward("tester", 40_001);
    expect(first.player.taskValues[String(makeGuideTaskId(40_001))]).toBe(3);
    expect(first.updatedMoney).toContainEqual({ id: 2, count: 2_000 });

    const second = await repository.claimGuideMissionAward("tester", 40_002);
    expect(second.player.taskValues[String(makeGuideTaskId(40_002))]).toBe(3);
    expect(second.player.money).toContainEqual({ id: 2, count: 4_000 });

    await expect(
      repository.claimGuideMissionAward("tester", 40_002),
    ).rejects.toMatchObject({
      reason: "already_claimed",
    });
  });

  it("claims milestone rewards from completed count exactly once", async () => {
    const { repository } = await createRepository();
    await repository.completeLevel("tester", 1, 1, 1, 3);
    await repository.completeLevel("tester", 1, 2, 1, 3);
    await repository.completeLevel("tester", 1, 3, 1, 3);

    const result = await repository.claimGuideProgressAward("tester", 1);
    expect(
      result.player.taskValues[String(makeGuideTaskId(GUIDE_PROGRESS_TASK_ID))],
    ).toBe(1 << 1);
    expect(result.updatedItems).toContainEqual(
      expect.objectContaining({
        genre: 7,
        detail: 1,
        particular: 4,
        templateLevel: 1,
        count: 5,
      }),
    );

    await expect(repository.claimGuideProgressAward("tester", 1)).rejects.toMatchObject(
      {
        reason: "already_claimed",
      },
    );
  });
});
