import type { AppConfig } from "../config.js";
import {
  addCardExperience,
  CARD_EXP_MATERIALS,
  type CardEnhancementMaterial,
} from "../game-data/card-enhancement-data.js";
import {
  addWeaponExperience,
  sacrificedWeaponValue,
  weaponExperienceMaterial,
  weaponMaximumLevel,
  type WeaponEnhancementMaterial,
} from "../game-data/weapon-enhancement-data.js";
import { INITIAL_COFFEE_TASK_VALUES, type CafeCoffee } from "../game-data/cafe-data.js";
import type { Award, BaseAward } from "../game-data/chapter-config.js";
import {
  dailySignUpOperationalDate,
  dailySignUpReward,
  makeDailySignUpTaskId,
  DAILY_SIGN_UP_TODAY_TASK,
  DAILY_SIGN_UP_TOTAL_TASK,
} from "../game-data/daily-sign-up-data.js";
import {
  EIGHT_DAY_SIGN_UP_REWARDS,
  eightDaySignUpProgress,
  eightDaySignUpReward,
  hasClaimedEightDaySignUpReward,
  makeEightDaySignUpTaskId,
  makeEightDaySignUpTaskValue,
} from "../game-data/eight-day-sign-up-data.js";
import type {
  GachaAward,
  GachaPool,
  GachaRollResult,
  Gdpl,
  Gdpln,
} from "../game-data/gacha-data.js";
import { addPlayerExperience } from "../game-data/player-level-data.js";
import type { Logger } from "../logger.js";
import type { JsonStore } from "./json-store.js";

export const FIRST_LEVEL_TASK_ID = (1 << 16) | 15;
export const MONEY_VIGOUR = 1;
export const MONEY_GOLD = 2;
export const MONEY_DIAMOND = 3;
export const MONEY_PAY_DIAMOND = 12;
export const GACHA_TASK_GROUP = 15;
export const MAIN_GIRL_TASK_ID = (2 << 16) | 2;

const GIRL_STATE_TASK_GROUP = 3;
const GIRL_SUIT_TASK_GROUP = 4;
const GIRL_TASK_STRIDE = 2_000;
const GIRL_FIGHT_MODEL_OFFSET = 9;

export function makeGachaTaskId(taskId: number): number {
  return (GACHA_TASK_GROUP << 16) | taskId;
}

