import { expect, test } from "@playwright/test";

test("PWA installs only public assets and blocks an offline login submission", async ({
  context,
  page,
}) => {
  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.status()).toBe(200);
  await expect(manifestResponse.json()).resolves.toMatchObject({
    name: "Yanko · 言行",
    start_url: "/",
    display: "standalone",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  });

  const workerResponse = await page.request.get("/service-worker.js");
  expect(workerResponse.status()).toBe(200);
  expect(workerResponse.headers()["cache-control"]).toContain("no-store");
  expect(workerResponse.headers()["service-worker-allowed"]).toBe("/");
  const workerScript = await workerResponse.text();
  expect(workerScript).not.toContain('"/chat"');
  expect(workerScript).not.toContain('"/auth/"');

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

  const cachedPaths = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) =>
      name.startsWith("yanko-pwa-shell-"),
    );
    return (
      await Promise.all(
        names.map(async (name) =>
          (await (await caches.open(name)).keys()).map(
            (request) => new URL(request.url).pathname,
          ),
        ),
      )
    ).flat();
  });
  expect(cachedPaths).toEqual(
    expect.arrayContaining([
      "/offline.html",
      "/manifest.webmanifest",
      "/icons/apple-touch-icon.png",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
    ]),
  );
  expect(
    cachedPaths.every(
      (path) =>
        path.startsWith("/_next/static/") ||
        [
          "/offline.html",
          "/manifest.webmanifest",
          "/icons/apple-touch-icon.png",
          "/icons/icon-192.png",
          "/icons/icon-512.png",
        ].includes(path),
    ),
  ).toBe(true);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("status")).toContainText("当前处于离线状态");

  await page.getByLabel("邮箱").fill("offline@example.invalid");
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await expect(page.getByRole("status")).toContainText("本次提交未发送");
  await expect(page.getByRole("status")).toContainText("不会自动补交");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("status")).toHaveCount(0);

  await context.setOffline(true);
  await page.goto("/chat");
  await expect(page.getByRole("heading", { name: "暂时无法连接网络" })).toBeVisible();
  await expect(page.getByText(/不会显示聊天、记忆、计划或账号内容/)).toBeVisible();
});

test("Safari installation instructions are public, manual, and readable on a narrow iPhone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/install");
  await expect(
    page.getByRole("heading", { name: "把言行放到 iPhone 主屏幕" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "在 Safari 中添加" })).toBeVisible();
  await expect(page.getByText("选择“添加到主屏幕”")).toBeVisible();
  await expect(page.getByText(/作为网页 App 打开/)).toBeVisible();
  await expect(page.getByRole("button", { name: /安装/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "继续使用言行" })).toHaveAttribute(
    "href",
    "/",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const icon = page.getByRole("img", { name: "言行", exact: true });
  await expect(icon).toHaveAttribute("src", "/icons/apple-touch-icon.png");
  expect(await icon.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(
    180,
  );
});

test("an installed window shows its current state instead of instructions to install again", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
  });
  await page.goto("/install");
  await expect(page.getByRole("heading", { name: "已从主屏幕打开言行" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "在 Safari 中添加" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "继续使用言行" })).toBeVisible();
});

test("mobile controls avoid focus zoom and the app follows the keyboard viewport without changing desktop height", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { height: 844, scale: 1 });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
  });
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "display-mode", value: "standalone" }],
  });
  await page.goto("/login");
  await expect(page.locator(".auth-device > .mobile-status")).toBeHidden();
  expect(
    await page
      .getByLabel("邮箱")
      .evaluate((input) => Number.parseFloat(getComputedStyle(input).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await page.goto("/chat");
  await expect(page.locator(".app-shell .mobile-status")).toBeHidden();
  await expect(page.locator(".app-shell")).toHaveCSS("height", "844px");
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", {
      configurable: true,
      value: 460,
    });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator(".app-shell")).toHaveCSS("height", "460px");
  expect(
    await page
      .locator(".page-content")
      .evaluate((content) => content.getBoundingClientRect().bottom),
  ).toBeLessThanOrEqual(460);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".app-shell")).toHaveCSS("height", "900px");
});
