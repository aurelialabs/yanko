import { expect, test } from "@playwright/test";

test("email login only asks for an email", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "欢迎来到言行" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toBeVisible();
  await expect(page.getByLabel("手机号")).toHaveCount(0);
  await expect(page.getByLabel("密码")).toHaveCount(0);
});

test("chat shell exposes the agreed navigation and avatar entry", async ({ page }) => {
  await page.goto("/chat");

  await expect(page.getByRole("link", { name: "切换或修改角色" })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "主导航" }).filter({
    visible: true,
  });
  await expect(navigation.getByText("聊天")).toBeVisible();
  await expect(navigation.getByText("计划")).toBeVisible();
  await expect(navigation.getByText("我的")).toBeVisible();
  await expect(navigation.getByRole("link", { name: "聊天" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(navigation.getByRole("link", { name: "计划" })).not.toHaveAttribute(
    "aria-current",
  );
  const todayOverview = page.getByLabel("今日计划概览");
  await expect(todayOverview).toContainText("1 / 4");
  await expect(todayOverview).toContainText("14:00");
  await expect(todayOverview).toContainText("整理作品集信息架构");

  await page
    .getByRole("button", { name: "长按反馈这条消息不符合人设" })
    .last()
    .click({ button: "right" });
  await expect(
    page.getByRole("heading", { name: "这句话哪里不符合人设？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "事实错误" }).click();
  await page.getByLabel("补充说明").fill("这里的事实和之前的对话不一致。");
  await page.getByRole("button", { name: "提交反馈" }).click();
  await expect(
    page.getByText("已进入待复核。可以在「我的」里查看。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭反馈" }).click();

  await page.getByLabel("输入消息").fill("我想先把作品集整理一下。");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText("我想先把作品集整理一下。")).toBeVisible();
  await expect(
    page.getByText("这是浏览器中的演示回复；连接聊天服务后才会保存消息记录。"),
  ).toBeVisible();

  await page.getByRole("link", { name: "切换或修改角色" }).click();
  await expect(page.getByRole("heading", { name: "角色" })).toBeVisible();
  await expect(page.getByText("选择今天陪伴你的人")).toBeVisible();
});

test("profile opens the truthful in-app reminder inbox", async ({ page }) => {
  await page.goto("/me");

  await page.getByRole("link", { name: /应用内提醒/ }).click();
  await expect(page).toHaveURL(/\/me\/notifications$/);
  await expect(page.getByRole("heading", { name: "应用内提醒" })).toBeVisible();
  await expect(page.getByText("系统通知尚未启用")).toBeVisible();
  await expect(page.getByText(/当前不会向设备发送 Push/)).toBeVisible();
  await expect(page.locator(".in-app-notification-empty")).toContainText(
    "提醒服务仍在准备中",
  );
  await expect(page.getByText("提醒已发送")).toHaveCount(0);
});

test("plan workspace exposes the Figma plan tabs", async ({ page }) => {
  await page.goto("/plan");

  await expect(page.getByRole("heading", { name: "计划" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "日计划" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("heading", { name: "今天的安排" })).toBeVisible();

  await page.getByRole("tab", { name: "年度目标" }).click();
  await expect(page.getByRole("tab", { name: "年度目标" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("heading", { name: "年度概览" })).toBeVisible();

  await page.getByRole("tab", { name: "周计划" }).click();
  await expect(page.getByRole("heading", { name: "本周待完成事项" })).toBeVisible();
  const weekItem = page.getByRole("button", {
    name: "完成：整理三个项目的素材",
  });
  await weekItem.click();
  await expect(
    page.getByRole("button", { name: "取消完成：整理三个项目的素材" }),
  ).toHaveAttribute("aria-pressed", "true");

  const anchorDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  await page.getByRole("link", { name: "整理三个项目的素材" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/plan/demo-week-2\\?scope=week&date=${anchorDate}$`),
  );
  await expect(page.getByRole("heading", { name: "计划详情" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "整理三个项目的素材" })).toBeVisible();
  await page.getByLabel("返回计划").click();
  await expect(page.getByRole("heading", { name: "计划" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "周计划" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByRole("tab", { name: "月计划" }).click();
  await expect(page.getByRole("heading", { name: "本月计划" })).toBeVisible();
  await page.getByRole("link", { name: "完成作品集第一版" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/plan/demo-month-1\\?scope=month&date=${anchorDate}$`),
  );
  await expect(page.getByRole("heading", { name: "计划详情" })).toBeVisible();
  await page.getByLabel("返回计划").click();
  await expect(page.getByRole("tab", { name: "月计划" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByRole("tab", { name: "年度目标" }).click();
  await page.getByRole("link", { name: "作品集 V1" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/plan/demo-year-career-1\\?scope=year&date=${anchorDate}$`),
  );
  await expect(page.getByRole("heading", { name: "计划详情" })).toBeVisible();
  await page.getByLabel("返回计划").click();
  await expect(page.getByRole("tab", { name: "年度目标" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByRole("button", { name: "＋ 新建计划" }).click();
  await expect(page.getByRole("heading", { name: "新建计划" })).toBeVisible();
});

test("plan rows reveal a quick delete control after a left swipe", async ({ page }) => {
  await page.goto("/plan");
  await page.getByRole("tab", { name: "周计划" }).click();

  const planTitle = "完成作品集首页初稿";
  const row = page.locator(".plan-list-row", { hasText: planTitle });
  const deleteButton = page.getByRole("button", { name: `删除：${planTitle}` });
  await expect(deleteButton).toBeHidden();

  const box = await row.boundingBox();
  if (!box) throw new Error("计划条目未渲染");

  await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 112, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  const swipeContainer = row.locator("../..");
  await expect(swipeContainer).toHaveAttribute("data-open", "true");
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();
  await expect(page.getByRole("link", { name: planTitle })).toHaveCount(0);
});

test("annual goal delete controls stay hidden until a subgoal is swiped", async ({
  page,
}) => {
  await page.goto("/plan");
  await page.getByRole("tab", { name: "年度目标" }).click();

  const subgoal = page.locator(".plan-subgoal").first();
  const container = subgoal.locator("../..");
  const title = (await subgoal.getByRole("link").textContent())?.trim();
  if (!title) throw new Error("年度子目标未渲染");

  const deleteButton = page.getByRole("button", { name: `删除：${title}` });
  await expect(deleteButton).toBeHidden();

  const box = await subgoal.boundingBox();
  if (!box) throw new Error("年度子目标未渲染");
  await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 112, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  await expect(container).toHaveAttribute("data-open", "true");
  await expect(deleteButton).toBeVisible();
});
