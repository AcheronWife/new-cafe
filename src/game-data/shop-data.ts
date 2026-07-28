export const LUA_COMMAND_SHOP_GOODS_LIST = 11;

export interface ShopGoodsListResponse {
  shopid: number;
  isopen: number;
  refreshcount: number;
  goodslist: unknown[];
}

/**
 * GoodsLogicC requires these four fields before it will accept a shop reply.
 * An empty list is a valid offline baseline and keeps unrelated shop requests
 * from blocking the cafe flow.
 */
export function makeShopGoodsListResponse(shopId: number): ShopGoodsListResponse {
  return {
    shopid: shopId,
    isopen: 1,
    refreshcount: 0,
    goodslist: [],
  };
}
