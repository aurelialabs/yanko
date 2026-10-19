# 言行 Yanko

AI 陪伴 + 行动助手（实习 Demo）。稳定人设、可控记忆、确认后才进计划。

## 快速体验

- 本地：配置 MiniMax（见 `.env.example`）后 `npm run dev:minimax`，打开 `http://localhost:3002/chat`
- 面试部署：见 [DEPLOY.md](./DEPLOY.md)（GitHub + Vercel + 环境变量清单）

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
