export interface PhoneLetterDefinition {
  topicId: number;
  initiator: number;
  replyPositions: readonly number[];
}

const PHONE_LETTERS = new Map<number, PhoneLetterDefinition>([
  [
    10_001,
    {
      topicId: 10_001,
      initiator: 7,
      replyPositions: [2],
    },
  ],
  [
    1,
    {
      topicId: 1,
      initiator: 111,
      replyPositions: [],
    },
  ],
]);

export function getPhoneLetterDefinition(
  topicId: number,
): PhoneLetterDefinition | null {
  return PHONE_LETTERS.get(topicId) ?? null;
}

export function makePhoneReplyId(
  definition: PhoneLetterDefinition,
  selectionId: number,
  completedReplyIds: readonly number[],
): number | null {
  if (!Number.isSafeInteger(selectionId) || selectionId <= 0 || selectionId > 9) {
    return null;
  }
  const position = definition.replyPositions.find(
    (candidate) =>
      !completedReplyIds.some((replyId) => Math.floor(replyId / 10) === candidate),
  );
  return position === undefined ? null : position * 10 + selectionId;
}
