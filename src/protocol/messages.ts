import {
  decodeFields,
  fieldBytes,
  fieldVarint,
  firstNumber,
  firstString,
} from "./protobuf.js";

import type { AppConfig } from "../config.js";
import type {
  FightCardState,
  FormationState,
  GirlState,
  InventoryEntryState,
  LevelState,
  MoneyState,
  Player,
  TaskChange,
} from "../persistence/player-repository.js";

export function parseRenameName(payload: Buffer): string {
  return firstString(decodeFields(payload), 3);
}

export function makeServerLuaCall(method: string, parameters: unknown): Buffer {
  return Buffer.concat([
    fieldBytes(1, method),
    fieldBytes(2, JSON.stringify(parameters)),
  ]);
}

export function makeHouseInfoResponse(roleId: number): Buffer {
  const roomIds = [1, 2, 6];
  const houseCache = Buffer.concat([
    fieldVarint(1, roleId),
    ...roomIds.map((roomId) => fieldBytes(4, fieldVarint(1, roomId))),
  ]);
  return Buffer.concat([
    fieldVarint(1, roleId),
    fieldBytes(2, houseCache),
    fieldBytes(3, Buffer.alloc(0)),
  ]);
}

export function makeVerifyResponse(
  player: Player,
  serverList: AppConfig["serverList"],
  createRole: boolean,
): Buffer {
  return Buffer.concat([
    fieldVarint(1, player.roleId),
    fieldVarint(2, serverList.id),
    fieldBytes(3, Buffer.alloc(16)),
    fieldVarint(5, serverList.aid),
    fieldVarint(6, serverList.sid),
    fieldVarint(7, 0),
    fieldVarint(8, Math.floor(Date.now() / 1000)),
    fieldVarint(9, createRole ? 1 : 0),
    fieldBytes(10, player.account),
  ]);
}

export function makePlayerNotification(player: Player): Buffer {
  const now = Math.floor(Date.now() / 1000);
  return Buffer.concat([
    fieldBytes(1, player.name),
    fieldVarint(2, player.level),
    fieldVarint(3, player.exp),
    fieldVarint(4, player.fightPower),
    ...player.money.map((money) => fieldBytes(5, makeMoneyInfo(money))),
    fieldVarint(6, player.registerTime),
    fieldVarint(7, now),
    fieldVarint(8, now),
    fieldVarint(9, player.serverZone),
    fieldBytes(10, makeGirlList(player.girls)),
    ...player.formations.map((formation) =>
      fieldBytes(11, makeFormationInfo(formation)),
    ),
    fieldBytes(12, makeLevelList(player.levels)),
    fieldVarint(20, player.roleId),
  ]);
}

/**
 * PlayerDataNtf uses two parallel repeated fields. Update types 1 and 2 are
 * player level and residual experience respectively.
 */
export function makePlayerUpdateNotification(player: Player): Buffer {
  return Buffer.concat([
    fieldVarint(1, 1),
    fieldVarint(1, 2),
    fieldVarint(2, player.level),
    fieldVarint(2, player.exp),
  ]);
}

/**
 * Encodes the login-time PhoneMsgNtf consumed by Game.PhoneMsgMgr.
 */
export function makePhoneMessageNotification(player: Player): Buffer {
  const byInitiator = new Map<number, typeof player.phone.letters>();
  for (const letter of player.phone.letters) {
    const topics = byInitiator.get(letter.initiator) ?? [];
    topics.push(letter);
    byInitiator.set(letter.initiator, topics);
  }

  return Buffer.concat(
    [...byInitiator.entries()].map(([initiator, topics]) => {
      const latestCreateTime = Math.max(
        player.registerTime,
        ...topics.map(({ createTime }) => createTime),
      );
      const letter = Buffer.concat([
        fieldVarint(1, initiator),
        fieldVarint(3, latestCreateTime),
        ...topics.map((topicState) => {
          const topic = Buffer.concat([
            fieldVarint(1, topicState.topicId),
            ...topicState.replyIds.map((replyId) => fieldVarint(2, replyId)),
          ]);
          return fieldBytes(4, topic);
        }),
        fieldVarint(5, 0),
      ]);
      return fieldBytes(1, letter);
    }),
  );
}

