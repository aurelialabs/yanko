# 言行 Yanko

AI 陪伴 + 行动助手（实习 Demo）。稳定人设、可控记忆、确认后才进计划。

## 快速体验

- 本地：配置 MiniMax（见 `.env.example`）后 `npm run dev:minimax`，打开 `http://localhost:3002/chat`
- 面试部署：见 [DEPLOY.md](./DEPLOY.md)（GitHub + Vercel + 环境变量清单）

## App 入口与 iPhone 安装

打开站点根地址 `/` 会进入 Yanko 欢迎页。首次使用从邮箱登录进入 `/onboarding` 选择陪伴角色；完成状态保存在登录账号的 metadata 中。已有聊天记录的旧账号直接播放回访动画并进入 `/chat`。欢迎文字逐字浮现，支持系统“减少动态效果”和手动跳过。

未登录也可以选择“先体验一下”，角色与引导状态只保存在当前浏览器，不代表账号登录。直接打开聊天、计划等链接仍可访问原有体验流程。

iPhone 使用 Safari 打开站点根地址，点击分享 → 添加到主屏幕；若出现“作为网页 App 打开”，保持开启。安装说明在 `/install`，也可从“我的”进入。安装后使用独立窗口、PNG 主屏幕图标和 iOS 安全区域布局。聊天与账号服务仍需联网；离线操作不会被当成已保存。

真实邮箱登录需要部署环境配置 `.env.example` 中的 Supabase、应用地址和 `AUTH_RATE_LIMIT_PEPPER`，以及对应的数据库迁移、邮件服务和回调白名单。请在发起登录的同一浏览器环境中打开邮件链接。此版本通过网页 App 安装，不是 App Store 安装包。

免登录演示数据保存在浏览器 `localStorage`，不会写入生产账号库。

## 常用命令

```bash
npm install
npm run dev          # 默认 mock
npm run dev:minimax  # MiniMax 演示聊天
npm run build
npm run typecheck
npm test
```
