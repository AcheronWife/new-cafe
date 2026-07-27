import { decodeFields, fieldBytes, fieldVarint, firstNumber } from "./protobuf.js";

import type { AppConfig } from "../config.js";
import type { Player, TaskChange } from "../persistence/player-repository.js";

export function makeVerifyResponse(
  player: Player,
  serverList: AppConfig["serverList"],
): Buffer {
  return Buffer.concat([
    fieldVarint(1, player.roleId),
    fieldVarint(2, serverList.id),
    fieldBytes(3, Buffer.alloc(16)),
    fieldVarint(5, serverList.aid),
    fieldVarint(6, serverList.sid),
    fieldVarint(7, 0),
    fieldVarint(8, Math.floor(Date.now() / 1000)),
    fieldVarint(9, 0),
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
    fieldBytes(10, Buffer.alloc(0)),
    fieldBytes(12, Buffer.alloc(0)),
    fieldVarint(20, player.roleId),
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
