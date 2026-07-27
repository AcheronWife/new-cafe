import { createServer, type Server, type Socket } from "node:net";

import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type {
  FormationState,
  Player,
  PlayerRepository,
} from "../persistence/player-repository.js";
import { COMMAND, commandName } from "../protocol/commands.js";
import {
  makePlayerNotification,
  makeItemNotification,
  makeFormationUpdateNotification,
  makeServerLuaCall,
  makeTaskValueSync,
  makeVerifyResponse,
  parseRenameName,
  parseTaskChanges,
} from "../protocol/messages.js";
import { HEADER_SIZE, makePacket, readPacket } from "../protocol/packet.js";
import { decodeFields, firstNumber, firstString } from "../protocol/protobuf.js";

interface GatewayServerOptions {
  config: AppConfig;
  logger: Logger;
  players: PlayerRepository;
}

interface ConnectionContext {
  account: string;
  player: Player | null;
  isNewPlayer: boolean;
}

interface HexPreview {
  hex: string;
  truncated: boolean;
}

function peerName(socket: Socket): string {
  return `${socket.remoteAddress}:${socket.remotePort}`;
}

function hexPreview(buffer: Buffer, maxBytes: number): HexPreview {
  const preview = buffer.subarray(0, maxBytes);
  return {
    hex: preview.toString("hex"),
    truncated: preview.length < buffer.length,
  };
}

interface LuaCall {
  method: string;
  json: string;
  parameters: unknown;
}

function parseLuaCall(payload: Buffer): LuaCall | null {
  try {
    const fields = decodeFields(payload);
    const json = firstString(fields, 2);
    return {
      method: firstString(fields, 1),
      json,
      parameters: JSON.parse(json) as unknown,
    };
  } catch {
    return null;
  }
}

function isHeadTouchedCall(call: LuaCall | null): call is LuaCall & {
  parameters: { sCmd: "HeadTouched"; nId: number; nType: number };
} {
  if (
    call?.method !== "GirlLogic" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return false;
  }
  const parameters = call.parameters as Record<string, unknown>;
  return (
    parameters.sCmd === "HeadTouched" &&
    typeof parameters.nId === "number" &&
    typeof parameters.nType === "number"
  );
}

interface FormationUpdateCall {
  command: number;
  formation: FormationState;
}

function parseFormationUpdateCall(
  call: LuaCall | null,
  currentPlayer: Player | null,
): FormationUpdateCall | null {
  if (
    call?.method !== "LuaCall" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }
  const parameters = call.parameters as Record<string, unknown>;
  if (![21, 22, 23].includes(parameters.sCmd as number)) return null;
  if (typeof parameters.tbParam !== "object" || parameters.tbParam === null) {
    return null;
  }
  const update = parameters.tbParam as Record<string, unknown>;
  if (!Number.isSafeInteger(update.Id) || !Array.isArray(update.Info)) return null;

  const fightCards = update.Info.map((value) => {
    if (typeof value !== "object" || value === null) {
      throw new Error("Invalid formation card data");
    }
    const card = value as Record<string, unknown>;
    const numbers = (candidate: unknown): number[] =>
      Array.isArray(candidate)
        ? candidate.filter(
            (item): item is number => Number.isSafeInteger(item) && item > 0,
          )
        : [];
    return {
      mainCardGuid: Number(card.MainCard) || 0,
      secondaryCardGuids: numbers(card.Secondarycard),
      usedCardGuid: Number(card.UsedCard) || 0,
      weaponGuid: Number(card.WeaponId) || 0,
      runeItemGuids: numbers(card.Rune),
    };
  });
  const id = Number(update.Id);
  return {
    command: Number(parameters.sCmd),
    formation: {
      id,
      title:
        currentPlayer?.formations.find((formation) => formation.id === id)?.title ?? "",
      fightCards,
    },
  };
}

interface ChapterCall {
  state: number;
  parameters: Record<string, unknown>;
}

