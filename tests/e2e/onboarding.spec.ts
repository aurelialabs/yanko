import { expect, test } from "@playwright/test";

test("first visit offers login followed by companion selection", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "很高兴，遇见你" })).toBeVisible();
  await page.getByRole("link", { name: /登录，开启陪伴/ }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fonboarding$/);
  await expect(page.getByLabel("邮箱")).toBeVisible();
  await expect(page.locator('input[name="nextPath"]')).toHaveValue("/onboarding");
});

test("a guest chooses a companion and sees a welcome on their next launch", async ({
  page,
}) => {
  await page.goto("/onboarding?guest=1");
  await expect(page.getByRole("button", { name: /选择一位伙伴/ })).toBeDisabled();
  await page.getByRole("radio", { name: /南枝/ }).check();
  await page.getByRole("button", { name: /和南枝开始聊天/ }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("heading", { name: /南枝/ })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "欢迎回到 Yanko" })).toBeVisible();
  await expect(page).toHaveURL(/\/chat$/, { timeout: 8000 });
  await expect(page.getByRole("heading", { name: /南枝/ })).toBeVisible();
});

test("reduced motion quickly enters the app and installation has Apple metadata", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem("yanko-guest-onboarding-v1", "complete"),
  );
  await page.reload();
  await expect(page).toHaveURL(/\/chat$/, { timeout: 8000 });
  await expect(
    page.locator('meta[name="apple-mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/icons/apple-touch-icon.png",
  );
  await page.goto("/install");
  await expect(
    page.getByRole("heading", { name: "把言行放到 iPhone 主屏幕" }),
  ).toBeVisible();
  await expect(page.getByText("选择“添加到主屏幕”", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
