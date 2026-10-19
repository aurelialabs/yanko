import "server-only";

const IMMEDIATE_RISK_PATTERNS = [
  /(?:不想活|不想再活|想死|去死|结束(?:自己|我的)?生命|自杀|轻生)/u,
  /(?:伤害|割伤|杀死|杀了)(?:我自己|自己|他人|别人|某人)/u,
  /(?:跳楼|割腕|吞药|服毒|上吊)/u,
  /\b(?:suicide|kill myself|end my life|hurt myself|harm someone)\b/iu,
] as const;

export const DETERMINISTIC_HIGH_RISK_RESPONSE =
  "我很在意你刚才说的情况，这可能关系到你现在的安全。请立即联系一位现实中可信任的人，请对方来陪你；如果你可能马上伤害自己或他人，请联系当地紧急服务（如在中国大陆可拨打 120 或 110），或前往最近的急诊。现在先去有人的安全地点，把可能造成伤害的物品、药物或工具移开，或交给别人保管。你现在能马上联系到谁，并告诉我你是否已经到了有人陪伴的地方吗？";

/**
 * This intentionally favors recall for explicit, immediate harm language. It
 * is a deterministic boundary, not an emotion diagnosis or a replacement for
 * the later dedicated safety classifier.
 */
export function hasExplicitImmediateSafetyRisk(content: string): boolean {
  const normalized = content.normalize("NFKC").trim();
  return IMMEDIATE_RISK_PATTERNS.some((pattern) => pattern.test(normalized));
}
