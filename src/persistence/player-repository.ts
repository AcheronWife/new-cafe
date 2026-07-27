import type { AppConfig } from "../config.js";
import type { Award } from "../game-data/chapter-config.js";
import type { Logger } from "../logger.js";
import type { JsonStore } from "./json-store.js";

export const FIRST_LEVEL_TASK_ID = (1 << 16) | 15;
export const MONEY_VIGOUR = 1;
export const MONEY_GOLD = 2;
export const MONEY_DIAMOND = 3;

export interface CharacterCardState {
  guid: number;
  genre: number;
  detail: number;
  particular: number;
  templateLevel: number;
  count: number;
  createTime: number;
  enhanceLevel: number;
  enhanceExp: number;
  breakLevel: number;
}

export type InventoryItemState = CharacterCardState;

export interface MoneyState {
  id: number;
  count: number;
}

export interface GirlState {
  girlId: number;
  level: number;
  exp: number;
  modelId: number;
  moodValue: number;
  vigor: number;
  flag: number;
}

export interface FightCardState {
  mainCardGuid: number;
  secondaryCardGuids: number[];
  usedCardGuid: number;
  weaponGuid: number;
  runeItemGuids: number[];
}

export interface FormationState {
  id: number;
  fightCards: FightCardState[];
  title: string;
}

export interface LevelState {
  id: number;
  star: number;
}

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
  cards: CharacterCardState[];
  items: InventoryItemState[];
  nextItemGuid: number;
  money: MoneyState[];
  girls: GirlState[];
  formations: FormationState[];
  levels: LevelState[];
}

export interface PersistedState {
  schemaVersion: 4;
  nextRoleId: number;
  players: Record<string, Player>;
  updatedAt: string | null;
}

export interface TaskChange {
  id: number;
  value: number;
}

export interface ChapterSettlement {
  player: Player;
  updatedItems: InventoryItemState[];
  updatedMoney: MoneyState[];
}

export class InsufficientVigourError extends Error {
  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(`Insufficient vigour: required ${required}, available ${available}`);
    this.name = "InsufficientVigourError";
  }
}

interface PlayerRepositoryOptions {
  store: JsonStore<PersistedState>;
  defaults: AppConfig["playerDefaults"];
  logger: Logger;
}

function unixTime(): number {
  return Math.floor(Date.now() / 1000);
}

function makeStarterRoster(
  createTime: number,
): Pick<Player, "cards" | "girls" | "formations"> {
  const cards: CharacterCardState[] = [
    {
      guid: 10_001,
      genre: 1,
      detail: 7,
      particular: 1,
      templateLevel: 1,
      count: 1,
      createTime,
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
      createTime,
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
      createTime,
      enhanceLevel: 1,
      enhanceExp: 0,
      breakLevel: 0,
    },
  ];
  const girls: GirlState[] = [7, 9, 2].map((girlId) => ({
    girlId,
    level: 1,
    exp: 0,
    modelId: 1,
    moodValue: 100,
    vigor: 100,
    flag: 0,
  }));
  const formations: FormationState[] = [
    {
      id: 1,
      title: "初始阵容",
      fightCards: cards.map((card) => ({
        mainCardGuid: card.guid,
        secondaryCardGuids: [],
        usedCardGuid: card.guid,
        weaponGuid: 0,
        runeItemGuids: [],
      })),
    },
  ];
  return { cards, girls, formations };
}

