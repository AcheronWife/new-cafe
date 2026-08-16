import type { BaseAward } from "./chapter-config.js";

// 出处：客户端 LuaCall.lua LuaCall.DoRecharge = 10000；
// IBLogic.lua GROUP=42 / IBSHOP_TASKID=10000 / TYPE_IBSHOP=1。
export const LUA_COMMAND_DO_RECHARGE = 10000;
export const IB_SHOP_TASK_GROUP = 42;
export const IB_SHOP_TASKID_BASE = 10000;

// Purchase/PurchaseIBShop.txt Id=12「每日少女暖心礼包」：
// tbGDPL=[14,3,5,1,1]，Currency=-2（钻石），Cost=0，LimitType=1（日限购），
// LimitTimes=1。当前仅支持这一个免费礼包。
export const FREE_GIFT_PACK_ID = 12;
export const FREE_GIFT_PACK_AWARD: BaseAward = [14, 3, 5, 1, 1];
export const FREE_GIFT_PACK_DAILY_LIMIT = 1;

// 客户端 IBLogic:ResponseTradeNo 读取的错误码（ui.Error.<code>）。
export const IB_SHOP_ERROR_UNKNOWN_ITEM = 20074;
export const IB_SHOP_ERROR_LIMIT_REACHED = 20075;

export function makeIBShopTaskId(shopId: number): number {
  return (IB_SHOP_TASK_GROUP << 16) | (IB_SHOP_TASKID_BASE + shopId);
}
