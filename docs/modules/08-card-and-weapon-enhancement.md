# 角色卡与武器强化、锁定和分解

## 当前完成度

**核心可用。** 强化、锁定以及角色卡/武器分解的协议、奖励和存档闭环已实现；
突破、技能等后续养成缺失。

## 实例锁定

支持通用 `LockItem`：

- 接收 `nGuid` 和 `nLockOn=0/1`，可用于角色卡、武器等实例物品；
- 锁状态写入统一背包存档；
- `ItemInfo` 的 Protobuf field 13 同步 `lockon`；
- 修改成功后发送 `ITEM_UPDATE_NTF`。

旧存档没有 `lockOn` 时会在加载时补为 0。

## 角色卡强化

支持 `LuaCall sCmd=5 / Card_LevelUpCommon`：

- 解析客户端材料索引与数量；
- 校验客户端等级和服务端等级一致；
- 使用客户端 `ItemList` 的经验与金币值；
- 同属性/通用经验材料应用客户端 1.5 倍经验规则；
- 原子扣除材料和金币，跨多级结算剩余经验；
- 同步目标卡、消耗材料和金币。

客户端提交的技能等级只用于请求结构校验，目前不进行技能升级。

## 角色卡分解

支持 `LuaCall sCmd=1 / Card_Decompose`：

- 单次接收 1～40 个不重复角色卡 GUID；
- 禁止分解锁定卡、任意已保存编队中的主卡/副卡/使用卡以及 `P=17` 的誓约卡；
- 先完整校验全部卡牌，再在同一事务内删除实例并发放奖励；
- 返回 `itemlist` 和 `goldnum`，同时发送删除物品与货币增量通知；
- 角色卡分解代币 `[15,11,1,1]` 记入 `Money ID 10`。

## 武器强化

支持 `WeaponLogicMsg nCmd=1`：

- 识别经验材料或作为素材的其他武器；
- 使用客户端材料经验、金币和献祭武器公式；
- 已装备武器不能作为素材；
- 根据稀有度和突破等级计算 40～80 级上限；
- 在突破上限保留受限溢出经验；
- 原子扣除素材和金币并同步更新；
- 发布 `weapon.enhanced`，推进指引日程的 10 级任务。

## 武器分解

支持 `WeaponLogicMsg nCmd=2`：

- 单次接收 1～40 个不重复武器 GUID；
- 禁止分解锁定武器和任意已保存编队中装备的武器；
- 先完整校验全部武器，再原子删除实例并发放奖励；
- 成功回调为 `tbParam=[金币, 道具列表]`，并同步物品删除和货币变化；
- 武器分解代币 `[15,20,1,1]` 记入 `Money ID 16`。

## 分解奖励

金币公式与客户端 `CardCommon:GetCardPrice` /
`WeaponCommon:GetWeaponSellGold` 一致：

```text
floor(达到当前等级所消耗的累计经验 * 0.3 + 稀有度 * 对应基础金币)
```

未结算的当前等级 `enhanceExp` 不参与返还。等级 1 的奖励如下：

| 稀有度 |  金币 | 角色卡代币 | 武器代币 |
| ------ | ----: | ---------: | -------: |
| 1      |   500 |          0 |        0 |
| 2      |  2000 |         10 |        5 |
| 3      |  6000 |         40 |       25 |
| 4      | 40000 |        200 |      250 |
| 5      |   500 |          0 |        0 |

代币数量来自客户端 `ItemRarityItem` 的 `DisItem1/DisItem2`；当前配置的有效产出
概率均为 10000，因此结果是确定的。

## 验证

- `test/card-enhancement-data.test.ts`：请求、材料顺序、经验跨级；
- `test/weapon-enhancement-data.test.ts`：请求、材料、献祭公式、等级上限；
- `test/weapon-enhancement-persistence.test.ts`：武器、材料和金币原子落盘；
- `test/card-decomposition-data.test.ts`：角色卡请求、金币和代币规则；
- `test/card-decomposition-persistence.test.ts`：角色卡锁定、编队限制和原子奖励；
- `test/weapon-decomposition-data.test.ts`：武器请求、金币和代币规则；
- `test/weapon-decomposition-persistence.test.ts`：武器锁定、装备限制和原子奖励；
- `test/protocol.test.ts`：`ItemInfo.lockon` 编码；
- `test/persistence.test.ts` 间接覆盖角色卡强化。

## 已知缺口

- 角色卡没有按稀有度、突破或玩家等级限制最大等级；
- 角色卡技能升级、觉醒、突破和副卡强化未实现；
- 武器突破、技能和重置未实现；
- 普通物品、物资、符文、武器模块和武器零件的出售/分解仍未实现；
- 武器强化失败统一返回通用错误，客户端错误码没有细分；
- 角色卡强化尚未发布活动领域事件。
- 角色卡/武器强化后会重新计算已保存编队的历史最大练度，并立即同步相关指引任务；