export function makeLevelId(
  chapter: number,
  index: number,
  difficulty: number,
): number {
  return (chapter << 16) | (index << 8) | difficulty;
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
      const registerTime = unixTime();
      player = {
        account: safeAccount,
        roleId,
        name: this.#defaults.name,
        level: this.#defaults.level,
        exp: this.#defaults.exp,
        fightPower: this.#defaults.fightPower,
        serverZone: this.#defaults.serverZone,
        registerTime,
        lastLoginAt: null,
        taskValues: this.#defaults.firstLevelComplete
          ? { [FIRST_LEVEL_TASK_ID]: 6 }
          : {},
        levels: [],
        items: [],
        nextItemGuid: 20_001,
        money: [
          { id: MONEY_VIGOUR, count: 28 },
          { id: MONEY_GOLD, count: 0 },
          { id: MONEY_DIAMOND, count: 0 },
        ],
        ...makeStarterRoster(registerTime),
      };
      state.schemaVersion = 4;
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

  async rename(account: string, name: string): Promise<Player> {
    if (name.length === 0) throw new Error("Player name must not be empty");

    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      player.name = name;
    });
    this.#logger.info("player.renamed", { account, name });
    if (!player) throw new Error(`Failed to rename player: ${account}`);
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

  async updateFormation(account: string, formation: FormationState): Promise<Player> {
    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);

      const ownedCards = new Set(player.cards.map(({ guid }) => guid));
      for (const fightCard of formation.fightCards) {
        const referencedCards = [
          fightCard.mainCardGuid,
          fightCard.usedCardGuid,
          ...fightCard.secondaryCardGuids,
        ].filter((guid) => guid > 0);
        if (referencedCards.some((guid) => !ownedCards.has(guid))) {
          throw new Error(`Formation ${formation.id} references an unknown card`);
        }
      }

      const index = player.formations.findIndex(({ id }) => id === formation.id);
      if (index >= 0) {
        player.formations[index] = structuredClone(formation);
      } else {
        player.formations.push(structuredClone(formation));
      }
    });
    this.#logger.info("player.formation.updated", {
      account,
      formationId: formation.id,
    });
    if (!player) throw new Error(`Failed to update player formation: ${account}`);
    return structuredClone(player);
  }

  async enterLevel(account: string, energyCost: number): Promise<Player> {
    if (!Number.isSafeInteger(energyCost) || energyCost < 0) {
      throw new Error(`Invalid level energy cost: ${energyCost}`);
    }

    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      const vigour = player.money.find(({ id }) => id === MONEY_VIGOUR);
      const available = vigour?.count ?? 0;
      if (available < energyCost) {
        throw new InsufficientVigourError(energyCost, available);
      }
      if (vigour) {
        vigour.count -= energyCost;
      } else {
        player.money.push({ id: MONEY_VIGOUR, count: -energyCost });
      }
    });
    this.#logger.info("player.level.entered", { account, energyCost });
    if (!player) throw new Error(`Failed to enter level: ${account}`);
    return structuredClone(player);
  }

  async settleLevel(
    account: string,
    chapter: number,
    index: number,
    difficulty: number,
    star: number,
    awards: readonly Award[],
    masterExp: number,
  ): Promise<ChapterSettlement> {
    if (
      ![chapter, index, difficulty].every(
        (value) => Number.isSafeInteger(value) && value > 0 && value <= 0xff,
      )
    ) {
      throw new Error("Invalid level coordinates");
    }

    const levelId = makeLevelId(chapter, index, difficulty);
    const starMask = star & 0b111;
    let player: Player | undefined;
    const updatedItemGuids = new Set<number>();
    const updatedMoneyIds = new Set<number>();
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);

      const level = player.levels.find(({ id }) => id === levelId);
      if (level) {
        const passCount = Math.min((level.star >>> 3) + 1, 0x0fffffff);
        level.star = (passCount << 3) | (level.star & 0b111) | starMask;
      } else {
        player.levels.push({ id: levelId, star: (1 << 3) | starMask });
      }
      player.exp += Math.max(0, masterExp);

      for (const [genre, detail, particular, templateLevel, rawCount] of awards) {
        const count = Math.max(0, rawCount);
        if (count === 0) continue;

        const moneyId =
          genre === 15 && detail === 1
            ? MONEY_GOLD
            : genre === 15 && detail === 2
              ? MONEY_DIAMOND
              : null;
        if (moneyId !== null) {
          let money = player.money.find(({ id }) => id === moneyId);
          if (!money) {
            money = { id: moneyId, count: 0 };
            player.money.push(money);
          }
          money.count += count;
          updatedMoneyIds.add(moneyId);
          continue;
        }

        let item = player.items.find(
          (candidate) =>
            candidate.genre === genre &&
            candidate.detail === detail &&
            candidate.particular === particular &&
            candidate.templateLevel === templateLevel,
        );
        if (!item) {
          item = {
            guid: player.nextItemGuid++,
            genre,
            detail,
            particular,
            templateLevel,
            count: 0,
            createTime: unixTime(),
            enhanceLevel: 0,
            enhanceExp: 0,
            breakLevel: 0,
          };
          player.items.push(item);
        }
        item.count += count;
        updatedItemGuids.add(item.guid);
      }
    });
    if (!player) throw new Error(`Failed to settle level: ${account}`);

    this.#logger.info("player.level.settled", {
      account,
      levelId,
      star: starMask,
      awards,
      masterExp,
    });
    const snapshot = structuredClone(player);
    return {
      player: snapshot,
      updatedItems: snapshot.items.filter(({ guid }) => updatedItemGuids.has(guid)),
      updatedMoney: snapshot.money.filter(({ id }) => updatedMoneyIds.has(id)),
    };
  }

  async completeLevel(
    account: string,
    chapter: number,
    index: number,
    difficulty: number,
    star: number,
  ): Promise<Player> {
    if (
      ![chapter, index, difficulty].every(
        (value) => Number.isSafeInteger(value) && value > 0 && value <= 0xff,
      )
    ) {
      throw new Error("Invalid level coordinates");
    }

    const levelId = makeLevelId(chapter, index, difficulty);
    const starMask = star & 0b111;
    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);

      const level = player.levels.find(({ id }) => id === levelId);
      if (level) {
        const passCount = Math.min((level.star >>> 3) + 1, 0x0fffffff);
        level.star = (passCount << 3) | (level.star & 0b111) | starMask;
      } else {
        player.levels.push({ id: levelId, star: (1 << 3) | starMask });
      }
    });
    this.#logger.info("player.level.completed", {
      account,
      levelId,
      chapter,
      index,
      difficulty,
      star: starMask,
    });
    if (!player) throw new Error(`Failed to complete level: ${account}`);
    return structuredClone(player);
  }
}

export function makeInitialState(): PersistedState {
  return {
    schemaVersion: 4,
    nextRoleId: 1,
    players: {},
    updatedAt: null,
  };
}
