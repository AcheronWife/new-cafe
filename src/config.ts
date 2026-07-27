import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const configSchema = z.object({
  http: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65_535),
  }),
  gateway: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65_535),
    advertisedHost: z.string().min(1),
    maxPacketBytes: z.number().int().positive(),
  }),
  serverList: z.object({
    id: z.number().int().positive(),
    aid: z.number().int().positive(),
    sid: z.number().int().positive(),
    name: z.string().min(1),
    state: z.number().int(),
    level: z.number().int(),
  }),
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]),
    file: z.string().min(1),
    maxBytes: z.number().int().positive(),
    maxFiles: z.number().int().positive(),
    maxPayloadHexBytes: z.number().int().positive(),
  }),
  persistence: z.object({
    file: z.string().min(1),
  }),
  playerDefaults: z.object({
    name: z.string().min(1),
    level: z.number().int().positive(),
    exp: z.number().int().nonnegative(),
    fightPower: z.number().int().nonnegative(),
    serverZone: z.number().int(),
    firstLevelComplete: z.boolean(),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;

function envInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer, received ${raw}`);
  }
  return value;
}

export async function loadConfig(projectRoot: string): Promise<AppConfig> {
  const configPath = path.join(projectRoot, "config", "default.json");
  const rawConfig: unknown = JSON.parse(await readFile(configPath, "utf8"));
  const config = configSchema.parse(rawConfig);

  config.http.host = process.env.GCG_HTTP_HOST ?? config.http.host;
  config.http.port = envInteger(
    "GCG_HTTP_PORT",
    envInteger("GCG_PORT", config.http.port),
  );
  config.gateway.host = process.env.GCG_GATEWAY_HOST ?? config.gateway.host;
  config.gateway.port = envInteger(
    "GCG_GATEWAY_PORT",
    envInteger("GCG_GAME_PORT", config.gateway.port),
  );
  config.gateway.advertisedHost =
    process.env.GCG_GAME_HOST ?? config.gateway.advertisedHost;
  if (process.env.GCG_LOG_LEVEL !== undefined) {
    config.logging.level = configSchema.shape.logging.shape.level.parse(
      process.env.GCG_LOG_LEVEL,
    );
  }

  config.logging.file = path.resolve(projectRoot, config.logging.file);
  config.persistence.file = path.resolve(projectRoot, config.persistence.file);
  return config;
}