export interface InventoryEntryState {
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

export type CharacterCardState = InventoryEntryState;
export type InventoryItemState = InventoryEntryState;

const INSTANCE_GENRES = new Set([1, 2, 3, 4]);

export function isCharacterCard(
  entry: InventoryEntryState,
): entry is CharacterCardState {
  return entry.genre === 1;
}

export function isWeapon(entry: InventoryEntryState): boolean {
  return entry.genre === 2;
}

export function isInventoryInstance(entry: InventoryEntryState): boolean {
  return INSTANCE_GENRES.has(entry.genre);
}

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

export interface CafeState {
  coffees: CafeCoffee[];
}

export interface PhoneLetterState {
  topicId: number;
  initiator: number;
  createTime: number;
  replyIds: number[];
}

export interface PhoneState {
  letters: PhoneLetterState[];
}

export interface PendingGachaState {
  poolId: number;
  ten: boolean;
  awards: GachaAward[];
  pity: number;
  upPity: number;
  total: number;
}

export interface GachaState {
  pending: PendingGachaState | null;
}

export interface DailySignUpState {
  cycle: string;
  lastOperationalDate: string | null;
}

export interface EightDaySignUpState {
  cumulativeDays: number;
  lastOperationalDate: string | null;
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
  inventory: InventoryEntryState[];
  nextItemGuid: number;
  money: MoneyState[];
  girls: GirlState[];
  formations: FormationState[];
  levels: LevelState[];
  cafe: CafeState;
  phone: PhoneState;
  gacha?: GachaState;
  dailySignUp?: DailySignUpState;
  eightDaySignUp?: EightDaySignUpState;
}

export interface PersistedState {
  schemaVersion: 9;
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
  experienceUpdate: PlayerExperienceUpdate;
}

export interface PlayerExperienceUpdate {
  previousLevel: number;
  previousExperience: number;
  addedExperience: number;
  level: number;
  experience: number;
  levelsGained: number;
  vigourRecovery: number;
}

export interface GirlAppearanceResult {
  player: Player;
  girl: GirlState;
}

export interface CardEnhancementResult {
  player: Player;
  card: CharacterCardState;
  consumedItems: InventoryItemState[];
  addedExperience: number;
  coinCost: number;
  updatedMoney: MoneyState[];
}

export interface WeaponEnhancementResult {
  player: Player;
  weapon: InventoryItemState;
  consumedItems: InventoryItemState[];
  addedExperience: number;
  coinCost: number;
  updatedMoney: MoneyState[];
}

export interface GachaCommitResult {
  player: Player;
  awards: GachaAward[];
  updatedItems: InventoryItemState[];
  updatedMoney: MoneyState[];
  getItem: Gdpln | null;
}

export interface DailySignUpResult {
  player: Player;
  award: readonly [number, number, number, number, number] | null;
  fresh: boolean;
  cumulativeCount: number;
  updatedItems: InventoryItemState[];
  updatedMoney: MoneyState[];
}

export interface EightDaySignUpAwardResult {
  player: Player;
  achievementId: number;
  awards: readonly BaseAward[];
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

export class InsufficientGoldError extends Error {
  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(`Insufficient gold: required ${required}, available ${available}`);
    this.name = "InsufficientGoldError";
  }
}

export class InsufficientGachaCurrencyError extends Error {
  constructor(readonly poolId: number) {
    super(`Insufficient currency for gacha pool ${poolId}`);
    this.name = "InsufficientGachaCurrencyError";
  }
}

export class EightDaySignUpError extends Error {
  constructor(
    readonly reason: "unknown_achievement" | "not_completed" | "already_claimed",
  ) {
    super(`Eight-day sign-up error: ${reason}`);
    this.name = "EightDaySignUpError";
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

function makeInitialCafeState(): CafeState {
  return { coffees: [] };
}

function makeInitialPhoneState(): PhoneState {
  return { letters: [] };
}

function makeInitialGachaState(): GachaState {
  return { pending: null };
}

function makeGirlTaskId(group: number, girlId: number, offset: number): number {
  return (group << 16) | ((girlId - 1) * GIRL_TASK_STRIDE + offset);
}

function reconcileGirlAppearanceState(player: Player): void {
  const mainGirlId = player.taskValues[String(MAIN_GIRL_TASK_ID)] ?? 0;
  if (!player.girls.some(({ girlId }) => girlId === mainGirlId)) {
    const fallback = player.girls[0]?.girlId;
    if (fallback !== undefined) {
      player.taskValues[String(MAIN_GIRL_TASK_ID)] = fallback;
    }
  }

  for (const girl of player.girls) {
    // Obtaining a girl always unlocks her base suit. Preserve an existing
    // "new" marker (1), otherwise store the client's worn marker (2).
    const baseSuitTaskId = String(makeGirlTaskId(GIRL_SUIT_TASK_GROUP, girl.girlId, 1));
    player.taskValues[baseSuitTaskId] ||= 2;

    const currentModelId = Math.max(1, girl.modelId);
    const currentSuitTaskId = String(
      makeGirlTaskId(GIRL_SUIT_TASK_GROUP, girl.girlId, currentModelId),
    );
    player.taskValues[currentSuitTaskId] ||= 2;
  }
}

function applyPlayerExperience(
  player: Player,
  addedExperience: number,
): PlayerExperienceUpdate {
  const previousLevel = player.level;
  const previousExperience = player.exp;
  const result = addPlayerExperience(
    previousLevel,
    previousExperience,
    addedExperience,
  );
  player.level = result.level;
  player.exp = result.experience;

  if (result.vigourRecovery > 0) {
    let vigour = player.money.find(({ id }) => id === MONEY_VIGOUR);
    if (!vigour) {
      vigour = { id: MONEY_VIGOUR, count: 0 };
      player.money.push(vigour);
    }
    vigour.count += result.vigourRecovery;
  }

  return {
    previousLevel,
    previousExperience,
    addedExperience: Math.max(
      0,
      Number.isSafeInteger(addedExperience) ? addedExperience : 0,
    ),
    ...result,
  };
}

function makeInitialDailySignUpState(now = Date.now()): DailySignUpState {
  const operationalDate = dailySignUpOperationalDate(now);
  return {
    cycle: operationalDate.slice(0, 7),
    lastOperationalDate: null,
  };
}

function reconcileDailySignUp(player: Player, now = Date.now()): void {
  const operationalDate = dailySignUpOperationalDate(now);
  const cycle = operationalDate.slice(0, 7);
  const todayTaskId = String(makeDailySignUpTaskId(DAILY_SIGN_UP_TODAY_TASK));
  const totalTaskId = String(makeDailySignUpTaskId(DAILY_SIGN_UP_TOTAL_TASK));
  player.dailySignUp ??= makeInitialDailySignUpState(now);

  if (player.dailySignUp.cycle !== cycle) {
    player.dailySignUp.cycle = cycle;
    player.dailySignUp.lastOperationalDate = null;
    player.taskValues[totalTaskId] = 0;
    player.taskValues[todayTaskId] = 0;
  } else if (player.dailySignUp.lastOperationalDate !== operationalDate) {
    player.taskValues[todayTaskId] = 0;
  }
}

function reconcileEightDaySignUp(
  player: Player,
  now = Date.now(),
  recordLogin = false,
): void {
  const existingProgress = Math.max(
    0,
    ...EIGHT_DAY_SIGN_UP_REWARDS.map(({ achievementId }) =>
      eightDaySignUpProgress(
        player.taskValues[String(makeEightDaySignUpTaskId(achievementId))] ?? 0,
      ),
    ),
  );
  player.eightDaySignUp ??= {
    cumulativeDays: Math.min(8, existingProgress),
    lastOperationalDate: null,
  };

  const operationalDate = dailySignUpOperationalDate(now);
  if (recordLogin && player.eightDaySignUp.lastOperationalDate !== operationalDate) {
    player.eightDaySignUp.cumulativeDays = Math.min(
      8,
      player.eightDaySignUp.cumulativeDays + 1,
    );
    player.eightDaySignUp.lastOperationalDate = operationalDate;
  }

  for (const { achievementId } of EIGHT_DAY_SIGN_UP_REWARDS) {
    const taskId = String(makeEightDaySignUpTaskId(achievementId));
    const current = player.taskValues[taskId] ?? 0;
    if (player.eightDaySignUp.cumulativeDays === 0 && current === 0) continue;
    player.taskValues[taskId] = makeEightDaySignUpTaskValue(
      player.eightDaySignUp.cumulativeDays,
      hasClaimedEightDaySignUpReward(current),
    );
  }
}

function hasCompletedLevel(
  levels: readonly LevelState[],
  chapter: number,
  index: number,
  difficulty: number,
): boolean {
  const id = makeLevelId(chapter, index, difficulty);
  return levels.some((level) => level.id === id && level.star >>> 3 > 0);
}

function migratePhoneState(player: Player): PhoneState {
  // Schema 5 did not persist phone state. For old saves, reconstruct the most
  // likely deterministic guide state from completed chapters.
  if (hasCompletedLevel(player.levels, 1, 6, 1)) {
    return {
      letters: [
        {
          topicId: 1,
          initiator: 111,
          createTime: unixTime(),
          replyIds: [],
        },
      ],
    };
  }
  if (hasCompletedLevel(player.levels, 1, 5, 1)) {
    return {
      letters: [
        {
          topicId: 10_001,
          initiator: 7,
          createTime: unixTime(),
          replyIds: [],
        },
      ],
    };
  }
  return makeInitialPhoneState();
}

interface LegacyInventoryPlayer {
  inventory?: InventoryEntryState[];
  cards?: CharacterCardState[];
  items?: InventoryItemState[];
}

function migrateInventoryState(player: Player): void {
  const legacy = player as Player & LegacyInventoryPlayer;
  if (!legacy.inventory) {
    legacy.inventory = [...(legacy.cards ?? []), ...(legacy.items ?? [])];
  }

  const migrated: InventoryEntryState[] = [];
  let nextGuid = Math.max(
    player.nextItemGuid,
    ...legacy.inventory.map(({ guid }) => guid + 1),
  );
  for (const entry of legacy.inventory) {
    if (!isInventoryInstance(entry) || entry.count <= 1) {
      migrated.push({
        ...entry,
        count: isInventoryInstance(entry) ? 1 : entry.count,
      });
      continue;
    }
    migrated.push({ ...entry, count: 1 });
    for (let index = 1; index < entry.count; index += 1) {
      migrated.push({ ...entry, guid: nextGuid++, count: 1 });
    }
  }
  player.inventory = migrated;
  player.nextItemGuid = Math.max(nextGuid, player.nextItemGuid);
  delete legacy.cards;
  delete legacy.items;
}

// Unity character-card instances are born at Level 1, including reward and gacha cards.
function reconcileCharacterCardLevels(player: Player): void {
  for (const entry of player.inventory) {
    if (isCharacterCard(entry) && entry.enhanceLevel < 1) {
      entry.enhanceLevel = 1;
    }
  }
}

function initialEnhanceLevel(genre: number): number {
  return genre === 1 || genre === 2 ? 1 : 0;
}

function makeStarterRoster(
  createTime: number,
): Pick<Player, "inventory" | "girls" | "formations"> {
  const inventory: CharacterCardState[] = [
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
      fightCards: inventory.map((card) => ({
        mainCardGuid: card.guid,
        secondaryCardGuids: [],
        usedCardGuid: card.guid,
        weaponGuid: 0,
        runeItemGuids: [],
      })),
    },
  ];
  return { inventory, girls, formations };
}

export function makeLevelId(
  chapter: number,
  index: number,
  difficulty: number,
): number {
  return (chapter << 16) | (index << 8) | difficulty;
}

function addInventoryAward(
  player: Player,
  award: readonly [number, number, number, number, number],
  updatedItemGuids: Set<number>,
): void {
  const [genre, detail, particular, templateLevel, rawCount] = award;
  const count = Math.max(0, rawCount);
  if (count === 0) return;
  if (INSTANCE_GENRES.has(genre)) {
    for (let index = 0; index < count; index++) {
      const item: InventoryEntryState = {
        guid: player.nextItemGuid++,
        genre,
        detail,
        particular,
        templateLevel,
        count: 1,
        createTime: unixTime(),
        enhanceLevel: initialEnhanceLevel(genre),
        enhanceExp: 0,
        breakLevel: 0,
      };
      player.inventory.push(item);
      updatedItemGuids.add(item.guid);
    }
    return;
  }

  let item = player.inventory.find(
    (candidate) =>
      !isInventoryInstance(candidate) &&
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
    player.inventory.push(item);
  }
  item.count += count;
  updatedItemGuids.add(item.guid);
}

function grantAwards(
  player: Player,
  awards: readonly BaseAward[],
  updatedItemGuids: Set<number>,
  updatedMoneyIds: Set<number>,
): void {
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

    addInventoryAward(
      player,
      [genre, detail, particular, templateLevel, count],
      updatedItemGuids,
    );
  }
}

function deductGachaCost(
  player: Player,
  pool: GachaPool,
  ten: boolean,
  updatedItemGuids: Set<number>,
  updatedMoneyIds: Set<number>,
): void {
  const itemCost = ten ? pool.costTen : pool.costOne;
  if (itemCost) {
    const [genre, detail, particular, templateLevel, count] = itemCost;
    const ticket = player.inventory.find(
      (item) =>
        item.genre === genre &&
        item.detail === detail &&
        item.particular === particular &&
        item.templateLevel === templateLevel &&
        item.count >= count,
    );
    if (ticket) {
      ticket.count -= count;
      updatedItemGuids.add(ticket.guid);
      return;
    }
    if (pool.cashType === 1) {
      throw new InsufficientGachaCurrencyError(pool.id);
    }
  }

  if (pool.cashType === 0) {
    const required = pool.exchangeRate * (ten ? 10 : 1);
    const free = player.money.find(({ id }) => id === MONEY_DIAMOND);
    const paid = player.money.find(({ id }) => id === MONEY_PAY_DIAMOND);
    const freeCost = pool.canUseFreeDiamond ? Math.min(free?.count ?? 0, required) : 0;
    const paidCost = required - freeCost;
    if ((paid?.count ?? 0) < paidCost) {
      throw new InsufficientGachaCurrencyError(pool.id);
    }
    if (freeCost > 0 && free) {
      free.count -= freeCost;
      updatedMoneyIds.add(MONEY_DIAMOND);
    }
    if (paidCost > 0 && paid) {
      paid.count -= paidCost;
      updatedMoneyIds.add(MONEY_PAY_DIAMOND);
    }
    return;
  }

  if (pool.cashType > 1) {
    const required = ten ? pool.moneyCostTen : pool.moneyCostOne;
    const money = player.money.find(({ id }) => id === pool.cashType);
    if (!money || money.count < required) {
      throw new InsufficientGachaCurrencyError(pool.id);
    }
    money.count -= required;
    updatedMoneyIds.add(pool.cashType);
    return;
  }

  throw new InsufficientGachaCurrencyError(pool.id);
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
      if (player) {
        migrateInventoryState(player);
        player.cafe ??= makeInitialCafeState();
        player.phone ??= migratePhoneState(player);
        player.gacha ??= makeInitialGachaState();
        const experienceUpdate = applyPlayerExperience(player, 0);
        if (experienceUpdate.levelsGained > 0) {
          this.#logger.info("player.experience.reconciled", {
            account: safeAccount,
            ...experienceUpdate,
          });
        }
        reconcileCharacterCardLevels(player);
        reconcileGirlAppearanceState(player);
        reconcileDailySignUp(player);
        reconcileEightDaySignUp(player);
        state.schemaVersion = 9;
        return;
      }

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
        taskValues: {
          ...INITIAL_COFFEE_TASK_VALUES,
          ...(this.#defaults.firstLevelComplete ? { [FIRST_LEVEL_TASK_ID]: 6 } : {}),
        },
        levels: [],
        nextItemGuid: 20_001,
        money: [
          { id: MONEY_VIGOUR, count: 28 },
          { id: MONEY_GOLD, count: 0 },
          { id: MONEY_DIAMOND, count: 0 },
        ],
        cafe: makeInitialCafeState(),
        phone: makeInitialPhoneState(),
        gacha: makeInitialGachaState(),
        dailySignUp: makeInitialDailySignUpState(),
        ...makeStarterRoster(registerTime),
      };
      reconcileEightDaySignUp(player);
      reconcileGirlAppearanceState(player);
      state.schemaVersion = 9;
      state.players[safeAccount] = player;
      this.#logger.info("player.created", { account: safeAccount, roleId });
    });
    if (!player) throw new Error(`Failed to create player: ${safeAccount}`);
    return structuredClone(player);
  }

  get(account: string): Player | null {
    return this.#store.snapshot().players?.[account] ?? null;
  }

  async markLogin(account: string, now = Date.now()): Promise<Player> {
    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      reconcileDailySignUp(player, now);
      reconcileEightDaySignUp(player, now, true);
      player.lastLoginAt = new Date(now).toISOString();
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

  async setMainGirl(account: string, girlId: number): Promise<Player> {
    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      if (!player.girls.some((girl) => girl.girlId === girlId)) {
        throw new Error(`Player does not own girl ${girlId}`);
      }
      player.taskValues[String(MAIN_GIRL_TASK_ID)] = girlId;
    });
    if (!player) throw new Error(`Failed to set main girl: ${account}`);
    this.#logger.info("player.main_girl.updated", { account, girlId });
    return structuredClone(player);
  }

  async changeGirlClothes(
    account: string,
    girlId: number,
    modelId: number,
  ): Promise<GirlAppearanceResult> {
    let player: Player | undefined;
    let girl: GirlState | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      girl = player.girls.find((candidate) => candidate.girlId === girlId);
      if (!girl) throw new Error(`Player does not own girl ${girlId}`);
      const suitTaskId = String(makeGirlTaskId(GIRL_SUIT_TASK_GROUP, girlId, modelId));
      if ((player.taskValues[suitTaskId] ?? 0) <= 0) {
        throw new Error(`Player does not own girl ${girlId} model ${modelId}`);
      }
      girl.modelId = modelId;
      player.taskValues[suitTaskId] = 2;
    });
    if (!player || !girl) throw new Error(`Failed to change girl clothes: ${account}`);
    this.#logger.info("player.girl_clothes.updated", { account, girlId, modelId });
    return { player: structuredClone(player), girl: structuredClone(girl) };
  }

  async setGirlFightModel(
    account: string,
    girlId: number,
    enabled: boolean,
  ): Promise<Player> {
    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      if (!player.girls.some((girl) => girl.girlId === girlId)) {
        throw new Error(`Player does not own girl ${girlId}`);
      }
      const taskId = makeGirlTaskId(
        GIRL_STATE_TASK_GROUP,
        girlId,
        GIRL_FIGHT_MODEL_OFFSET,
      );
      player.taskValues[String(taskId)] = enabled ? 1 : 0;
    });
    if (!player) throw new Error(`Failed to set girl fight model: ${account}`);
    this.#logger.info("player.girl_fight_model.updated", {
      account,
      girlId,
      enabled,
    });
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

  async signUpDaily(account: string, now = Date.now()): Promise<DailySignUpResult> {
    let player: Player | undefined;
    let award: readonly [number, number, number, number, number] | null = null;
    let fresh = false;
    let cumulativeCount = 0;
    const updatedItemGuids = new Set<number>();
    const updatedMoneyIds = new Set<number>();
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      reconcileDailySignUp(player, now);

      const operationalDate = dailySignUpOperationalDate(now);
      const todayTaskId = String(makeDailySignUpTaskId(DAILY_SIGN_UP_TODAY_TASK));
      const totalTaskId = String(makeDailySignUpTaskId(DAILY_SIGN_UP_TOTAL_TASK));
      cumulativeCount = Math.max(0, player.taskValues[totalTaskId] ?? 0);
      if (
        player.dailySignUp?.lastOperationalDate === operationalDate ||
        player.taskValues[todayTaskId] === 1
      ) {
        return;
      }

      award = dailySignUpReward(cumulativeCount, operationalDate);
      if (!award) return;

      const [genre, detail, particular, templateLevel, count] = award;
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
      } else {
        addInventoryAward(
          player,
          [genre, detail, particular, templateLevel, count],
          updatedItemGuids,
        );
      }

      cumulativeCount += 1;
      player.taskValues[todayTaskId] = 1;
      player.taskValues[totalTaskId] = cumulativeCount;
      player.dailySignUp = {
        cycle: operationalDate.slice(0, 7),
        lastOperationalDate: operationalDate,
      };
      fresh = true;
      state.schemaVersion = 9;
    });
    if (!player) throw new Error(`Failed to sign in player: ${account}`);
    const snapshot = structuredClone(player);
    this.#logger.info("player.daily_sign_up", {
      account,
      operationalDate: dailySignUpOperationalDate(now),
      cumulativeCount,
      fresh,
      award,
    });
    return {
      player: snapshot,
      award,
      fresh,
      cumulativeCount,
      updatedItems: snapshot.inventory.filter(({ guid }) => updatedItemGuids.has(guid)),
      updatedMoney: snapshot.money.filter(({ id }) => updatedMoneyIds.has(id)),
    };
  }

  async claimEightDaySignUpAward(
    account: string,
    achievementId: number,
  ): Promise<EightDaySignUpAwardResult> {
    const reward = eightDaySignUpReward(achievementId);
    if (!reward) throw new EightDaySignUpError("unknown_achievement");

    let player: Player | undefined;
    const updatedItemGuids = new Set<number>();
    const updatedMoneyIds = new Set<number>();
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      reconcileEightDaySignUp(player);

      const taskId = String(makeEightDaySignUpTaskId(achievementId));
      const taskValue = player.taskValues[taskId] ?? 0;
      if (hasClaimedEightDaySignUpReward(taskValue)) {
        throw new EightDaySignUpError("already_claimed");
      }
      if (eightDaySignUpProgress(taskValue) < reward.requiredDays) {
        throw new EightDaySignUpError("not_completed");
      }

      player.taskValues[taskId] = makeEightDaySignUpTaskValue(
        eightDaySignUpProgress(taskValue),
        true,
      );
      grantAwards(player, reward.awards, updatedItemGuids, updatedMoneyIds);
      state.schemaVersion = 9;
    });
    if (!player) {
      throw new Error(`Failed to claim eight-day sign-up award: ${account}`);
    }
    const snapshot = structuredClone(player);
    this.#logger.info("player.eight_day_sign_up.claimed", {
      account,
      achievementId,
      awards: reward.awards,
    });
    return {
      player: snapshot,
      achievementId,
      awards: reward.awards,
      updatedItems: snapshot.inventory.filter(({ guid }) => updatedItemGuids.has(guid)),
      updatedMoney: snapshot.money.filter(({ id }) => updatedMoneyIds.has(id)),
    };
  }

  async savePendingGacha(
    account: string,
    poolId: number,
    ten: boolean,
    roll: GachaRollResult,
  ): Promise<Player> {
    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      player.gacha ??= makeInitialGachaState();
      player.gacha.pending = {
        poolId,
        ten,
        awards: structuredClone(roll.awards),
        pity: roll.counters.pity,
        upPity: roll.counters.upPity,
        total: roll.counters.total,
      };
      state.schemaVersion = 9;
    });
    if (!player) throw new Error(`Failed to save pending gacha: ${account}`);
    return structuredClone(player);
  }

  async performGacha(
    account: string,
    pool: GachaPool,
    ten: boolean,
    roll: GachaRollResult,
    fromPending = false,
    kind: "card" | "weapon" = "card",
  ): Promise<GachaCommitResult> {
    let player: Player | undefined;
    const updatedItemGuids = new Set<number>();
    const updatedMoneyIds = new Set<number>();
    let getItem: Gdpln | null = null;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      player.gacha ??= makeInitialGachaState();
      deductGachaCost(player, pool, ten, updatedItemGuids, updatedMoneyIds);

      const pityTask = kind === "weapon" ? 1002 + pool.id : 2 + pool.id;
      player.taskValues[String(makeGachaTaskId(pityTask))] = roll.counters.pity;
      if (kind === "card" && pool.protectUpNum > 0) {
        player.taskValues[String(makeGachaTaskId(2001 + pool.id))] =
          roll.counters.upPity;
      }
      if (kind === "card") {
        player.taskValues[String(makeGachaTaskId(3001 + pool.id))] =
          roll.counters.total;
      }
      if (kind === "card" && pool.rotateVersion > 0) {
        player.taskValues[String(makeGachaTaskId(10_005))] = pool.rotateVersion;
      }
      const totalTask = kind === "weapon" ? 1001 : 1;
      player.taskValues[String(makeGachaTaskId(totalTask))] =
        (player.taskValues[String(makeGachaTaskId(totalTask))] ?? 0) +
        roll.awards.length;
      const operationTask =
        kind === "weapon" ? (ten ? 10_004 : 10_003) : ten ? 10_002 : 10_001;
      player.taskValues[String(makeGachaTaskId(operationTask))] =
        (player.taskValues[String(makeGachaTaskId(operationTask))] ?? 0) + 1;

      for (const award of roll.awards) {
        addInventoryAward(player, [...award.tbGDPL, 1], updatedItemGuids);
      }

      if (pool.getItem) {
        getItem = [...pool.getItem] as Gdpln;
        getItem[4] *= roll.awards.length;
        addInventoryAward(player, getItem, updatedItemGuids);
      }

      const wonUpBox =
        pool.upBox &&
        pool.upBoxNum > 0 &&
        roll.awards.some(
          ({ nTotalTimes }) =>
            nTotalTimes === pool.upBoxNum ||
            (pool.rotateVersion > 0 && nTotalTimes % pool.upBoxNum === 0),
        );
      if (wonUpBox && pool.upBox) {
        addInventoryAward(player, pool.upBox, updatedItemGuids);
      }
      if (fromPending) player.gacha.pending = null;
      state.schemaVersion = 9;
    });
    if (!player) throw new Error(`Failed to perform gacha: ${account}`);
    const snapshot = structuredClone(player);
    this.#logger.info("player.gacha.completed", {
      account,
      poolId: pool.id,
      kind,
      ten,
      awards: roll.awards.map(({ nId, tbGDPL, isUp }) => ({
        nId,
        tbGDPL,
        isUp,
      })),
      counters: roll.counters,
      fromPending,
    });
    return {
      player: snapshot,
      awards: structuredClone(roll.awards),
      updatedItems: snapshot.inventory.filter(({ guid }) => updatedItemGuids.has(guid)),
      updatedMoney: snapshot.money.filter(({ id }) => updatedMoneyIds.has(id)),
      getItem,
    };
  }

  async setGachaCustomUp(
    account: string,
    poolId: number,
    itemIds: readonly number[],
  ): Promise<Player> {
    const low = itemIds[0] ?? 0;
    const high = itemIds[1] ?? 0;
    const packed = (low & 0xffff) | ((high & 0xffff) << 16);
    return this.setTaskValues(account, [
      { id: makeGachaTaskId(6001 + poolId), value: packed >>> 0 },
      {
        id: makeGachaTaskId(7001 + poolId),
        value:
          (this.get(account)?.taskValues[String(makeGachaTaskId(7001 + poolId))] ?? 0) +
          1,
      },
    ]);
  }

  async setWeaponGachaCustomUp(
    account: string,
    poolId: number,
    itemIds: readonly number[],
  ): Promise<Player> {
    const low = itemIds[0] ?? 0;
    const high = itemIds[1] ?? 0;
    const packed = (low & 0xffff) | ((high & 0xffff) << 16);
    return this.setTaskValues(account, [
      { id: makeGachaTaskId(4001 + poolId), value: packed >>> 0 },
      {
        id: makeGachaTaskId(5001 + poolId),
        value:
          (this.get(account)?.taskValues[String(makeGachaTaskId(5001 + poolId))] ?? 0) +
          1,
      },
    ]);
  }

  async makeCoffee(
    account: string,
    coffeeType: number,
    count: number,
  ): Promise<Player> {
    if (!Number.isSafeInteger(coffeeType) || coffeeType <= 0) {
      throw new Error(`Invalid coffee type: ${coffeeType}`);
    }
    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new Error(`Invalid coffee count: ${count}`);
    }

    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      player.cafe ??= makeInitialCafeState();
      const coffee = player.cafe.coffees.find(
        (candidate) => candidate.coffeetype === coffeeType,
      );
      if (coffee) {
        coffee.count += count;
      } else {
        player.cafe.coffees.push({ coffeetype: coffeeType, count });
      }
      state.schemaVersion = 9;
    });
    this.#logger.info("player.cafe.coffee_made", {
      account,
      coffeeType,
      count,
    });
    if (!player) throw new Error(`Failed to make coffee for: ${account}`);
    return structuredClone(player);
  }

  async enhanceCard(
    account: string,
    guid: number,
    materials: readonly CardEnhancementMaterial[],
  ): Promise<CardEnhancementResult> {
    let player: Player | undefined;
    let enhancedCard: CharacterCardState | undefined;
    let addedExperience = 0;
    let coinCost = 0;
    const consumedItemGuids = new Set<number>();
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      enhancedCard = player.inventory.find(
        (entry) => entry.guid === guid && isCharacterCard(entry),
      );
      if (!enhancedCard) throw new Error(`Unknown character card: ${guid}`);

      for (const material of materials) {
        if (material.kind !== 1) {
          throw new Error(
            `Unsupported card enhancement material kind: ${material.kind}`,
          );
        }
        const definition = CARD_EXP_MATERIALS.get(material.reference);
        if (!definition) {
          throw new Error(
            `Unknown card experience material index: ${material.reference}`,
          );
        }
        const item = player.inventory.find(
          (candidate) =>
            candidate.genre === definition.genre &&
            candidate.detail === definition.detail &&
            candidate.particular === definition.particular &&
            candidate.templateLevel === definition.templateLevel,
        );
        if (!item || item.count < material.count) {
          throw new Error(
            `Insufficient card experience material: ${material.reference}`,
          );
        }
        item.count -= material.count;
        consumedItemGuids.add(item.guid);
        addedExperience += definition.experience * material.count;
        coinCost += definition.coinCost * material.count;
      }

      const gold = player.money.find(({ id }) => id === MONEY_GOLD);
      const availableGold = gold?.count ?? 0;
      if (availableGold < coinCost) {
        throw new InsufficientGoldError(coinCost, availableGold);
      }
      if (gold) gold.count -= coinCost;

      const enhanced = addCardExperience(
        enhancedCard.enhanceLevel,
        enhancedCard.enhanceExp,
        addedExperience,
      );
      enhancedCard.enhanceLevel = enhanced.level;
      enhancedCard.enhanceExp = enhanced.experience;
    });
    if (!player || !enhancedCard) {
      throw new Error(`Failed to enhance character card: ${guid}`);
    }

    this.#logger.info("player.card.enhanced", {
      account,
      guid,
      addedExperience,
      coinCost,
      level: enhancedCard.enhanceLevel,
      experience: enhancedCard.enhanceExp,
    });
    const snapshot = structuredClone(player);
    const card = snapshot.inventory.find(
      (candidate) => candidate.guid === guid && isCharacterCard(candidate),
    );
    if (!card) throw new Error(`Enhanced card disappeared: ${guid}`);
    return {
      player: snapshot,
      card,
      consumedItems: snapshot.inventory.filter(({ guid: itemGuid }) =>
        consumedItemGuids.has(itemGuid),
      ),
      addedExperience,
      coinCost,
      updatedMoney: snapshot.money.filter(({ id }) => id === MONEY_GOLD),
    };
  }

  async enhanceWeapon(
    account: string,
    guid: number,
    materials: readonly WeaponEnhancementMaterial[],
    rarityOf: (gdpl: Gdpl) => number | null,
  ): Promise<WeaponEnhancementResult> {
    let player: Player | undefined;
    let enhancedWeapon: InventoryItemState | undefined;
    let addedExperience = 0;
    let coinCost = 0;
    const consumedItemGuids = new Set<number>();
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      enhancedWeapon = player.inventory.find(
        (entry) => entry.guid === guid && isWeapon(entry),
      );
      if (!enhancedWeapon) throw new Error(`Unknown weapon: ${guid}`);

      const targetRarity = rarityOf([
        enhancedWeapon.genre,
        enhancedWeapon.detail,
        enhancedWeapon.particular,
        enhancedWeapon.templateLevel,
      ]);
      if (!targetRarity) throw new Error(`Unknown weapon rarity: ${guid}`);
      const maximumLevel = weaponMaximumLevel(targetRarity, enhancedWeapon.breakLevel);
      if (enhancedWeapon.enhanceLevel >= maximumLevel) {
        throw new Error(`Weapon is already at its level cap: ${guid}`);
      }

      const equippedWeapons = new Set(
        player.formations.flatMap(({ fightCards }) =>
          fightCards.map(({ weaponGuid }) => weaponGuid),
        ),
      );
      const evaluatedMaterials: Array<{
        item: InventoryItemState;
        count: number;
        experience: number;
        cost: number;
      }> = [];
      for (const material of materials) {
        const item = player.inventory.find(
          (candidate) => candidate.guid === material.guid,
        );
        if (!item || item.guid === guid || item.count < material.count) {
          throw new Error(`Invalid weapon enhancement material: ${material.guid}`);
        }

        if (isWeapon(item)) {
          if (material.count !== 1 || equippedWeapons.has(item.guid)) {
            throw new Error(`Weapon cannot be consumed: ${material.guid}`);
          }
          const rarity = rarityOf([
            item.genre,
            item.detail,
            item.particular,
            item.templateLevel,
          ]);
          const value = rarity
            ? sacrificedWeaponValue(item.enhanceLevel, rarity)
            : null;
          if (!value) throw new Error(`Unknown donor weapon: ${material.guid}`);
          evaluatedMaterials.push({
            item,
            count: 1,
            experience: value.experience,
            cost: value.coinCost,
          });
          addedExperience += value.experience;
          coinCost += value.coinCost;
          continue;
        }

        const definition = weaponExperienceMaterial(item);
        if (!definition) {
          throw new Error(`Unsupported weapon material: ${material.guid}`);
        }
        evaluatedMaterials.push({
          item,
          count: material.count,
          experience: definition.experience * material.count,
          cost: definition.coinCost * material.count,
        });
        addedExperience += definition.experience * material.count;
        coinCost += definition.coinCost * material.count;
      }

      const gold = player.money.find(({ id }) => id === MONEY_GOLD);
      const availableGold = gold?.count ?? 0;
      if (availableGold < coinCost) {
        throw new InsufficientGoldError(coinCost, availableGold);
      }
      for (const material of evaluatedMaterials) {
        material.item.count -= material.count;
        consumedItemGuids.add(material.item.guid);
      }
      if (gold) gold.count -= coinCost;

      const enhanced = addWeaponExperience(
        enhancedWeapon.enhanceLevel,
        enhancedWeapon.enhanceExp,
        addedExperience,
        maximumLevel,
      );
      enhancedWeapon.enhanceLevel = enhanced.level;
      enhancedWeapon.enhanceExp = enhanced.experience;
    });
    if (!player || !enhancedWeapon) {
      throw new Error(`Failed to enhance weapon: ${guid}`);
    }

    this.#logger.info("player.weapon.enhanced", {
      account,
      guid,
      addedExperience,
      coinCost,
      level: enhancedWeapon.enhanceLevel,
      experience: enhancedWeapon.enhanceExp,
    });
    const snapshot = structuredClone(player);
    const weapon = snapshot.inventory.find(
      (candidate) => candidate.guid === guid && isWeapon(candidate),
    );
    if (!weapon) throw new Error(`Enhanced weapon disappeared: ${guid}`);
    return {
      player: snapshot,
      weapon,
      consumedItems: snapshot.inventory.filter(({ guid: itemGuid }) =>
        consumedItemGuids.has(itemGuid),
      ),
      addedExperience,
      coinCost,
      updatedMoney: snapshot.money.filter(({ id }) => id === MONEY_GOLD),
    };
  }

  async updateFormation(account: string, formation: FormationState): Promise<Player> {
    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);

      const ownedCards = new Set(
        player.inventory.filter(isCharacterCard).map(({ guid }) => guid),
      );
      const ownedInventory = new Set(player.inventory.map(({ guid }) => guid));
      for (const fightCard of formation.fightCards) {
        const referencedCards = [
          fightCard.mainCardGuid,
          fightCard.usedCardGuid,
          ...fightCard.secondaryCardGuids,
        ].filter((guid) => guid > 0);
        if (referencedCards.some((guid) => !ownedCards.has(guid))) {
          throw new Error(`Formation ${formation.id} references an unknown card`);
        }
        const referencedEquipment = [
          fightCard.weaponGuid,
          ...fightCard.runeItemGuids,
        ].filter((guid) => guid > 0);
        if (referencedEquipment.some((guid) => !ownedInventory.has(guid))) {
          throw new Error(`Formation ${formation.id} references unknown equipment`);
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

  async replyToPhoneLetter(
    account: string,
    topicId: number,
    replyId: number,
  ): Promise<Player> {
    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      player.phone ??= migratePhoneState(player);
      const letter = player.phone.letters.find(
        (candidate) => candidate.topicId === topicId,
      );
      if (letter && !letter.replyIds.includes(replyId)) {
        letter.replyIds.push(replyId);
      }
      state.schemaVersion = 9;
    });
    if (!player) throw new Error(`Failed to reply to phone letter: ${account}`);
    return structuredClone(player);
  }

  async removePhoneLetter(account: string, topicId: number): Promise<Player> {
    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      player.phone ??= migratePhoneState(player);
      player.phone.letters = player.phone.letters.filter(
        (letter) => letter.topicId !== topicId,
      );
      state.schemaVersion = 9;
    });
    if (!player) throw new Error(`Failed to remove phone letter: ${account}`);
    return structuredClone(player);
  }

  async addPhoneLetter(
    account: string,
    letter: Omit<PhoneLetterState, "createTime" | "replyIds">,
  ): Promise<Player> {
    let player: Player | undefined;
    await this.#store.update((state) => {
      player = state.players[account];
      if (!player) throw new Error(`Unknown player account: ${account}`);
      player.phone ??= migratePhoneState(player);
      if (
        !player.phone.letters.some((candidate) => candidate.topicId === letter.topicId)
      ) {
        player.phone.letters.push({
          ...letter,
          createTime: unixTime(),
          replyIds: [],
        });
      }
      state.schemaVersion = 9;
    });
    if (!player) throw new Error(`Failed to add phone letter: ${account}`);
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
    let experienceUpdate: PlayerExperienceUpdate | undefined;
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
      player.phone ??= migratePhoneState(player);
      if (
        chapter === 1 &&
        index === 5 &&
        difficulty === 1 &&
        !player.phone.letters.some(({ topicId }) => topicId === 10_001)
      ) {
        player.phone.letters.push({
          topicId: 10_001,
          initiator: 7,
          createTime: unixTime(),
          replyIds: [],
        });
      }
      state.schemaVersion = 9;
      experienceUpdate = applyPlayerExperience(player, masterExp);
      if (experienceUpdate.vigourRecovery > 0) {
        updatedMoneyIds.add(MONEY_VIGOUR);
      }

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

        if (INSTANCE_GENRES.has(genre)) {
          for (let itemIndex = 0; itemIndex < count; itemIndex += 1) {
            const item: InventoryEntryState = {
              guid: player.nextItemGuid++,
              genre,
              detail,
              particular,
              templateLevel,
              count: 1,
              createTime: unixTime(),
              enhanceLevel: initialEnhanceLevel(genre),
              enhanceExp: 0,
              breakLevel: 0,
            };
            player.inventory.push(item);
            updatedItemGuids.add(item.guid);
          }
        } else {
          let item = player.inventory.find(
            (candidate) =>
              !isInventoryInstance(candidate) &&
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
            player.inventory.push(item);
          }
          item.count += count;
          updatedItemGuids.add(item.guid);
        }
      }
    });
    if (!player) throw new Error(`Failed to settle level: ${account}`);
    if (!experienceUpdate) throw new Error(`Failed to update experience: ${account}`);

    this.#logger.info("player.level.settled", {
      account,
      levelId,
      star: starMask,
      awards,
      masterExp,
      experienceUpdate,
    });
    const snapshot = structuredClone(player);
    return {
      player: snapshot,
      updatedItems: snapshot.inventory.filter(({ guid }) => updatedItemGuids.has(guid)),
      updatedMoney: snapshot.money.filter(({ id }) => updatedMoneyIds.has(id)),
      experienceUpdate,
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
    schemaVersion: 9,
    nextRoleId: 1,
    players: {},
    updatedAt: null,
  };
}
