export const COMMAND = Object.freeze({
  LOGIN_REQ: 1001,
  LOGIN_RSP: 1002,
  PLAYER_NTF: 1005,
  KEEP_ALIVE_REQ: 1008,
  KEEP_ALIVE_RSP: 1009,
  C2S_CALL_REQ: 1022,
  C2S_CALL_RSP: 1023,
  TASK_VALUE_REQ: 1025,
  TASK_VALUE_RSP: 1026,
  TASK_CHANGE_REQ: 1027,
  TASK_CHANGE_RSP: 1028,
  GET_HOUSEINFO_REQ: 1048,
  GET_HOUSEINFO_RSP: 1049,
  HOUSE_RANDOM_REQ: 1109,
  HOUSE_RANDOM_RSP: 1110,
  VERIFY_REQ: 1102,
  VERIFY_RSP: 1103,
});

const NAMES: ReadonlyMap<number, string> = new Map<number, string>(
  Object.entries(COMMAND).map(([name, value]) => [value, name]),
);

export function commandName(command: number): string {
  return NAMES.get(command) ?? `UNKNOWN_${command}`;
}
