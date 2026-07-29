import { createServer, type Server, type Socket } from "node:net";

import type { AppConfig } from "../config.js";
import { makeBackgroundLuaResponse } from "../game-data/background-lua-data.js";
import {
  LUA_COMMAND_CARD_LEVEL_UP_COMMON,
  parseCardEnhancementRequest,
} from "../game-data/card-enhancement-data.js";
import { parseWeaponEnhancementRequest } from "../game-data/weapon-enhancement-data.js";
import {
  ChapterCatalog,
  effectiveEnergyCost,
  rollChapterAwards,
  type ChapterLevelConfig,
} from "../game-data/chapter-config.js";
import {
  LUA_COMMAND_CAFE_ADD_GUEST_WEIGHT,
  LUA_COMMAND_CAFE_DATA,
  LUA_COMMAND_CAFE_FURNITURE_COUNT,
  LUA_COMMAND_CAFE_GENERATE_CUSTOMER,
  LUA_COMMAND_CAFE_MAKE_COFFEE,
  LUA_COMMAND_CAFE_SET_WAITER_LIST,
  makeCafeCustomerQueue,
  makeCafePetResponse,
  makeCoffeeResponse,
  makeInitialCafeData,
} from "../game-data/cafe-data.js";
import {
  LUA_COMMAND_WRITE_GUIDE_LOG,
  makeGuideLogAcknowledgement,
} from "../game-data/guide-data.js";
import { EIGHT_DAY_SIGN_UP_ACTIVITY_ID } from "../game-data/eight-day-sign-up-data.js";
import { GachaCatalog, type GachaRollResult } from "../game-data/gacha-data.js";
import {
  LUA_COMMAND_SHOP_GOODS_LIST,
  makeShopGoodsListResponse,
} from "../game-data/shop-data.js";
import {
  getPhoneLetterDefinition,
  makePhoneReplyId,
} from "../game-data/phone-message-data.js";
import type { Logger } from "../logger.js";
import {
  InsufficientGoldError,
  InsufficientVigourError,
  InsufficientGachaCurrencyError,
  EightDaySignUpError,
  GuideMissionError,
  GirlTrainingError,
  isCharacterCard,
  makeGachaTaskId,
  makeLevelId,
  MONEY_VIGOUR,
  type FormationState,
  type GirlState,
  type Player,
  type PlayerRepository,
} from "../persistence/player-repository.js";
import { COMMAND, commandName } from "../protocol/commands.js";
import {
  makePlayerNotification,
  makeItemNotification,
  makeItemUpdateNotification,
  makeFormationUpdateNotification,
  makeGirlUpdateNotification,
  makeHouseInfoResponse,
  makeLive2DEnableLevelNotification,
  makeLive2DHXNotification,
  makeMoneyUpdateNotification,
  makePhoneMessageNotification,
  makeServerLuaCall,
  makeTaskValueSync,
  makeVerifyResponse,
  makePlayerUpdateNotification,
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
  activeChapter: {
    level: ChapterLevelConfig;
    firstClear: boolean;
    passCount: number;
  } | null;
  lastSettlement: {
    key: string;
    response: Record<string, unknown>;
  } | null;
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

type GirlAppearanceCall =
  | { command: "SetMainGirl"; girlId: number }
  | { command: "ChangeCloth"; girlId: number; modelId: number }
  | { command: "SetModelInFight"; girlId: number; enabled: boolean };

interface GirlTrainingCall {
  girlId: number;
  position: number;
}

function parseGirlTrainingCall(call: LuaCall | null): GirlTrainingCall | null {
  if (
    call?.method !== "GirlLogic" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }

  const parameters = call.parameters as Record<string, unknown>;
  if (parameters.sCmd !== "StartTrain") return null;
  const girlId = Number(parameters.nId);
  const position = Number(parameters.nPos);
  return Number.isSafeInteger(girlId) &&
    girlId > 0 &&
    Number.isSafeInteger(position) &&
    position > 0
    ? { girlId, position }
    : null;
}

function parseGirlAppearanceCall(call: LuaCall | null): GirlAppearanceCall | null {
  if (
    call?.method !== "GirlLogic" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }

  const parameters = call.parameters as Record<string, unknown>;
  const girlId = Number(parameters.nId);
  if (!Number.isSafeInteger(girlId) || girlId <= 0) return null;

  if (parameters.sCmd === "SetMainGirl") {
    return { command: "SetMainGirl", girlId };
  }
  if (parameters.sCmd === "ChangeCloth") {
    const modelId = Number(parameters.nSuit);
    return Number.isSafeInteger(modelId) && modelId > 0
      ? { command: "ChangeCloth", girlId, modelId }
      : null;
  }
  if (parameters.sCmd === "SetModelInFight") {
    const use = Number(parameters.nUse);
    return use === 0 || use === 1
      ? { command: "SetModelInFight", girlId, enabled: use === 1 }
      : null;
  }
  return null;
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

function parseNumericLuaCommand(call: LuaCall | null): number | null {
  if (
    call?.method !== "LuaCall" ||
    typeof call.parameters !== "object" ||
    call.parameters === null
  ) {
    return null;
  }
  const command = Number((call.parameters as Record<string, unknown>).sCmd);
  return Number.isSafeInteger(command) ? command : null;
}

export function createGatewayServer({
  config,
  logger,
  players,
}: GatewayServerOptions): Server {
  const chapterCatalog = ChapterCatalog.loadDefault();
  const gachaCatalog = GachaCatalog.loadDefault();
  const weaponGachaCatalog = GachaCatalog.loadDefault(0);
  logger.info("game_data.chapter.loaded", { levels: chapterCatalog.size });
  logger.info("game_data.gacha.loaded", { pools: gachaCatalog.size });
  logger.info("game_data.weapon_gacha.loaded", { pools: weaponGachaCatalog.size });
  return createServer((socket) => {
    const peer = peerName(socket);
    const context: ConnectionContext = {
      account: "offline",
      player: null,
      isNewPlayer: false,
      activeChapter: null,
      lastSettlement: null,
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

    function sendGirlUpdates(girls: readonly GirlState[]): void {
      if (girls.length === 0) return;
      send(COMMAND.GIRL_UPDATE_NTF, 0, makeGirlUpdateNotification(girls));
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
        send(
          COMMAND.LIVE2D_ENABLE_LEVEL_NTF,
          0,
          makeLive2DEnableLevelNotification(context.player.live2dEnableLevel),
        );
        send(
          COMMAND.LIVE2D_HX_STATE_NTF,
          0,
          makeLive2DHXNotification(context.player.live2dHX),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        send(COMMAND.PLAYER_NTF, 0, makePlayerNotification(context.player));
        await new Promise((resolve) => setTimeout(resolve, 20));
        send(COMMAND.ITEM_NTF, 0, makeItemNotification(context.player));
        await new Promise((resolve) => setTimeout(resolve, 20));
        send(COMMAND.PHONE_MSG_NTF, 0, makePhoneMessageNotification(context.player));
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

      if (packet.command === COMMAND.GET_HOUSEINFO_REQ) {
        const requestedRoleId = firstNumber(
          decodeFields(packet.payload),
          1,
          context.player?.roleId ?? 1,
        );
        send(
          COMMAND.GET_HOUSEINFO_RSP,
          packet.serial,
          makeHouseInfoResponse(requestedRoleId),
        );
        logger.info("house.info.response", {
          peer,
          account: context.account,
          roleId: requestedRoleId,
          furnitureCount: 0,
        });
        return;
      }

      if (packet.command === COMMAND.HOUSE_RANDOM_REQ) {
        send(COMMAND.HOUSE_RANDOM_RSP, packet.serial);
        logger.info("house.random.response", {
          peer,
          account: context.account,
          roleCount: 0,
        });
        return;
      }

      if (packet.command === COMMAND.C2S_CALL_REQ) {
        const call = parseLuaCall(packet.payload);
        const luaCommand = parseNumericLuaCommand(call);
        const girlTrainingCall = parseGirlTrainingCall(call);
        const girlAppearanceCall = parseGirlAppearanceCall(call);
        logger.info("lua.call", {
          peer,
          account: context.account,
          ...(call ? { method: call.method, json: call.json } : {}),
        });
        send(COMMAND.C2S_CALL_RSP, packet.serial);
        if (call?.method === "SignUpMsg") {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const signUpType = Number(parameters.nType);
          if (signUpType !== 1) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("NormalActivityMsg", {
                nType: 3,
                nSubType: signUpType,
                bSuccess: false,
                tbAward: [],
                isRefreshSign: false,
              }),
            );
            logger.warn("daily_sign_up.unsupported_type", {
              peer,
              account: context.account,
              signUpType,
            });
            return;
          }

          const result = await players.signUpDaily(context.account);
          context.player = result.player;
          send(COMMAND.TASK_VALUE_RSP, 0, makeTaskValueSync(result.player.taskValues));
          if (result.updatedItems.length > 0) {
            send(
              COMMAND.ITEM_UPDATE_NTF,
              0,
              makeItemUpdateNotification(result.updatedItems),
            );
          }
          sendGirlUpdates(result.updatedGirls);
          for (const money of result.updatedMoney) {
            send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
          }
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("NormalActivityMsg", {
              nType: 3,
              nSubType: 1,
              bSuccess: true,
              tbAward: result.award ? [result.award] : [],
              isRefreshSign: result.fresh,
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "NormalActivityMsg",
            feature: "daily_sign_up",
            fresh: result.fresh,
            cumulativeCount: result.cumulativeCount,
            award: result.award,
          });
          return;
        }
        if (call?.method === "NormalActivityGetAward") {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const activityId = Number(parameters.nActivityId);
          const achievementId = Number(parameters.nId);
          if (activityId === EIGHT_DAY_SIGN_UP_ACTIVITY_ID) {
            try {
              const result = await players.claimEightDaySignUpAward(
                context.account,
                achievementId,
              );
              context.player = result.player;
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(result.player.taskValues),
              );
              if (result.updatedItems.length > 0) {
                send(
                  COMMAND.ITEM_UPDATE_NTF,
                  0,
                  makeItemUpdateNotification(result.updatedItems),
                );
              }
              sendGirlUpdates(result.updatedGirls);
              for (const money of result.updatedMoney) {
                send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
              }
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(result.player.taskValues),
              );
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("MissionMgrMsg", {
                  nError: 0,
                  nMission: 0,
                }),
              );
              logger.info("lua.callback", {
                peer,
                account: context.account,
                method: "MissionMgrMsg",
                feature: "eight_day_sign_up.award",
                activityId,
                achievementId,
                awards: result.awards,
              });
            } catch (error) {
              if (!(error instanceof EightDaySignUpError)) throw error;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("MissionMgrMsg", {
                  nError: 1,
                  nMission: 0,
                }),
              );
              logger.warn("eight_day_sign_up.claim_rejected", {
                peer,
                account: context.account,
                activityId,
                achievementId,
                reason: error.reason,
              });
            }
            return;
          }
        }
        if (
          call?.method === "GuideMissionGetAward" ||
          call?.method === "GuideProgressGetAward"
        ) {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const id = Number(parameters.nId);
          const missionType = call.method === "GuideMissionGetAward" ? 3 : 4;
          try {
            const result =
              call.method === "GuideMissionGetAward"
                ? await players.claimGuideMissionAward(context.account, id)
                : await players.claimGuideProgressAward(context.account, id);
            context.player = result.player;
            send(
              COMMAND.TASK_VALUE_RSP,
              0,
              makeTaskValueSync(result.player.taskValues),
            );
            if (result.updatedItems.length > 0) {
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification(result.updatedItems),
              );
            }
            for (const money of result.updatedMoney) {
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
            }
            sendGirlUpdates(result.updatedGirls);
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("MissionMgrMsg", {
                nError: 0,
                nMission: missionType,
              }),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "MissionMgrMsg",
              feature:
                missionType === 3 ? "guide_mission.award" : "guide_progress.award",
              id,
              awards: result.awards,
            });
          } catch (error) {
            if (!(error instanceof GuideMissionError)) throw error;
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("MissionMgrMsg", {
                nError: 1,
                nMission: missionType,
              }),
            );
            logger.warn("guide_mission.claim_rejected", {
              peer,
              account: context.account,
              method: call.method,
              id,
              reason: error.reason,
            });
          }
          return;
        }
        if (call?.method === "Lottery" || call?.method === "GetFirstGacha") {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const poolId = call.method === "GetFirstGacha" ? 666 : Number(parameters.nId);
          const ten = call.method === "GetFirstGacha" ? true : parameters.bTen === true;
          const pool = gachaCatalog.get(poolId);
          if (!pool) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("Lottery", { err: "error.gacha.notexists" }),
            );
            return;
          }
          const currentPlayer =
            context.player ?? (await players.getOrCreate(context.account));
          const pity =
            currentPlayer.taskValues[String(makeGachaTaskId(2 + poolId))] ?? 0;
          let upPity =
            currentPlayer.taskValues[String(makeGachaTaskId(2001 + poolId))] ?? 0;
          const storedRotationVersion =
            currentPlayer.taskValues[String(makeGachaTaskId(10_005))] ?? 0;
          if (pool.rotateVersion > 0 && storedRotationVersion !== pool.rotateVersion) {
            upPity = 0;
          }
          const total =
            currentPlayer.taskValues[String(makeGachaTaskId(3001 + poolId))] ?? 0;
          const selectedPacked =
            currentPlayer.taskValues[String(makeGachaTaskId(6001 + poolId))] ?? 0;
          const selectedUpIds = [
            selectedPacked & 0xffff,
            (selectedPacked >>> 16) & 0xffff,
          ].filter((id) => id > 0);
          const ownedCards = new Set(
            currentPlayer.inventory
              .filter(isCharacterCard)
              .map(
                ({ genre, detail, particular, templateLevel }) =>
                  `${genre}:${detail}:${particular}:${templateLevel}`,
              ),
          );
          try {
            const roll = gachaCatalog.roll(
              poolId,
              ten,
              { pity, upPity, total },
              ownedCards,
              selectedUpIds,
            );
            if (pool.judgeType === 2 && call.method !== "GetFirstGacha") {
              context.player = await players.savePendingGacha(
                context.account,
                poolId,
                ten,
                roll,
              );
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("Lottery", {
                  bTen: ten,
                  bGetCard: false,
                  tbAwards: roll.awards,
                  ...(pool.getItem
                    ? {
                        getItem: [
                          ...pool.getItem.slice(0, 4),
                          pool.getItem[4] * roll.awards.length,
                        ],
                      }
                    : {}),
                }),
              );
              logger.info("gacha.pending.saved", {
                account: context.account,
                poolId,
                awards: roll.awards.length,
              });
              return;
            }
            const result = await players.performGacha(context.account, pool, ten, roll);
            context.player = result.player;
            if (result.updatedItems.length > 0) {
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification(result.updatedItems),
              );
            }
            sendGirlUpdates(result.updatedGirls);
            for (const money of result.updatedMoney) {
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
            }
            send(
              COMMAND.TASK_VALUE_RSP,
              0,
              makeTaskValueSync(result.player.taskValues),
            );
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("Lottery", {
                bTen: ten,
                bGetCard: true,
                tbAwards: result.awards,
                ...(result.getItem ? { getItem: result.getItem } : {}),
              }),
            );
            logger.info("gacha.response", {
              account: context.account,
              poolId,
              ten,
              awards: result.awards.length,
            });
          } catch (error) {
            if (error instanceof InsufficientGachaCurrencyError) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("Lottery", {
                  err: "error.gacha.cash",
                }),
              );
              logger.warn("gacha.insufficient_currency", {
                account: context.account,
                poolId,
              });
              return;
            }
            throw error;
          }
          return;
        }
        if (call?.method === "WeaponLogicMsg") {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const weaponCommand = Number(parameters.nCmd);
          if (weaponCommand === 1) {
            const request = parseWeaponEnhancementRequest(parameters);
            if (!request) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError: 1,
                  nCmd: weaponCommand,
                }),
              );
              logger.warn("weapon.enhance.invalid_request", {
                account: context.account,
                parameters,
              });
              return;
            }
            try {
              const result = await players.enhanceWeapon(
                context.account,
                request.guid,
                request.materials,
                (gdpl) => weaponGachaCatalog.rarityOf(gdpl),
              );
              context.player = result.player;
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification([result.weapon, ...result.consumedItems]),
              );
              for (const money of result.updatedMoney) {
                send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
              }
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError: 0,
                  nCmd: weaponCommand,
                }),
              );
              logger.info("weapon.enhance.response", {
                account: context.account,
                guid: request.guid,
                materials: request.materials,
                addedExperience: result.addedExperience,
                coinCost: result.coinCost,
                level: result.weapon.enhanceLevel,
                experience: result.weapon.enhanceExp,
              });
            } catch (error) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError: 1,
                  nCmd: weaponCommand,
                }),
              );
              logger.warn("weapon.enhance.rejected", {
                account: context.account,
                guid: request.guid,
                error: error instanceof Error ? error.message : String(error),
              });
            }
            return;
          }
          if (weaponCommand === 0) {
            const poolId = Number(parameters.Id);
            const ten = parameters.isTen === true;
            const pool = weaponGachaCatalog.get(poolId);
            if (!pool) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError: 20096,
                  nCmd: weaponCommand,
                }),
              );
              logger.warn("weapon_gacha.pool_not_found", {
                account: context.account,
                poolId,
              });
              return;
            }
            const currentPlayer =
              context.player ?? (await players.getOrCreate(context.account));
            const pity =
              currentPlayer.taskValues[String(makeGachaTaskId(1002 + poolId))] ?? 0;
            const total = currentPlayer.taskValues[String(makeGachaTaskId(1001))] ?? 0;
            const selectedPacked =
              currentPlayer.taskValues[String(makeGachaTaskId(4001 + poolId))] ?? 0;
            const selectedUpIds = [
              selectedPacked & 0xffff,
              (selectedPacked >>> 16) & 0xffff,
            ].filter((id) => id > 0);
            const ownedWeapons = new Set(
              currentPlayer.inventory
                .filter(({ genre }) => genre === 2)
                .map(
                  ({ genre, detail, particular, templateLevel }) =>
                    `${genre}:${detail}:${particular}:${templateLevel}`,
                ),
            );
            try {
              const roll = weaponGachaCatalog.roll(
                poolId,
                ten,
                { pity, upPity: 0, total },
                ownedWeapons,
                selectedUpIds,
              );
              const result = await players.performGacha(
                context.account,
                pool,
                ten,
                roll,
                false,
                "weapon",
              );
              context.player = result.player;
              if (result.updatedItems.length > 0) {
                send(
                  COMMAND.ITEM_UPDATE_NTF,
                  0,
                  makeItemUpdateNotification(result.updatedItems),
                );
              }
              sendGirlUpdates(result.updatedGirls);
              for (const money of result.updatedMoney) {
                send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
              }
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(result.player.taskValues),
              );
              const weapons = result.updatedItems
                .filter(({ genre }) => genre === 2)
                .map(({ guid }) => ({ nGuid: guid }));
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError: 0,
                  nCmd: weaponCommand,
                  tbParam: weapons,
                }),
              );
              logger.info("weapon_gacha.response", {
                account: context.account,
                poolId,
                ten,
                awards: result.awards.length,
                weaponGuids: weapons.map(({ nGuid }) => nGuid),
              });
            } catch (error) {
              if (!(error instanceof InsufficientGachaCurrencyError)) throw error;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("WeaponLogicMsg", {
                  nError: 1,
                  nCmd: weaponCommand,
                }),
              );
              logger.warn("weapon_gacha.insufficient_currency", {
                account: context.account,
                poolId,
              });
            }
            return;
          }
        }
        if (call?.method === "SetWeaponCustomUp") {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const poolId = Number(parameters.nId);
          const pool = weaponGachaCatalog.get(poolId);
          const availableIds = new Set(
            [...(pool?.normalCards.get(4) ?? [])].map(({ id }) => id),
          );
          const itemIds = [
            ...new Set(
              (Array.isArray(parameters.tbItems) ? parameters.tbItems : [])
                .map(Number)
                .filter(
                  (id) => Number.isSafeInteger(id) && id > 0 && availableIds.has(id),
                ),
            ),
          ].slice(0, 2);
          if (!pool || pool.judgeType !== 1 || itemIds.length !== 2) {
            logger.warn("weapon_gacha.custom_up.rejected", {
              account: context.account,
              poolId,
              itemIds,
            });
            return;
          }
          context.player = await players.setWeaponGachaCustomUp(
            context.account,
            poolId,
            itemIds,
          );
          send(COMMAND.TASK_VALUE_RSP, 0, makeTaskValueSync(context.player.taskValues));
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("SetWeaponCustomUp", { nId: poolId }),
          );
          logger.info("weapon_gacha.custom_up.updated", {
            account: context.account,
            poolId,
            itemIds,
          });
          return;
        }
        if (call?.method === "GetLastGacha") {
          const currentPlayer =
            context.player ?? (await players.getOrCreate(context.account));
          const pendingGacha = currentPlayer.gacha?.pending;
          if (!pendingGacha) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("GetLastGacha", {
                err: "error.gacha.nolast",
              }),
            );
            return;
          }
          const shouldClaim = call.parameters === true;
          if (!shouldClaim) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("GetLastGacha", {
                bTen: pendingGacha.ten,
                bGetCard: false,
                tbAwards: pendingGacha.awards,
              }),
            );
            return;
          }
          const pool = gachaCatalog.get(pendingGacha.poolId);
          if (!pool) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("GetLastGacha", {
                err: "error.gacha.nolast",
              }),
            );
            return;
          }
          const roll: GachaRollResult = {
            awards: pendingGacha.awards,
            counters: {
              pity: pendingGacha.pity,
              upPity: pendingGacha.upPity,
              total: pendingGacha.total,
            },
          };
          try {
            const result = await players.performGacha(
              context.account,
              pool,
              pendingGacha.ten,
              roll,
              true,
            );
            context.player = result.player;
            if (result.updatedItems.length > 0) {
              send(
                COMMAND.ITEM_UPDATE_NTF,
                0,
                makeItemUpdateNotification(result.updatedItems),
              );
            }
            sendGirlUpdates(result.updatedGirls);
            for (const money of result.updatedMoney) {
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
            }
            send(
              COMMAND.TASK_VALUE_RSP,
              0,
              makeTaskValueSync(result.player.taskValues),
            );
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("GetLastGacha", {
                bTen: true,
                bGetCard: true,
                tbAwards: result.awards,
                ...(result.getItem ? { getItem: result.getItem } : {}),
              }),
            );
          } catch (error) {
            if (error instanceof InsufficientGachaCurrencyError) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("Lottery", {
                  err: "error.gacha.cash",
                }),
              );
              return;
            }
            throw error;
          }
          return;
        }
        if (call?.method === "SetCardCustomUp") {
          const parameters =
            call.parameters && typeof call.parameters === "object"
              ? (call.parameters as Record<string, unknown>)
              : {};
          const poolId = Number(parameters.nId);
          const itemIds = Array.isArray(parameters.tbItems)
            ? parameters.tbItems
                .map(Number)
                .filter((id) => Number.isSafeInteger(id) && id > 0)
            : [];
          context.player = await players.setGachaCustomUp(
            context.account,
            poolId,
            itemIds,
          );
          send(COMMAND.TASK_VALUE_RSP, 0, makeTaskValueSync(context.player.taskValues));
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("SetCardCustomUp", { nId: poolId }),
          );
          logger.info("gacha.custom_up.updated", {
            account: context.account,
            poolId,
            itemIds,
          });
          return;
        }
        if (call?.method === "PhoneMsg") {
          const parameters = call.parameters as Record<string, unknown> | undefined;
          const phoneCommand = Number(parameters?.nCmd);
          if (phoneCommand === 8) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("ServerPhoneMsg", {
                nCmd: 8,
                tbList: [],
              }),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "ServerPhoneMsg",
              command: phoneCommand,
              feature: "phone.bbs_publishable_list",
            });
          } else if (phoneCommand === 3) {
            const topicId = Number(parameters?.nMsgId);
            const selectionId = Number(parameters?.nSelectId);
            const definition = getPhoneLetterDefinition(topicId);
            const currentPlayer =
              context.player ?? (await players.getOrCreate(context.account));
            const letter = currentPlayer.phone.letters.find(
              (candidate) => candidate.topicId === topicId,
            );
            const replyId =
              definition && letter
                ? makePhoneReplyId(definition, selectionId, letter.replyIds)
                : null;
            if (replyId !== null) {
              context.player = await players.replyToPhoneLetter(
                context.account,
                topicId,
                replyId,
              );
            }
            if (!definition) {
              logger.warn("phone.letter_definition_missing", {
                account: context.account,
                topicId,
              });
              return;
            }
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("ServerPhoneMsg", {
                nCmd: 3,
                nNpcId: definition.initiator,
                nMsgId: topicId,
                nSelectId: selectionId,
              }),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "ServerPhoneMsg",
              command: phoneCommand,
              feature: "phone.letter_reply",
              topicId,
              selectionId,
              replyId,
            });
          } else if (phoneCommand === 10) {
            const topicId = Number(parameters?.nMsgId);
            const definition = getPhoneLetterDefinition(topicId);
            if (!definition) {
              logger.warn("phone.letter_definition_missing", {
                account: context.account,
                topicId,
              });
              return;
            }
            context.player = await players.removePhoneLetter(context.account, topicId);
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("ServerPhoneMsg", {
                nCmd: 10,
                nNpcId: definition.initiator,
                nMsgId: topicId,
              }),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "ServerPhoneMsg",
              command: phoneCommand,
              feature: "phone.letter_delete",
              topicId,
            });
          } else if (phoneCommand === 11) {
            const topicId = Number(parameters?.nMsgId);
            const definition = getPhoneLetterDefinition(topicId);
            if (!definition) {
              logger.warn("phone.letter_definition_missing", {
                account: context.account,
                topicId,
              });
              return;
            }
            context.player = await players.addPhoneLetter(context.account, {
              topicId,
              initiator: definition.initiator,
            });
            send(
              COMMAND.PHONE_MSG_NTF,
              0,
              makePhoneMessageNotification(context.player),
            );
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("ServerPhoneMsg", {
                nCmd: 11,
                nNpcId: definition.initiator,
                nMsgId: topicId,
              }),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "ServerPhoneMsg",
              command: phoneCommand,
              feature: "phone.letter_add",
              topicId,
            });
          } else {
            logger.warn("phone.unhandled", {
              peer,
              account: context.account,
              command: phoneCommand,
              parameters,
            });
          }
          return;
        }
        if (luaCommand === LUA_COMMAND_WRITE_GUIDE_LOG) {
          const acknowledgement = makeGuideLogAcknowledgement(call?.parameters);
          if (acknowledgement) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_WRITE_GUIDE_LOG,
                tbParam: acknowledgement,
              }),
            );
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "LuaCall",
              command: LUA_COMMAND_WRITE_GUIDE_LOG,
              feature: "guide.log",
              ...acknowledgement,
            });
          }
          return;
        }
        const backgroundResponse = makeBackgroundLuaResponse(
          luaCommand,
          call?.parameters,
        );
        if (backgroundResponse !== undefined) {
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: luaCommand,
              tbParam: backgroundResponse,
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "LuaCall",
            command: luaCommand,
            feature: "background.empty_state",
          });
          return;
        }
        if (luaCommand === LUA_COMMAND_CARD_LEVEL_UP_COMMON) {
          const request = parseCardEnhancementRequest(call?.parameters);
          if (!request) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_CARD_LEVEL_UP_COMMON,
                tbParam: { errorKey: "Error.1" },
              }),
            );
            logger.warn("card.enhance.invalid_request", {
              peer,
              account: context.account,
              parameters: call?.parameters,
            });
            return;
          }
          const currentPlayer =
            context.player ?? (await players.getOrCreate(context.account));
          const currentCard = currentPlayer.inventory.find(
            (entry) => entry.guid === request.guid && isCharacterCard(entry),
          );
          if (currentCard?.enhanceLevel !== request.clientLevel) {
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_CARD_LEVEL_UP_COMMON,
                tbParam: { errorKey: "Error.1" },
              }),
            );
            logger.warn("card.enhance.level_mismatch", {
              peer,
              account: context.account,
              guid: request.guid,
              clientLevel: request.clientLevel,
              serverLevel: currentCard?.enhanceLevel,
            });
            return;
          }
          let result;
          try {
            result = await players.enhanceCard(
              context.account,
              request.guid,
              request.materials,
            );
          } catch (error) {
            if (!(error instanceof InsufficientGoldError)) throw error;
            send(
              COMMAND.NTF_S2C_CALL,
              0,
              makeServerLuaCall("LuaCall", {
                sCmd: LUA_COMMAND_CARD_LEVEL_UP_COMMON,
                tbParam: { errorKey: "Error.1" },
              }),
            );
            logger.warn("card.enhance.insufficient_gold", {
              peer,
              account: context.account,
              guid: request.guid,
              required: error.required,
              available: error.available,
            });
            return;
          }
          context.player = result.player;
          send(
            COMMAND.ITEM_UPDATE_NTF,
            0,
            makeItemUpdateNotification([result.card, ...result.consumedItems]),
          );
          for (const money of result.updatedMoney) {
            send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
          }
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: LUA_COMMAND_CARD_LEVEL_UP_COMMON,
              tbParam: {},
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "LuaCall",
            command: LUA_COMMAND_CARD_LEVEL_UP_COMMON,
            feature: "card.enhance",
            guid: request.guid,
            addedExperience: result.addedExperience,
            coinCost: result.coinCost,
            level: result.card.enhanceLevel,
            experience: result.card.enhanceExp,
          });
          return;
        }
        if (luaCommand === LUA_COMMAND_CAFE_DATA) {
          const player = context.player ?? (await players.getOrCreate(context.account));
          const cafeData = makeInitialCafeData(
            Math.floor(Date.now() / 1000),
            player.cafe.coffees,
          );
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: LUA_COMMAND_CAFE_DATA,
              tbParam: cafeData,
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "LuaCall",
            command: LUA_COMMAND_CAFE_DATA,
            feature: "cafe.data",
          });
          return;
        }
        if (luaCommand === LUA_COMMAND_CAFE_SET_WAITER_LIST) {
          const parameters = call?.parameters as Record<string, unknown> | undefined;
          const waiterList = Array.isArray(parameters?.tbParam)
            ? parameters.tbParam
            : [[], [], []];
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: LUA_COMMAND_CAFE_SET_WAITER_LIST,
              tbParam: waiterList,
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "LuaCall",
            command: LUA_COMMAND_CAFE_SET_WAITER_LIST,
            feature: "cafe.waiter_list",
          });
          return;
        }
        if (luaCommand === LUA_COMMAND_CAFE_GENERATE_CUSTOMER) {
          const customerQueue = makeCafeCustomerQueue(Math.floor(Date.now() / 1000));
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: LUA_COMMAND_CAFE_GENERATE_CUSTOMER,
              tbParam: customerQueue,
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "LuaCall",
            command: LUA_COMMAND_CAFE_GENERATE_CUSTOMER,
            feature: "cafe.customer_queue",
            customerCount: customerQueue.customerqueue.length,
          });
          return;
        }
        if (luaCommand === LUA_COMMAND_CAFE_MAKE_COFFEE) {
          const parameters = call?.parameters as Record<string, unknown> | undefined;
          const coffeeType = Number(parameters?.coffeetype);
          const count = Number(parameters?.count);
          context.player = await players.makeCoffee(context.account, coffeeType, count);
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: LUA_COMMAND_CAFE_MAKE_COFFEE,
              tbParam: makeCoffeeResponse(context.player.cafe.coffees),
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "LuaCall",
            command: LUA_COMMAND_CAFE_MAKE_COFFEE,
            feature: "cafe.make_coffee",
            coffeeType,
            count,
          });
          return;
        }
        if (luaCommand === LUA_COMMAND_CAFE_ADD_GUEST_WEIGHT) {
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: LUA_COMMAND_CAFE_ADD_GUEST_WEIGHT,
              tbParam: [],
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "LuaCall",
            command: LUA_COMMAND_CAFE_ADD_GUEST_WEIGHT,
            feature: "cafe.guest_weight",
          });
          return;
        }
        if (luaCommand === LUA_COMMAND_SHOP_GOODS_LIST) {
          const parameters = call?.parameters as Record<string, unknown> | undefined;
          const shopId = Number(parameters?.shopid);
          const response = makeShopGoodsListResponse(shopId);
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: LUA_COMMAND_SHOP_GOODS_LIST,
              tbParam: response,
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "LuaCall",
            command: LUA_COMMAND_SHOP_GOODS_LIST,
            feature: "shop.goods_list",
            shopId,
            goodsCount: response.goodslist.length,
          });
          return;
        }
        if (luaCommand === LUA_COMMAND_CAFE_FURNITURE_COUNT) {
          send(
            COMMAND.NTF_S2C_CALL,
            0,
            makeServerLuaCall("LuaCall", {
              sCmd: LUA_COMMAND_CAFE_FURNITURE_COUNT,
              tbParam: { nRet: 0, nNum: 0 },
            }),
          );
          logger.info("lua.callback", {
            peer,
            account: context.account,
            method: "LuaCall",
            command: LUA_COMMAND_CAFE_FURNITURE_COUNT,
            feature: "cafe.furniture_count",
          });
          return;
        }
        if (call?.method === "NCafePetLogic") {
          const response = makeCafePetResponse(call.parameters);
          if (response) {
            send(COMMAND.NTF_S2C_CALL, 0, makeServerLuaCall("NCafePetLogic", response));
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "NCafePetLogic",
              command: response.sCmd,
              feature: "cafe.pet",
            });
          }
          return;
        }
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
          send(COMMAND.TASK_VALUE_RSP, 0, makeTaskValueSync(context.player.taskValues));
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
            const chapter = Number(chapterCall.parameters.Chapter);
            const index = Number(chapterCall.parameters.Index);
            const difficulty = Number(chapterCall.parameters.Difficult);
            const level = chapterCatalog.get(chapter, index, difficulty);
            if (!level) {
              logger.warn("chapter.level.missing", {
                account: context.account,
                chapter,
                index,
                difficulty,
              });
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("ChapterMsg", {
                  nError: 1,
                  nState: 0,
                }),
              );
              return;
            }

            const player =
              context.player ?? (await players.getOrCreate(context.account));
            const levelId = makeLevelId(chapter, index, difficulty);
            const previous = player.levels.find(({ id }) => id === levelId);
            const passCount = (previous?.star ?? 0) >>> 3;
            const energyCost = effectiveEnergyCost(level, player.level);
            try {
              context.player = await players.enterLevel(context.account, energyCost);
            } catch (error) {
              if (!(error instanceof InsufficientVigourError)) throw error;
              logger.info("chapter.enter.insufficient_vigour", {
                account: context.account,
                chapter,
                index,
                difficulty,
                required: error.required,
                available: error.available,
              });
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("ChapterMsg", {
                  nError: 20014,
                  nState: 0,
                }),
              );
              return;
            }
            context.activeChapter = {
              level,
              firstClear: passCount === 0,
              passCount,
            };
            context.lastSettlement = null;
            const vigour = context.player.money.find(({ id }) => id === MONEY_VIGOUR);
            if (vigour) {
              send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(vigour));
            }
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
              chapter,
              index,
              difficulty,
              energyCost,
              remainingVigour: vigour?.count ?? 0,
            });
          } else if (chapterCall?.state === 1) {
            const chapter = Number(chapterCall.parameters.Chapter);
            const index = Number(chapterCall.parameters.Index);
            const difficulty = Number(chapterCall.parameters.Difficult);
            const star = Number(chapterCall.parameters.nStar) || 0;
            const settlementKey = `${chapter}:${index}:${difficulty}:${star}`;
            if (context.lastSettlement?.key === settlementKey) {
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("ChapterMsg", context.lastSettlement.response),
              );
              return;
            }

            let completedStar = star;
            let awards: ReturnType<typeof rollChapterAwards> = [];
            let masterExp = 0;
            let cardExp = 0;
            if (star > 0) {
              const level =
                context.activeChapter?.level ??
                chapterCatalog.get(chapter, index, difficulty);
              if (!level) {
                throw new Error(
                  `Missing chapter config ${chapter}:${index}:${difficulty}`,
                );
              }
              const currentPlayer =
                context.player ?? (await players.getOrCreate(context.account));
              const levelId = makeLevelId(chapter, index, difficulty);
              const previous = currentPlayer.levels.find(({ id }) => id === levelId);
              const passCount =
                context.activeChapter?.passCount ?? (previous?.star ?? 0) >>> 3;
              const firstClear = context.activeChapter?.firstClear ?? passCount === 0;
              awards = rollChapterAwards(
                level,
                firstClear,
                `${context.account}:${levelId}:${passCount}`,
              );
              masterExp = level.masterExp;
              cardExp = level.cardExp;
              const settlement = await players.settleLevel(
                context.account,
                chapter,
                index,
                difficulty,
                star,
                awards,
                masterExp,
              );
              context.player = settlement.player;
              completedStar =
                context.player.levels.find(
                  ({ id }) => id === makeLevelId(chapter, index, difficulty),
                )?.star ?? star;
              for (const money of settlement.updatedMoney) {
                send(COMMAND.MONEY_UPDATE_NTF, 0, makeMoneyUpdateNotification(money));
              }
              if (settlement.updatedItems.length > 0) {
                send(
                  COMMAND.ITEM_UPDATE_NTF,
                  0,
                  makeItemUpdateNotification(settlement.updatedItems),
                );
              }
              sendGirlUpdates(settlement.updatedGirls);
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(settlement.player.taskValues),
              );
              if (
                settlement.experienceUpdate.addedExperience > 0 ||
                settlement.experienceUpdate.levelsGained > 0
              ) {
                send(
                  COMMAND.PLAYER_UPDATE_NTF,
                  0,
                  makePlayerUpdateNotification(settlement.player),
                );
              }
            }
            const response = {
              nError: 0,
              nState: 1,
              nStar: completedStar,
              tbAwards: awards,
              tbExp: {
                MasterExp: masterExp,
                CardExp: cardExp,
              },
            };
            context.lastSettlement = { key: settlementKey, response };
            send(COMMAND.NTF_S2C_CALL, 0, makeServerLuaCall("ChapterMsg", response));
            logger.info("lua.callback", {
              peer,
              account: context.account,
              method: "ChapterMsg",
              command: "settlement",
              chapter,
              index,
              difficulty,
              firstClear: context.activeChapter?.firstClear ?? false,
              awards,
              masterExp,
              cardExp,
              playerLevel: context.player?.level,
              playerExp: context.player?.exp,
            });
          } else if (girlTrainingCall) {
            try {
              const result = await players.startGirlTraining(
                context.account,
                girlTrainingCall.girlId,
                girlTrainingCall.position,
              );
              context.player = result.player;
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(result.player.taskValues),
              );
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", {
                  sCmd: "StartTrain",
                  nId: result.girlId,
                  nPos: result.position,
                }),
              );
              logger.info("girl.training.started", {
                peer,
                account: context.account,
                girlId: result.girlId,
                position: result.position,
                endTime: result.endTime,
                outdoorId: result.outdoorId,
              });
            } catch (error) {
              if (!(error instanceof GirlTrainingError)) throw error;
              send(
                COMMAND.NTF_S2C_CALL,
                0,
                makeServerLuaCall("GirlLogic", {
                  sCmd: "StartTrain",
                  nError: error.clientError,
                }),
              );
              logger.warn("girl.training.rejected", {
                peer,
                account: context.account,
                ...girlTrainingCall,
                reason: error.reason,
                clientError: error.clientError,
              });
            }
          } else if (girlAppearanceCall) {
            let callback: Record<string, unknown>;
            if (girlAppearanceCall.command === "SetMainGirl") {
              context.player = await players.setMainGirl(
                context.account,
                girlAppearanceCall.girlId,
              );
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(context.player.taskValues),
              );
              callback = {
                sCmd: girlAppearanceCall.command,
                nId: girlAppearanceCall.girlId,
              };
            } else if (girlAppearanceCall.command === "ChangeCloth") {
              const result = await players.changeGirlClothes(
                context.account,
                girlAppearanceCall.girlId,
                girlAppearanceCall.modelId,
              );
              context.player = result.player;
              send(COMMAND.GIRL_UPDATE_NTF, 0, makeGirlUpdateNotification(result.girl));
              callback = {
                sCmd: girlAppearanceCall.command,
                nId: girlAppearanceCall.girlId,
                nSuit: girlAppearanceCall.modelId,
              };
            } else {
              context.player = await players.setGirlFightModel(
                context.account,
                girlAppearanceCall.girlId,
                girlAppearanceCall.enabled,
              );
              send(
                COMMAND.TASK_VALUE_RSP,
                0,
                makeTaskValueSync(context.player.taskValues),
              );
              callback = {
                sCmd: girlAppearanceCall.command,
                nId: girlAppearanceCall.girlId,
                nUse: girlAppearanceCall.enabled ? 1 : 0,
                bSuccess: true,
              };
            }
            send(COMMAND.NTF_S2C_CALL, 0, makeServerLuaCall("GirlLogic", callback));
            logger.info("girl.appearance.updated", {
              peer,
              account: context.account,
              ...girlAppearanceCall,
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
          } else {
            logger.warn("lua.unhandled", {
              peer,
              account: context.account,
              method: call?.method,
              command: luaCommand,
              parameters: call?.parameters,
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