function makeGirlInfo(girl: GirlState): Buffer {
  return Buffer.concat([
    fieldVarint(1, girl.girlId),
    fieldVarint(2, girl.level),
    fieldVarint(3, girl.exp),
    fieldVarint(4, girl.modelId),
    fieldVarint(5, girl.moodValue),
    fieldVarint(6, girl.vigor),
    fieldVarint(7, girl.flag),
  ]);
}

function makeGirlList(girls: readonly GirlState[]): Buffer {
  return Buffer.concat(girls.map((girl) => fieldBytes(1, makeGirlInfo(girl))));
}

function makeFightCard(card: FightCardState): Buffer {
  return Buffer.concat([
    fieldVarint(1, card.mainCardGuid),
    ...card.secondaryCardGuids.map((guid) => fieldVarint(2, guid)),
    fieldVarint(3, card.usedCardGuid),
    fieldVarint(4, card.weaponGuid),
    ...card.runeItemGuids.map((guid) => fieldVarint(5, guid)),
  ]);
}

function makeFormationInfo(formation: FormationState): Buffer {
  return Buffer.concat([
    fieldVarint(1, formation.id),
    ...formation.fightCards.map((card) => fieldBytes(2, makeFightCard(card))),
    fieldBytes(3, formation.title),
  ]);
}

function makeLevel(level: LevelState): Buffer {
  return Buffer.concat([fieldVarint(1, level.id), fieldVarint(2, level.star)]);
}

function makeLevelList(levels: readonly LevelState[]): Buffer {
  return Buffer.concat(levels.map((level) => fieldBytes(1, makeLevel(level))));
}

export function makeFormationUpdateNotification(formation: FormationState): Buffer {
  return fieldBytes(1, makeFormationInfo(formation));
}

function makeItemInfo(item: InventoryEntryState): Buffer {
  return Buffer.concat([
    fieldVarint(1, item.guid),
    fieldVarint(2, item.genre),
    fieldVarint(3, item.detail),
    fieldVarint(4, item.particular),
    fieldVarint(5, item.templateLevel),
    fieldVarint(6, item.count),
    fieldVarint(7, item.createTime),
    fieldVarint(8, item.enhanceLevel),
    fieldVarint(9, item.enhanceExp),
    fieldVarint(10, item.breakLevel),
  ]);
}

export function makeItemNotification(player: Player): Buffer {
  return Buffer.concat([
    ...player.inventory.map((item) => fieldBytes(1, makeItemInfo(item))),
    fieldVarint(2, player.inventory.length),
  ]);
}

export function makeItemUpdateNotification(
  items: readonly InventoryEntryState[],
): Buffer {
  return Buffer.concat(items.map((item) => fieldBytes(1, makeItemInfo(item))));
}

function makeMoneyInfo(money: MoneyState): Buffer {
  return Buffer.concat([fieldVarint(1, money.id), fieldVarint(2, money.count)]);
}

export function makeMoneyUpdateNotification(money: MoneyState): Buffer {
  return fieldBytes(1, makeMoneyInfo(money));
}

export function makeTaskValueSync(
  taskValues: Readonly<Record<string, number>> = {},
): Buffer {
  return Buffer.concat(
    Object.entries(taskValues)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([id, value]) => {
        const task = Buffer.concat([fieldVarint(1, Number(id)), fieldVarint(2, value)]);
        return fieldBytes(1, task);
      }),
  );
}

export function parseTaskChanges(payload: Buffer): TaskChange[] {
  const changes: TaskChange[] = [];
  for (const field of decodeFields(payload)) {
    if (
      field.fieldNumber === 1 &&
      field.wireType === 2 &&
      Buffer.isBuffer(field.value)
    ) {
      const taskFields = decodeFields(field.value);
      const change = {
        id: firstNumber(taskFields, 1),
        value: firstNumber(taskFields, 2),
      };
      if (change.id > 0) changes.push(change);
    }
  }
  return changes;
}
