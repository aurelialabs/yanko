import { describe, expect, it } from "vitest";

import {
  DETERMINISTIC_HIGH_RISK_RESPONSE,
  hasExplicitImmediateSafetyRisk,
} from "./chat-safety";

describe("deterministic high-risk boundary", () => {
  it.each([
    "我不想活了",
    "我打算吞药结束生命",
    "I want to kill myself",
    "我可能会伤害别人",
  ])("detects explicit immediate-risk language", (content) => {
    expect(hasExplicitImmediateSafetyRisk(content)).toBe(true);
  });

  it.each(["我今天很难过", "这个任务让我想放弃", "请帮我整理明天的计划"])(
    "does not classify ordinary distress as explicit immediate risk",
    (content) => {
      expect(hasExplicitImmediateSafetyRisk(content)).toBe(false);
    },
  );

  it("contains every mandatory real-world safety action", () => {
    expect(DETERMINISTIC_HIGH_RISK_RESPONSE).toContain("可信任的人");
    expect(DETERMINISTIC_HIGH_RISK_RESPONSE).toContain("紧急服务");
    expect(DETERMINISTIC_HIGH_RISK_RESPONSE).toContain("有人的安全地点");
    expect(DETERMINISTIC_HIGH_RISK_RESPONSE).toContain("移开");
    expect(DETERMINISTIC_HIGH_RISK_RESPONSE).toContain("现在能马上联系到谁");
  });
});
