import { createServer, type Server, type Socket } from "node:net";

import type { AppConfig } from "../config.js";
import {
  LUA_COMMAND_CARD_LEVEL_UP_COMMON,
  parseCardEnhancementRequest,
} from "../game-data/card-enhancement-data.js";
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
import {
  LUA_COMMAND_SHOP_GOODS_LIST,
  makeShopGoodsListResponse,
} from "../game-data/shop-data.js";
import type { Logger } from "../logger.js";
import {
  InsufficientVigourError,
  makeLevelId,
  MONEY_VIGOUR,
  type FormationState,
  type Player,
  type PlayerRepository,
} from "../persistence/player-repository.js";
import { COMMAND, commandName } from "../protocol/commands.js";
import {
  makePlayerNotification,
  makeItemNotification,
  makeItemUpdateNotification,
  makeFormationUpdateNotification,
  makeHouseInfoResponse,
  makeMoneyUpdateNotification,
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
  logger.info("game_data.chapter.loaded", { levels: chapterCatalog.size });
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
        logger.info("lua.call", {
          peer,
          account: context.account,
          ...(call ? { method: call.method, json: call.json } : {}),
        });
        send(COMMAND.C2S_CALL_RSP, packet.serial);
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
          const currentCard = currentPlayer.cards.find(
            ({ guid }) => guid === request.guid,
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
          const result = await players.enhanceCard(
            context.account,
            request.guid,
            request.materials,
          );
          context.player = result.player;
          send(
            COMMAND.ITEM_UPDATE_NTF,
            0,
            makeItemUpdateNotification([result.card, ...result.consumedItems]),
          );
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
