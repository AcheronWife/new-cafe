import { createServer, type Server, type Socket } from "node:net";

import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { Player, PlayerRepository } from "../persistence/player-repository.js";
import { COMMAND, commandName } from "../protocol/commands.js";
import {
  makePlayerNotification,
  makeTaskValueSync,
  makeVerifyResponse,
  parseTaskChanges,
} from "../protocol/messages.js";
import { HEADER_SIZE, makePacket, readPacket } from "../protocol/packet.js";
import { decodeFields, firstString } from "../protocol/protobuf.js";

interface GatewayServerOptions {
  config: AppConfig;
  logger: Logger;
  players: PlayerRepository;
}

interface ConnectionContext {
  account: string;
  player: Player | null;
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

function describeLuaCall(payload: Buffer): { method: string; json: string } | null {
  try {
    const fields = decodeFields(payload);
    return {
      method: firstString(fields, 1),
      json: firstString(fields, 2),
    };
  } catch {
    return null;
  }
}

export function createGatewayServer({
  config,
  logger,
  players,
}: GatewayServerOptions): Server {
  return createServer((socket) => {
    const peer = peerName(socket);
    const context: ConnectionContext = { account: "offline", player: null };
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
        logger.info("session.verified", {
          peer,
          account: context.account,
          platform,
          roleId: context.player.roleId,
        });
        send(
          COMMAND.VERIFY_RSP,
          packet.serial,
          makeVerifyResponse(context.player, config.serverList),
        );
        return;
      }

      if (packet.command === COMMAND.LOGIN_REQ) {
        const fields = decodeFields(packet.payload);
        context.account = firstString(fields, 1, context.account);
        context.player = await players.getOrCreate(context.account);
        context.player = await players.markLogin(context.account);
        logger.info("session.login", {
          peer,
          account: context.account,
          roleId: context.player.roleId,
          channel: firstString(fields, 10),
        });

        send(COMMAND.PLAYER_NTF, 0, makePlayerNotification(context.player));
        await new Promise((resolve) => setTimeout(resolve, 20));
        send(COMMAND.TASK_VALUE_RSP, 0, makeTaskValueSync(context.player.taskValues));
        await new Promise((resolve) => setTimeout(resolve, 60));
        send(COMMAND.LOGIN_RSP, packet.serial);
        return;
      }

      if (packet.command === COMMAND.KEEP_ALIVE_REQ) {
        send(COMMAND.KEEP_ALIVE_RSP, packet.serial);
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
        logger.info("lua.call", {
          peer,
          account: context.account,
          ...(describeLuaCall(packet.payload) ?? {}),
        });
        send(COMMAND.C2S_CALL_RSP, packet.serial);
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
