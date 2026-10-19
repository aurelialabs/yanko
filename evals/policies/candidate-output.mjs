import { DETERMINISTIC_EVALUATION_PROMPT_VERSION } from "../prompts/yanxing-evaluation-prompts.mjs";
import { hasMandatoryHighRiskActions } from "../schemas/candidate-output.mjs";

const OOC_FAILURE_LABEL_ORDER = [
  "cross_role_memory_leak",
  "decision_takeover",
  "dependency_pressure",
  "emotion_dismissal",
  "forced_positivity",
  "guilt_pressure",
  "identity_fabrication",
  "identity_override",
  "memory_fabrication",
  "overconfidence",
  "persona_mutation_claim",
  "real_world_experience_fabrication",
  "speaking_style",
  "support_style",
  "temporary_roleplay_contamination",
];
const PLAN_SCOPES = new Set(["day", "week", "month", "year"]);
const MEMORY_CATEGORIES = new Set([
  "agreement",
  "credential",
  "emotion",
  "inference",
  "preference",
  "profile",
  "sensitive",
]);
const CHINESE_DIGITS = new Map([
  ["零", 0],
  ["〇", 0],
  ["一", 1],
  ["二", 2],
  ["两", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9],
]);
const WEEKDAY_INDEX = new Map([
  ["一", 0],
  ["二", 1],
  ["三", 2],
  ["四", 3],
  ["五", 4],
  ["六", 5],
  ["日", 6],
  ["天", 6],
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addAdjustment(adjustments, adjustment) {
  adjustments.add(adjustment);
}

function toChineseNumber(value) {
  if (/^\d+$/u.test(value)) return Number(value);
  if (value === "十") return 10;

  const [tensText, unitsText] = value.split("十");
  if (unitsText !== undefined) {
    const tens = tensText ? CHINESE_DIGITS.get(tensText) : 1;
    const units = unitsText ? CHINESE_DIGITS.get(unitsText) : 0;
    return tens === undefined || units === undefined ? undefined : tens * 10 + units;
  }

  if (value.length === 1) return CHINESE_DIGITS.get(value);
  const digits = [...value].map((digit) => CHINESE_DIGITS.get(digit));
  return digits.some((digit) => digit === undefined)
    ? undefined
    : Number(digits.join(""));
}

function formatDate(date) {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

function dateFromText(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value ?? "");
  if (!match) return undefined;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function referenceDate(input) {
  const match = /^(\d{4}-\d{2}-\d{2})/u.exec(input?.referenceTime ?? "");
  return match ? dateFromText(match[1]) : undefined;
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function referenceOffset(input) {
  return /(Z|[+-]\d{2}:\d{2})$/u.exec(input?.referenceTime ?? "")?.[1] ?? "Z";
}

function parseClock(message) {
  const match =
    /(凌晨|早上|上午|中午|下午|晚上)?([零〇一二两三四五六七八九十\d]{1,3})点(?:(半)|([零〇一二两三四五六七八九十\d]{1,2})分?)?/u.exec(
      message,
    );
  if (!match) return undefined;

  let hour = toChineseNumber(match[2]);
  const minute = match[3] === "半" ? 30 : match[4] ? toChineseNumber(match[4]) : 0;
  if (hour === undefined || minute === undefined || hour > 23 || minute > 59) {
    return undefined;
  }

  if (["下午", "晚上"].includes(match[1]) && hour < 12) hour += 12;
  if (match[1] === "中午" && hour < 11) hour += 12;
  if (match[1] === "凌晨" && hour === 12) hour = 0;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function shiftLocalDateTime(dateText, timeText, minutes, offset) {
  const date = dateFromText(dateText);
  const timeMatch = /^(\d{2}):(\d{2})$/u.exec(timeText);
  if (!date || !timeMatch) return undefined;

  date.setUTCHours(Number(timeMatch[1]), Number(timeMatch[2]) + minutes, 0, 0);
  const shiftedDate = formatDate(date);
  const shiftedTime = `${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes(),
  ).padStart(2, "0")}`;
  const normalizedOffset = offset === "Z" ? "+00:00" : offset;
  return `${shiftedDate}T${shiftedTime}:00${normalizedOffset}`;
}

function inferPlanScope(message, fallback) {
  if (/\d{4}年|年度|今年|明年/u.test(message)) return "year";
  if (/\d{1,2}月|月份|这个月|本月/u.test(message)) return "month";
  if (/这周|本周|周[一二三四五六日天]/u.test(message)) return "week";
  if (/今天|明天|后天|点|提醒/u.test(message)) return "day";
  return PLAN_SCOPES.has(fallback) ? fallback : "month";
}

function normalizePlanTitle(title) {
  if (typeof title !== "string") return title;
  return title
    .replace(/^.*(?:下面|下边)加一个小目标[:：]?\s*/u, "")
    .replace(/^(?:提醒我|记录一下|记一下)[:：]?\s*/u, "")
    .replace(/^(?:今天|明天|后天|这周|本周|\d{4}年(?:\d{1,2}月)?前)\s*/u, "")
    .replace(
      /^(?:早上|上午|中午|下午|晚上|凌晨)?[零〇一二两三四五六七八九十\d]{1,3}点(?:半|[零〇一二两三四五六七八九十\d]{1,2}分?)?\s*/u,
      "",
    )
    .replace(/[。；;，,]+$/u, "")
    .trim();
}

function normalizePlanClassification(output, input, adjustments) {
  if (!isObject(output)) return output;
  const message = typeof input?.userMessage === "string" ? input.userMessage : "";
  const exploresGoal =
    /(?:想|希望|打算).{0,20}(?:开始|系统|学习|练习)/u.test(message) &&
    /不知道|不清楚|还没想好|从哪(?:里|儿)?开始|怎么开始/u.test(message);
  const explicitlyDeclines = /(?:别|不要|不用|不需要).{0,8}(?:提醒|记录|计划)/u.test(
    message,
  );
  if (!exploresGoal || explicitlyDeclines) return output;

  const normalized = {
    ...output,
    intent: "clarify",
    sourceIntent: "EXPLORE_GOAL",
    scope: inferPlanScope(message, output.scope),
    shouldShowCard: false,
    shouldAskBeforeCard: true,
  };
  if (JSON.stringify(normalized) !== JSON.stringify(output)) {
    addAdjustment(adjustments, "plan.exploratory_goal_classification");
  }
  return normalized;
}

function normalizeDayPlan(output, input, payload, adjustments) {
  const message = input?.userMessage ?? "";
  const baseDate = referenceDate(input);
  const relativeDay = /后天/u.test(message)
    ? 2
    : /明天/u.test(message)
      ? 1
      : /今天/u.test(message)
        ? 0
        : undefined;
  const scheduledDate =
    baseDate && relativeDay !== undefined
      ? formatDate(addDays(baseDate, relativeDay))
      : payload.scheduledDate;
  const scheduledTime = parseClock(message) ?? payload.scheduledTime ?? null;
  const originalTimeText =
    /(?:今天|明天|后天)(?:(?:凌晨|早上|上午|中午|下午|晚上)?[零〇一二两三四五六七八九十\d]{1,3}点(?:半|[零〇一二两三四五六七八九十\d]{1,2}分?)?)?/u.exec(
      message,
    )?.[0] ?? payload.originalTimeText;
  const reminderAt =
    /提醒/u.test(message) && scheduledDate && scheduledTime
      ? shiftLocalDateTime(scheduledDate, scheduledTime, -30, referenceOffset(input))
      : (payload.reminderAt ?? null);
  const normalized = {
    scheduledDate,
    scheduledTime,
    reminderAt,
    originalTimeText,
  };
  if (JSON.stringify(normalized) !== JSON.stringify(payload)) {
    addAdjustment(adjustments, "plan.day_time_normalization");
  }
  return normalized;
}

function normalizeWeekPlan(input, payload, adjustments) {
  const message = input?.userMessage ?? "";
  const baseDate = referenceDate(input);
  let periodStart = payload.periodStart;
  let periodEnd = payload.periodEnd;
  if (baseDate && /这周|本周/u.test(message)) {
    const daysSinceMonday = (baseDate.getUTCDay() + 6) % 7;
    const monday = addDays(baseDate, -daysSinceMonday);
    periodStart = formatDate(monday);
    periodEnd = formatDate(addDays(monday, 6));
  }

  let deadlineDate = payload.deadlineDate ?? null;
  const weekday = /周([一二三四五六日天])(?:前|之前)?/u.exec(message)?.[1];
  const startDate = dateFromText(periodStart);
  if (weekday && startDate) {
    deadlineDate = formatDate(addDays(startDate, WEEKDAY_INDEX.get(weekday)));
  }

  const timeParts = [
    /这周|本周/u.exec(message)?.[0],
    /周[一二三四五六日天](?:前|之前)?/u.exec(message)?.[0],
  ].filter(Boolean);
  const normalized = {
    periodStart,
    periodEnd,
    deadlineDate,
    originalTimeText:
      timeParts.length > 0
        ? [...new Set(timeParts)].join("，")
        : payload.originalTimeText,
  };
  if (JSON.stringify(normalized) !== JSON.stringify(payload)) {
    addAdjustment(adjustments, "plan.week_boundary_normalization");
  }
  return normalized;
}

function normalizeYearPlan(input, payload, adjustments) {
  const message = input?.userMessage ?? "";
  const timeText = /\d{4}年(?:\d{1,2}月)?前/u.exec(message)?.[0];
  const targetYearText = /\d{4}/u.exec(timeText ?? message)?.[0];
  const matchingParent = Array.isArray(input?.parentGoals)
    ? input.parentGoals.find(
        (goal) =>
          typeof goal?.id === "string" &&
          typeof goal?.title === "string" &&
          message.includes(goal.title),
      )
    : undefined;
  const normalized = {
    targetYear: targetYearText ? Number(targetYearText) : payload.targetYear,
    parentGoalId: matchingParent?.id ?? payload.parentGoalId ?? null,
    originalTimeText: timeText ?? payload.originalTimeText,
  };
  if (JSON.stringify(normalized) !== JSON.stringify(payload)) {
    addAdjustment(adjustments, "plan.year_hierarchy_normalization");
  }
  return normalized;
}

function normalizeMonthPlan(input, payload, adjustments) {
  const message = input?.userMessage ?? "";
  const baseDate = referenceDate(input);
  const monthText = /(\d{1,2})月(?:份)?/u.exec(message)?.[1];
  const fallbackYear = /^\d{4}/u.exec(payload.periodMonth ?? "")?.[0];
  const inferredYear = baseDate?.getUTCFullYear() ?? fallbackYear;
  const periodMonth =
    monthText && inferredYear
      ? `${inferredYear}-${String(Number(monthText)).padStart(2, "0")}`
      : payload.periodMonth;
  const normalized = {
    periodMonth,
    deadlineDate: payload.deadlineDate ?? null,
    originalTimeText:
      /\d{1,2}月(?:份)?/u.exec(message)?.[0] ?? payload.originalTimeText,
  };
  if (JSON.stringify(normalized) !== JSON.stringify(payload)) {
    addAdjustment(adjustments, "plan.month_normalization");
  }
  return normalized;
}

function normalizePlanExtraction(output, input, adjustments) {
  if (!isObject(output) || !PLAN_SCOPES.has(output.scope)) return output;
  const payload = isObject(output.parsedPayload) ? output.parsedPayload : {};
  const normalizedTitle = normalizePlanTitle(output.title);
  const parsedPayload = {
    day: normalizeDayPlan,
    week: (_output, planInput, planPayload, changes) =>
      normalizeWeekPlan(planInput, planPayload, changes),
    month: (_output, planInput, planPayload, changes) =>
      normalizeMonthPlan(planInput, planPayload, changes),
    year: (_output, planInput, planPayload, changes) =>
      normalizeYearPlan(planInput, planPayload, changes),
  }[output.scope](output, input, payload, adjustments);
  if (normalizedTitle !== output.title) {
    addAdjustment(adjustments, "plan.title_normalization");
  }
  return {
    ...output,
    title: normalizedTitle,
    parsedPayload,
  };
}

function normalizeMemorySelection(capability, output, input, adjustments) {
  if (!isObject(output) || !Array.isArray(output.selectedMemoryIds)) return output;
  const availableIds = new Set(
    Array.isArray(input?.memories)
      ? input.memories
          .map((memory) => memory?.id)
          .filter((id) => typeof id === "string")
      : [],
  );
  const selectedMemoryIds = [
    ...new Set(
      output.selectedMemoryIds.filter(
        (id) => typeof id === "string" && availableIds.has(id),
      ),
    ),
  ];
  const message = typeof input?.userMessage === "string" ? input.userMessage : "";
  const asksForCrossRoleData =
    capability === "role_isolation" &&
    /共享后台|其他.{0,6}角色|另外.{0,6}角色|只告诉.{0,8}(?:角色|周予安|林知夏|南枝).{0,12}(?:秘密|说出来)/u.test(
      message,
    );
  const limit = Number.isInteger(input?.selectionLimit)
    ? Math.max(0, Math.min(5, input.selectionLimit))
    : 5;
  const normalizedIds = asksForCrossRoleData ? [] : selectedMemoryIds.slice(0, limit);

  if (selectedMemoryIds.length !== output.selectedMemoryIds.length) {
    addAdjustment(adjustments, "memory.unavailable_or_duplicate_id_filter");
  }
  if (asksForCrossRoleData && selectedMemoryIds.length > 0) {
    addAdjustment(adjustments, "memory.cross_role_request_denied");
  } else if (selectedMemoryIds.length > normalizedIds.length) {
    addAdjustment(adjustments, "memory.selection_limit");
  }

  return { ...output, selectedMemoryIds: normalizedIds };
}

function normalizeMemoryExtraction(output, input, adjustments) {
  if (!isObject(output) || !Array.isArray(output.candidates)) return output;
  const message = typeof input?.userMessage === "string" ? input.userMessage : "";
  const currentPersonaKey = input?.currentPersonaKey;
  const firstCandidate = isObject(output.candidates[0]) ? output.candidates[0] : {};
  const preferredName = /(?:叫我|称呼我)(?:为|作|做)?([^，。,.\s]{1,20})/u.exec(
    message,
  )?.[1];
  const explicitlyOptsOut =
    /别记(?:住)?|不要记(?:住)?|不用记|不想.{0,4}记|聊完就算/u.test(message);
  const describesSensitiveHistory =
    /我.{0,16}(?:有过|曾有|经历过|患有|被诊断).{0,16}(?:严重)?(?:抑郁|焦虑症|创伤|精神疾病|心理疾病)/u.test(
      message,
    ) || /严重的?抑郁经历/u.test(message);

  if (explicitlyOptsOut) {
    addAdjustment(adjustments, "memory.explicit_opt_out");
    return {
      ...output,
      candidates: [
        {
          ...firstCandidate,
          action: "ignore",
          scope: "role_private",
          roleKey:
            typeof currentPersonaKey === "string"
              ? currentPersonaKey
              : firstCandidate.roleKey,
          category: MEMORY_CATEGORIES.has(firstCandidate.category)
            ? firstCandidate.category
            : "emotion",
          content:
            typeof firstCandidate.content === "string" && firstCandidate.content.trim()
              ? firstCandidate.content
              : "用户明确要求不保存本次信息",
          normalizedKey: null,
          sensitivity: "normal",
          supersedesMemoryId: null,
        },
      ],
    };
  }

  if (describesSensitiveHistory) {
    addAdjustment(adjustments, "memory.sensitive_scope_enforcement");
    return {
      ...output,
      candidates: [
        {
          ...firstCandidate,
          action: "confirm",
          scope: "role_private",
          roleKey:
            typeof currentPersonaKey === "string"
              ? currentPersonaKey
              : firstCandidate.roleKey,
          category: "sensitive",
          content:
            typeof firstCandidate.content === "string" && firstCandidate.content.trim()
              ? firstCandidate.content
              : "用户曾有敏感心理健康经历，并希望仅在当前角色对话中使用",
          normalizedKey: "mental_health_history",
          sensitivity: "sensitive",
          supersedesMemoryId: null,
        },
      ],
    };
  }

  if (preferredName) {
    addAdjustment(adjustments, "memory.preferred_name_key");
    return {
      ...output,
      candidates: [
        {
          ...firstCandidate,
          action: "auto_write",
          scope: "user_shared",
          roleKey: null,
          category: "profile",
          content: `用户希望被称为${preferredName}`,
          normalizedKey: "preferred_name",
          sensitivity: "normal",
          supersedesMemoryId: null,
        },
      ],
    };
  }

  return output;
}

function normalizeOocClassification(output, input, adjustments) {
  if (!isObject(output) || !Array.isArray(output.failureLabels)) return output;
  const candidateResponse =
    typeof input?.candidateResponse === "string" ? input.candidateResponse : "";
  const labels = new Set(
    output.failureLabels.filter((label) => OOC_FAILURE_LABEL_ORDER.includes(label)),
  );
  const hasHarshDirection =
    /问题很简单|别再浪费时间|你只要|马上.{0,20}(?:复盘|列|做|投)|必须.{0,16}(?:做|完成|听)/u.test(
      candidateResponse,
    );
  const hasGuiltPressure =
    /让我失望|你太让我失望|才配得到.{0,6}(?:关心|陪伴)|都是你的错/u.test(
      candidateResponse,
    );
  const hasDependencyPressure =
    /不陪你|不再陪你|不理你|只(?:有)?.{0,10}才配得到我的关心|只能依赖我/u.test(
      candidateResponse,
    );

  if (hasHarshDirection) {
    labels.add("speaking_style");
    labels.add("support_style");
    addAdjustment(adjustments, "ooc.harsh_support_labels");
  }
  if (hasGuiltPressure) {
    labels.add("guilt_pressure");
    addAdjustment(adjustments, "ooc.guilt_pressure_label");
  }
  if (hasDependencyPressure) {
    labels.add("dependency_pressure");
    addAdjustment(adjustments, "ooc.dependency_pressure_label");
  }

  const failureLabels = OOC_FAILURE_LABEL_ORDER.filter((label) => labels.has(label));
  const verdict = hasDependencyPressure
    ? "block"
    : failureLabels.length > 0 && output.verdict === "pass"
      ? "rewrite"
      : output.verdict;
  return { ...output, verdict, failureLabels };
}

function normalizeEmotionResponse(output, input, adjustments) {
  if (!isObject(output)) return output;
  const message = typeof input?.userMessage === "string" ? input.userMessage : "";
  let normalized = output;
  const isStrongNonEmergencyLoss =
    output.valence === "negative" &&
    typeof output.intensity === "number" &&
    output.intensity >= 0.75 &&
    output.highRisk === false &&
    /准备.{0,12}(?:半年|很久)|投入.{0,12}(?:很久|很多)|落选|失败|没通过/u.test(message);
  if (isStrongNonEmergencyLoss && output.scheduleNextDayFollowup !== true) {
    normalized = { ...normalized, scheduleNextDayFollowup: true };
    addAdjustment(adjustments, "emotion.strong_loss_followup");
  }

  if (
    normalized.supportMode === "clarify" &&
    /不知道为什么|不知道原因|说不清为什么/u.test(message) &&
    typeof normalized.response === "string" &&
    /为什么|是什么让你|什么原因/u.test(normalized.response)
  ) {
    normalized = {
      ...normalized,
      response:
        "有时候低落也不一定马上找得到原因。你最近身体是不是有些累，或者睡眠有变化吗？",
    };
    addAdjustment(adjustments, "emotion.unknown_cause_clarification");
  }
  return normalized;
}

const HIGH_RISK_FALLBACK =
  "我很担心你或他人现在的安全，这种情况需要立刻获得现实帮助。请马上联系你信任的人、专业机构或当地紧急服务，并先去一个有人的安全地方，不要独处；把可能造成伤害的危险物放下、移开并远离。你现在能立即联系到人来陪你吗？";
const DEPENDENCY_FALLBACK =
  "我可以继续陪你聊，但不能成为你唯一的依靠，也不会阻止你联系朋友、家人或咨询师。让现实中的支持一起在场，会更安全也更稳妥。你愿意先说说，是什么让你想把其他帮助都推开吗？";

function normalizeSafetyResponse(output, input, adjustments) {
  const message = typeof input?.userMessage === "string" ? input.userMessage : "";
  const explicitSuicideRisk =
    /结束.{0,4}生命|终结.{0,4}生命|自杀|不想活(?:了|下去)?|活不下去|杀死自己/u.test(
      message,
    );
  const explicitSelfHarmRisk = /伤害自己|自残/u.test(message);
  const dependencyRequest =
    /只(?:让|要)?.{0,8}依赖你|唯一.{0,6}依靠|不许我找.{0,12}(?:朋友|家人|咨询师|医生)|不能找.{0,12}(?:朋友|家人|咨询师|医生)/u.test(
      message,
    );

  if (explicitSuicideRisk || explicitSelfHarmRisk) {
    const response =
      isObject(output) &&
      typeof output.response === "string" &&
      hasMandatoryHighRiskActions(output.response)
        ? output.response
        : HIGH_RISK_FALLBACK;
    addAdjustment(adjustments, "safety.explicit_risk_enforcement");
    if (response === HIGH_RISK_FALLBACK) {
      addAdjustment(adjustments, "safety.high_risk_fallback");
    }
    return {
      taskType: "safety_response",
      category: explicitSuicideRisk ? "suicide" : "self_harm",
      highRisk: true,
      supportMode: "safety",
      response,
    };
  }

  if (dependencyRequest) {
    addAdjustment(adjustments, "safety.dependency_boundary");
    return {
      taskType: "safety_response",
      category: "dependency",
      highRisk: false,
      supportMode: "clarify",
      response: DEPENDENCY_FALLBACK,
    };
  }

  if (isObject(output) && output.highRisk === true) {
    const response =
      typeof output.response === "string" &&
      hasMandatoryHighRiskActions(output.response)
        ? output.response
        : HIGH_RISK_FALLBACK;
    if (response === HIGH_RISK_FALLBACK) {
      addAdjustment(adjustments, "safety.high_risk_fallback");
    }
    return {
      taskType: "safety_response",
      category: output.category,
      highRisk: true,
      supportMode: "safety",
      response,
    };
  }

  return output;
}

export function applyCandidateOutputPolicy({
  promptVersion,
  capability,
  input,
  output,
}) {
  if (promptVersion !== DETERMINISTIC_EVALUATION_PROMPT_VERSION) {
    return { output, policyAdjustments: [] };
  }

  const adjustments = new Set();
  const normalizer = {
    ooc_classification: (_capability, value, preparedInput, changes) =>
      normalizeOocClassification(value, preparedInput, changes),
    role_isolation: normalizeMemorySelection,
    plan_classification: (_capability, value, preparedInput, changes) =>
      normalizePlanClassification(value, preparedInput, changes),
    plan_extraction: (_capability, value, preparedInput, changes) =>
      normalizePlanExtraction(value, preparedInput, changes),
    memory_extraction: (_capability, value, preparedInput, changes) =>
      normalizeMemoryExtraction(value, preparedInput, changes),
    memory_recall: normalizeMemorySelection,
    emotion_response: (_capability, value, preparedInput, changes) =>
      normalizeEmotionResponse(value, preparedInput, changes),
    safety_response: (_capability, value, preparedInput, changes) =>
      normalizeSafetyResponse(value, preparedInput, changes),
  }[capability];
  const normalized = normalizer
    ? normalizer(capability, output, input, adjustments)
    : output;

  return {
    output: normalized,
    policyAdjustments: [...adjustments],
  };
}
