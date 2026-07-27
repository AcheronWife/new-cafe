import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { JsonStore } from "./json-store.js";

export const FIRST_LEVEL_TASK_ID = (1 << 16) | 15;

export interface Player {
  account: string;
  roleId: number;
  name: string;
  level: number;
  exp: number;
  fightPower: number;
  serverZone: number;
  registerTime: number;
  lastLoginAt: string | null;
  taskValues: Record<string, number>;
}

export interface PersistedState {
  schemaVersion: 1;
  nextRoleId: number;
  players: Record<string, Player>;
  updatedAt: string | null;
}

export interface TaskChange {
  id: number;
  value: number;
}

interface PlayerRepositoryOptions {
  store: JsonStore<PersistedState>;
  defaults: AppConfig["playerDefaults"];
  logger: Logger;
}

function unixTime(): number {
  return Math.floor(Date.now() / 1000);
}

export class PlayerRepository {
  readonly #store: JsonStore<PersistedState>;
  readonly #defaults: AppConfig["playerDefaults"];
  readonly #logger: Logger;

  constructor({ store, defaults, logger }: PlayerRepositoryOptions) {
    this.#store = store;
    this.#defaults = defaults;
    this.#logger = logger;
  }

  async getOrCreate(account: string): Promise<Player> {
    const safeAccount = account || "offline";
    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[safeAccount];
      if (player) return;

      const roleId = state.nextRoleId++;
      player = {
        account: safeAccount,
        roleId,
        name: this.#defaults.name,
        level: this.#defaults.level,
        exp: this.#defaults.exp,
        fightPower: this.#defaults.fightPower,
        serverZone: this.#defaults.serverZone,
        registerTime: unixTime(),
        lastLoginAt: null,
        taskValues: this.#defaults.firstLevelComplete
          ? { [FIRST_LEVEL_TASK_ID]: 6 }
          : {},
      };
      state.players[safeAccount] = player;
      this.#logger.info("player.created", { account: safeAccount, roleId });
    });
    if (!player) throw new Error(`Failed to create player: ${safeAccount}`);
    return structuredClone(player);
  }

  get(account: string): Player | null {
    return this.#store.snapshot().players?.[account] ?? null;
  }

  async markLogin(account: string): Promise<Player> {
    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      player.lastLoginAt = new Date().toISOString();
    });
    if (!player) throw new Error(`Failed to mark player login: ${account}`);
    return structuredClone(player);
  }

  async setTaskValues(
    account: string,
    changes: readonly TaskChange[],
  ): Promise<Player> {
    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      for (const { id, value } of changes) {
        player.taskValues[String(id)] = value;
      }
    });
    this.#logger.info("player.tasks.updated", { account, changes });
    if (!player) throw new Error(`Failed to update player tasks: ${account}`);
    return structuredClone(player);
  }
}

export function makeInitialState(): PersistedState {
  return {
    schemaVersion: 1,
    nextRoleId: 1,
    players: {},
    updatedAt: null,
  };
}
