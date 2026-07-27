# GCG2 离线研究服务器

这是原版客户端的本地最小服务端。目前包含：

- HTTP 渠道列表与健康检查；
- TCP 游戏网关、登录、玩家快照、任务同步和心跳；
- 玩家及任务值的 JSON 持久化；
- 同时写入终端和文件的结构化日志。

## 启动

```sh
cd /Users/yricky/Downloads/Android/fangame-mvp/offline-server
pnpm install
pnpm dev
```

`pnpm dev` 使用 `tsx watch` 运行 TypeScript。修改 `src/` 后会自动热重载；
旧进程先处理 `SIGTERM` 并关闭监听，新进程随后读取原有持久化状态重新启动。

生产构建和启动：

```sh
pnpm build
pnpm start
```

默认监听：

- HTTP：`0.0.0.0:18080`
- TCP 游戏网关：`0.0.0.0:30400`
- 渠道列表向客户端公布：`192.168.101.4:30400`

HTTP 接口：

- `GET /health`
- `GET /serverlist?...`
- `GET /serverstate/<id>`

## 持久化和日志

- 玩家状态：[data/state.json](data/state.json)
- 运行日志：`logs/server.log`
- 默认配置：[config/default.json](config/default.json)

状态写入采用同目录临时文件加原子重命名。任务变更请求 `1027` 会更新玩家的
`taskValues`，后续登录再通过 `1026` 同步给客户端。

日志会追加写入，不会在重启时截断。追踪最新日志：

```sh
tail -f logs/server.log
```

默认单个日志文件上限为 20MiB，并保留 5 个历史文件；单个协议包最多记录
4096 字节的十六进制预览。这些值可以在 `config/default.json` 中调整。

## 环境变量

- `GCG_HTTP_HOST`
- `GCG_HTTP_PORT`（兼容旧名 `GCG_PORT`）
- `GCG_GATEWAY_HOST`
- `GCG_GATEWAY_PORT`（兼容旧名 `GCG_GAME_PORT`）
- `GCG_GAME_HOST`：渠道列表中公布给设备的电脑 IP
- `GCG_LOG_LEVEL`：`debug`、`info`、`warn` 或 `error`

## 检查

```sh
pnpm check
```

完整检查依次执行 Prettier、ESLint、TypeScript 严格类型检查、Vitest 和生产
构建。单独运行：

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm test:watch
```
