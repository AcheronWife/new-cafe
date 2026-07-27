import {
  decodeFields,
  fieldBytes,
  fieldVarint,
  firstNumber,
  firstString,
} from "./protobuf.js";

import type { AppConfig } from "../config.js";
import type {
  CharacterCardState,
  FightCardState,
  FormationState,
  GirlState,
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
    fieldVarint(6, player.registerTime),
    fieldVarint(7, now),
    fieldVarint(8, now),
    fieldVarint(9, player.serverZone),
    fieldBytes(10, makeGirlList(player.girls)),
    ...player.formations.map((formation) =>
      fieldBytes(11, makeFormationInfo(formation)),
    ),
    fieldBytes(12, Buffer.alloc(0)),
    fieldVarint(20, player.roleId),
  ]);
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

export function makeFormationUpdateNotification(formation: FormationState): Buffer {
  return fieldBytes(1, makeFormationInfo(formation));
}

function makeItemInfo(card: CharacterCardState): Buffer {
  return Buffer.concat([
    fieldVarint(1, card.guid),
    fieldVarint(2, card.genre),
    fieldVarint(3, card.detail),
    fieldVarint(4, card.particular),
    fieldVarint(5, card.templateLevel),
    fieldVarint(6, card.count),
    fieldVarint(7, card.createTime),
    fieldVarint(8, card.enhanceLevel),
    fieldVarint(9, card.enhanceExp),
    fieldVarint(10, card.breakLevel),
  ]);
}

export function makeItemNotification(player: Player): Buffer {
  return Buffer.concat([
    ...player.cards.map((card) => fieldBytes(1, makeItemInfo(card))),
    fieldVarint(2, player.cards.length),
  ]);
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
