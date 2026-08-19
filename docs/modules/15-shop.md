# 商店

## 当前完成度

**部分实现。** 普通商店仍只是让客户端接受的空商品列表；IB 礼包商店实现了一
个免费礼包（Id 12）的领取闭环。

## 已实现

### 普通商店（`LuaCall sCmd=11`）

读取 `shopid`，返回：

```text
shopid
isopen = 1
refreshcount = 0
goodslist = []
```

这些字段是客户端 `GoodsLogicC` 接受响应所需的最小结构。当前主要用于避免咖啡馆
流程请求商店时卡住。

### IB 礼包商店免费礼包（`LuaCall sCmd=10000`，`LuaCall.DoRecharge`）

客户端在 IB 商店点击礼包时发送 `{Type=1, Id}`（`IBLogic:DoBuyBox`）。当前只支
持 `Purchase/PurchaseIBShop.txt` 的 Id 12「每日少女暖心礼包」（`Currency=-2`
钻石、`Cost=0`、日限购 1 次，奖励 `[14,3,5,1,1]` 礼包箱）：

- 购买计数存任务组 42、taskId `10000+Id`（客户端 `IBLogic:GetIBTask` 读取限购
  进度），按运营日（UTC+8，凌晨 4 点切日）重置，重置日期存
  `player.ibShop.operationalDate`；
- 成功时按 `ITEM_UPDATE_NTF → TASK_VALUE_RSP → NTF_S2C_CALL` 顺序回包，
  回调体 `{sCmd=10000, tbParam={Type=1, Id=12, Error=0, tbItem=[[14,3,5,1,1]]}}`，
  客户端 `IBLogic:ResponseTradeNo` 收到后打开 `UI_RewardNormal`；
- 当日已达限购回 `Error=20075`，其它 Type/Id 一律回 `Error=20074`（客户端弹
  `ui.Error.<code>`）。

实现位置：`src/game-data/ib-shop-data.ts`（常量与任务 ID）、
`player-repository.ts` 的 `claimIBShopFreePack` / `claimIBItemFree` /
`IBShopError`、`gateway-server.ts` 的 `parseDoRechargeCall` 与分发分支。

### IB 充值商店月卡（`Type=2`，Id 1）

客户端在充值商店点击商品时发送 `{Type=2, Id}`（`IBLogic:DoRecharge`）。当前只
支持 `Purchase/PurchaseIB.txt` 的 Id 1「月卡」（Type=1 月卡、Cost=30 CNY、
安卓 ServerItem1=`[14,1,2,1,300]`、First/NormalCharge=`[14,2,1,1,1]`），离线服
直接免费发放：

- genre 14 是 `Auto` 类道具，服务端按 ItemList 语义直接折算，不入库：
  `IBAndroidDiamondAuto`（ExtParam1=1）每件 1 钻石 → +300 钻石（money id 3）；
  `IBMonthCardAuto`（ExtParam1=30）→ 月卡到期时间（任务组 1 task 36，unix 秒）
  从 `max(现在, 原到期)` 顺延 30 天，上限 330 天（`IBLogic.MONTH_LIMIT`）；
- 购买计数存任务组 42、taskId = 商品 Id（`GetIBTask` 的 TYPE_IBITEM 分支），
  累计不重置（Id 1 无 MaxBuy 限购）；
- 消息序：`MONEY_UPDATE_NTF → TASK_VALUE_RSP → DoRecharge 回调（伪造
TradeNo=`offline-<毫秒>`，客户端随后调用 XGCharge，离线包中静默失败无副作用）
→ NTF_S2C_CALL `BuyMonth {nType=2, bMonth=1, nId=1}`（客户端弹"充值成功"并
刷新 UI_Charge/UI_ShopNew）→ LuaCall 450 `Pay_Result_Success
  {nAllTimes, nDailyTimes}`（客户端仅埋点）；
- 其它 Type=2 商品一律回 `Error=20074`。

月卡每日 50 钻石 / 30 体力通过每日签到发放（见
[每日签到](11-sign-in-activities.md) 的"月卡每日签到"）；月卡补偿与月卡签到
的补偿分支（`TID_MONTHSIGN_Energy_Got`=11006）未实现。

## 验证

`test/shop-data.test.ts` 验证空商品列表的字段和值；
`test/ib-shop-persistence.test.ts` 覆盖免费礼包（发货+计数、当日限购拒绝、跨运
营日重置、未知账号）与月卡（钻石+顺延+计数、活跃期顺延、330 天上限、未知商品
拒绝）。没有设备购买流程或网关集成测试。

## 已知缺口

- 普通商店没有商品配置、库存、价格、限购和开放期；没有购买、刷新、货币扣除和
  奖励发放；商店状态不持久化；`shopid` 不校验，任意 ID 都返回开放的空商店；
  不应把当前实现视为任何一个真实商店已经可用。
- IB 商店只支持 Id 12：没有从 `PurchaseIBShop.txt` 加载完整商品表，不支持付费
  商品（`Currency=-1` 的 TradeNo/XGSDK 流程）、钻石/金币扣费、周/月/总计限购
  （LimitType 2/3/4）、折扣窗口（OffFlag/OffCost）、等级与时间窗校验；
- 发放的 genre 14 礼包箱只做入库，背包开箱（`UI_ItemBox` /
  `Item/ItemBoxInfo.txt` 掉落）未实现；
- IBItem（Type=2）只支持 Id 1 月卡：没有从 `PurchaseIB.txt` 加载完整商品表，
  普通钻石档位、首充双倍（FirstCharge/NormalCharge 当前恒等同）、订阅月卡
  （Type=3）等未实现。
