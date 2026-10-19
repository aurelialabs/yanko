import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BadcaseReviewList } from "./badcase-review-list";

const id = "11111111-1111-4111-8111-111111111111";

describe("BadcaseReviewList", () => {
  it("renders redacted list data and preserves approved filters in links", () => {
    render(
      <BadcaseReviewList
        data={{
          source: "database",
          items: [
            {
              id,
              source: "manual",
              capability: "persona_response",
              severity: "high",
              status: "open",
              redactedExcerpt: "已脱敏的失败摘要",
              createdAt: "2026-09-08T00:00:00.000Z",
              updatedAt: "2026-09-08T00:00:00.000Z",
              reviewRevision: 0,
            },
          ],
        }}
        filter={{ status: "open", severity: "all", source: "manual" }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Badcase 复核" })).toBeVisible();
    expect(screen.getByText("已脱敏的失败摘要")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看复核详情" })).toHaveAttribute(
      "href",
      `/admin/badcases/${id}`,
    );
    expect(screen.getByRole("link", { name: "待处理" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "高" })).toHaveAttribute(
      "href",
      "/admin/badcases?status=open&severity=high&source=manual",
    );
    expect(screen.queryByText("用户身份")).not.toBeInTheDocument();
  });

  it("renders a non-sensitive denial without a demo diagnostic", () => {
    render(<BadcaseReviewList data={{ source: "forbidden", items: [] }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("没有访问此后台的权限");
    expect(screen.queryByText("已脱敏的失败摘要")).not.toBeInTheDocument();
  });
});
