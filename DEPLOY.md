# 言行 · 面试 Demo 部署清单（GitHub + Vercel）

目标：面试官打开链接即可用 **免登录 `/chat`**，无需本机 `npm run dev`。

## 一、仓库（GitHub）

1. 代码推送到 GitHub（本仓库）。
2. **不要**提交 `.env`、`.env.local`、`.env.*.local`（已在 `.gitignore`）。
3. README / 本文件可公开说明「数据留在浏览器 localStorage」。

## 二、Vercel 接入

1. [vercel.com](https://vercel.com) 用 GitHub 登录 → **Add New Project** → 导入本仓库。
2. Framework Preset：`Next.js`（一般会自动识别）。
3. Root Directory：仓库根目录（默认）。
4. **Node.js Version**：优先选与本地一致的 **24.x**；若构建报 `engines` 不符，可在 Project Settings → General 改为 **22.x**，并临时把 `package.json` 的 `engines.node` 放宽为 `>=22`。
5. Build Command：`npm run build`（默认即可）。
6. Install Command：`npm install`（默认即可）。
7. 先填好下方「面试 Demo 必填」环境变量，再点 **Deploy**。
8. 部署成功后，把 Production URL 配进 `NEXT_PUBLIC_APP_URL`（见下），再 **Redeploy** 一次。

可选：安装 Vercel GitHub 集成后，推 `main` 即自动部署。

## 三、环境变量

在 Vercel → Project → **Settings → Environment Variables** 中配置。  
面试 Demo 只需 **Production**（也可勾上 Preview）。

### 面试 Demo 必填

| 变量 | 示例值 | 说明 |
|------|--------|------|
| `MINIMAX_AI_ENABLED` | `true` | 打开 MiniMax 适配器 |
| `MINIMAX_AI_API_KEY` | （你的 Key） | **Server only**，勿加 `NEXT_PUBLIC_` |
| `MINIMAX_AI_MODEL` | `MiniMax-M3` | 须为此模型 id |
| `MINIMAX_AI_BASE_URL` | `https://api.minimax.cn/anthropic/v1/messages` | 国内 Anthropic 兼容端点；可按账号文档调整 |
| `NEXT_PUBLIC_APP_URL` | `https://你的项目.vercel.app` | 部署完成后填正式域名，再 Redeploy |

### 面试 Demo 推荐（可选）

| 变量 | 示例值 | 说明 |
|------|--------|------|
| `MINIMAX_AI_TEMPERATURE` | `0.2` | 不设则走代码默认 |
| `MINIMAX_AI_TIMEOUT_MS` | `120000` | 长回复时可加大 |

### 面试 Demo 不要开（保持默认 / 不配）

免登录路径不依赖这些；乱开会增加失败面：

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `AI_CHAT_RUNTIME_MODE`（登录后聊天默认 mock；Demo 走 `replyDemoChat`，不依赖此项）
- `MEMORY_*` / `PLAN_EXTRACTION_*` / `EMOTION_*` / `TRIGGER_*` / `VAPID_*` / `SENTRY_*` / `POSTHOG_*`
- 评测用：`TAOKE_TAG_AI_*` / `DEEPSEEK_AI_*`

完整键名见仓库根目录 `.env.example`。

## 四、上线后自检（3 分钟）

1. 打开 `https://你的域名/chat`（勿强制登录）。
2. 发一句情绪向的话 → 有模型回复。
3. 发「你还记得我在准备什么吗」类话 → 能接住记忆芯片里的作品集语境（或先在对话里埋一条记忆相关内容）。
4. 发「请帮我创建下周的周计划：……」→ 出现计划确认卡。
5. 对人设气泡长按 / 右键反馈 → 「我的」里能看到待复核。

失败时优先查：Vercel Function 日志里 MiniMax 4xx/超时、以及 `MINIMAX_AI_ENABLED` 是否为字符串 `true`。

## 五、安全与用量

- API Key 只放在 Vercel Environment Variables，**禁止**写进前端代码或 README。
- 面试期间可设 MiniMax 用量告警；结束后可暂停 Deployment 或轮换 Key。
- 仓库建议 **Private**；若改 Public，再次确认无密钥、无内部凭证。

## 六、本地对照

| 本地 | Vercel |
|------|--------|
| `.env.minimax-ai.local` + `npm run dev:minimax` | 项目环境变量 + 自动 `npm run build` / `next start` |
| `http://localhost:3002/chat` | `https://xxx.vercel.app/chat` |
