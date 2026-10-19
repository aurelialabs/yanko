import { expect, test } from "@playwright/test";

test("PWA installs only public assets and blocks an offline login submission", async ({
  context,
  page,
}) => {
  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.status()).toBe(200);
  await expect(manifestResponse.json()).resolves.toMatchObject({
    name: "言行",
    start_url: "/chat",
    display: "standalone",
    icons: [
      { src: "/pwa/icon-192.svg", sizes: "192x192" },
      { src: "/pwa/icon-512.svg", sizes: "512x512" },
    ],
  });

  const workerResponse = await page.request.get("/service-worker.js");
  expect(workerResponse.status()).toBe(200);
  expect(workerResponse.headers()["cache-control"]).toContain("no-store");
  expect(workerResponse.headers()["service-worker-allowed"]).toBe("/");
  const workerScript = await workerResponse.text();
  expect(workerScript).not.toContain("/chat");
  expect(workerScript).not.toContain("/auth/");

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "欢迎来到言行" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        return Boolean(await navigator.serviceWorker.getRegistration("/"));
      }),
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("status")).toContainText("当前处于离线状态");

  await page.getByLabel("邮箱").fill("offline@example.invalid");
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await expect(page.getByRole("status")).toContainText("本次提交未发送");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("status")).toHaveCount(0);

  await context.setOffline(true);
  await page.goto("/chat");
  await expect(page.getByRole("heading", { name: "暂时无法连接网络" })).toBeVisible();
  await expect(page.getByText(/不会显示聊天、记忆、计划或账号内容/)).toBeVisible();
});
