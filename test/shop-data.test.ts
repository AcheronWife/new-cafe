import { expect, it } from "vitest";

import { makeShopGoodsListResponse } from "../src/game-data/shop-data.js";

it("returns the fields required by GoodsLogicC for an empty shop", () => {
  expect(makeShopGoodsListResponse(40_001)).toEqual({
    shopid: 40_001,
    isopen: 1,
    refreshcount: 0,
    goodslist: [],
  });
});