function parseChapterCall(call: LuaCall | null): ChapterCall | null {
  if (!call || typeof call.parameters !== "object" || call.parameters === null) {
    return null;
  }

  let parameters = call.parameters as Record<string, unknown>;
  if (call.method === "LuaCall") {
    if (parameters.sCmd !== 252) return null;
    if (typeof parameters.tbParam !== "object" || parameters.tbParam === null) {
      return null;
    }
    const wrappedCall = parameters.tbParam as Record<string, unknown>;
    if (
      wrappedCall.sCmd !== "ChapterMsg" ||
      typeof wrappedCall.tbParam !== "object" ||
      wrappedCall.tbParam === null
    ) {
      return null;
    }
    parameters = wrappedCall.tbParam as Record<string, unknown>;
  } else if (call.method !== "ChapterMsg") {
    return null;
  }

  const state = Number(parameters.nState);
  return Number.isSafeInteger(state) ? { state, parameters } : null;
}

export function createGatewayServer({
  config,
  logger,
  players,
}: GatewayServerOptions): Server {
  return createServer((socket) => {
    const peer = peerName(socket);
    const context: ConnectionContext = {
      account: "offline",
      player: null,
      isNewPlayer: false,
    };
    let pending = Buffer.alloc(0);
    let receiveQueue: Promise<void> = Promise.resolve();
    logger.info("gateway.connected", { peer });

    function send(
      command: number,
      serial: number,
      payload: Buffer = Buffer.alloc(0),
      returnCode = 0,
    ): void {
      const packet = makePacket(command, serial, payload, returnCode);
      socket.write(packet);
      const preview = hexPreview(packet, config.logging.maxPayloadHexBytes);
      logger.debug("gateway.send", {
        peer,
        command,
        commandName: commandName(command),
        serial,
        returnCode,
        packetBytes: packet.length,
        payloadBytes: payload.length,
        packetHex: preview.hex,
        packetHexTruncated: preview.truncated,
      });
    }

    async function handlePacket(packetBuffer: Buffer): Promise<void> {
      const packet = readPacket(packetBuffer);
      const preview = hexPreview(packet.payload, config.logging.maxPayloadHexBytes);
      logger.debug("gateway.receive", {
        peer,
        command: packet.command,
        commandName: commandName(packet.command),
        serial: packet.serial,
        returnCode: packet.returnCode,
        packetBytes: packet.size,
        payloadBytes: packet.payload.length,
        payloadHex: preview.hex,
        payloadHexTruncated: preview.truncated,
      });

      if (packet.command === COMMAND.VERIFY_REQ) {
        const fields = decodeFields(packet.payload);
        const platform = firstString(fields, 1);
        context.account = firstString(fields, 2, "offline");
        context.player = await players.getOrCreate(context.account);
        context.isNewPlayer = context.player.lastLoginAt === null;
        logger.info("session.verified", {
          peer,
          account: context.account,
          platform,
          roleId: context.player.roleId,
          isNewPlayer: context.isNewPlayer,
        });
        send(
          COMMAND.VERIFY_RSP,
          packet.serial,
          makeVerifyResponse(context.player, config.serverList, context.isNewPlayer),
        );
        return;
      }

      if (packet.command === COMMAND.LOGIN_REQ) {
        const fields = decodeFields(packet.payload);
        context.account = firstString(fields, 1, context.account);
        context.player = await players.getOrCreate(context.account);
        context.isNewPlayer = context.player.lastLoginAt === null;
        context.player = await players.markLogin(context.account);
        logger.info("session.login", {
          peer,
          account: context.account,
          roleId: context.player.roleId,
          channel: firstString(fields, 10),
          isNewPlayer: context.isNewPlayer,
          clientUserState: firstNumber(fields, 9),
        });

        send(COMMAND.TASK_VALUE_RSP, 0, makeTaskValueSync(context.player.taskValues));
        await new Promise((resolve) => setTimeout(resolve, 20));
        send(COMMAND.PLAYER_NTF, 0, makePlayerNotification(context.player));
        await new Promise((resolve) => setTimeout(resolve, 20));
        send(COMMAND.ITEM_NTF, 0, makeItemNotification(context.player));
        await new Promise((resolve) => setTimeout(resolve, 40));
        send(COMMAND.LOGIN_RSP, packet.serial);
        return;
      }

      if (packet.command === COMMAND.KEEP_ALIVE_REQ) {
        send(COMMAND.KEEP_ALIVE_RSP, packet.serial);
        return;
      }

      if (packet.command === COMMAND.RENAME_REQ) {
        const name = parseRenameName(packet.payload);
        context.player = await players.rename(context.account, name);
        send(COMMAND.RENAME_RSP, packet.serial);
        return;
      }

      if (packet.command === COMMAND.TASK_VALUE_REQ) {
        const player = context.player ?? (await players.getOrCreate(context.account));
        send(
          COMMAND.TASK_VALUE_RSP,
          packet.serial,
          makeTaskValueSync(player.taskValues),
        );
        return;
      }

      if (packet.command === COMMAND.TASK_CHANGE_REQ) {
        const changes = parseTaskChanges(packet.payload);
        context.player = await players.setTaskValues(context.account, changes);
        send(COMMAND.TASK_CHANGE_RSP, packet.serial, packet.payload);
        return;
      }

      if (packet.command === COMMAND.C2S_CALL_REQ) {
        const call = parseLuaCall(packet.payload);
        logger.info("lua.call", {
          peer,
          account: context.account,
          ...(call ? { method: call.method, json: call.json } : {}),
        });
        send(COMMAND.C2S_CALL_RSP, packet.serial);
        const formationUpdate = parseFormationUpdateCall(call, context.player);
        if (formationUpdate) {
          context.player = await players.updateFormation(
            context.account,
            formationUpdate.formation,
          );
          send(
            COMMAND.FORMATION_UPDATE_NTF,
            0,
            makeFormationUpdateNotification(formationUpdate.formation),
          );
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: formationUpdate.command,
              tbParam: { ret: 0 },
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "LuaCall",
            command: formationUpdate.command,
          });
        } else {
          const chapterCall = parseChapterCall(call);
          if (chapterCall?.state === 0) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("ChapterMsg", {
                nError: 0,
                nState: 0,
                tbEnter: [],
                tbDropItems: [],
              }),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "ChapterMsg",
              command: "enter",
            });
          } else if (chapterCall?.state === 1) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("ChapterMsg", {
                nError: 0,
                nState: 1,
                nStar: Number(chapterCall.parameters.nStar) || 0,
                tbAwards: [],
                tbExp: {
                  MasterExp: 0,
                  CardExp: 0,
                },
              }),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "ChapterMsg",
              command: "settlement",
            });
          } else if (isHeadTouchedCall(call)) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("GirlLogic", call.parameters),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: call.method,
              command: call.parameters.sCmd,
            });
          }
        }
        return;
      }

      logger.warn("gateway.unhandled", {
        peer,
        command: packet.command,
        commandName: commandName(packet.command),
        serial: packet.serial,
      });
    }

    socket.on("data", (data) => {
      pending = Buffer.concat([pending, data]);
      const packets = [];
      while (pending.length >= HEADER_SIZE) {
        const packetSize = pending.readUInt32LE(4);
        if (packetSize < HEADER_SIZE || packetSize > config.gateway.maxPacketBytes) {
          logger.error("gateway.invalid_packet_size", { peer, packetSize });
          socket.destroy();
          return;
        }
        if (pending.length < packetSize) break;
        packets.push(pending.subarray(0, packetSize));
        pending = pending.subarray(packetSize);
      }

      for (const packet of packets) {
        receiveQueue = receiveQueue
          .then(() => handlePacket(packet))
          .catch((error: unknown) => {
            const cause = error instanceof Error ? error : new Error(String(error));
            logger.error("gateway.packet_failed", {
              peer,
              message: cause.message,
              stack: cause.stack,
            });
          });
      }
    });

    socket.on("end", () => logger.info("gateway.ended", { peer }));
    socket.on("error", (error) =>
      logger.warn("gateway.socket_error", { peer, message: error.message }),
    );
  });
}
