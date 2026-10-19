# MiniMax-M3 V0.1 dev 单条 Key 探测复核

运行日期：2026-09-03  
Run ID：eval-f199a0bbf7eb9058  
供应商：MiniMax Anthropic-compatible Messages API  
模型：MiniMax-M3  
Prompt：yanxing-eval-v0.3  
策略：v0.2

## 探测边界

- 在上一轮 32 条请求全部返回 HTTP 429、用户更新 API Key 并明确要求重试后执行；
- 只选择冻结 dev 中的 `v0_1_persona_response_001`；
- 只发起一次请求，没有自动重试，没有运行其他 31 条 dev 或 48 条 test；
- 使用独立报告文件和 Run ID，没有覆盖上一轮失败报告；
- 未发送 expected、tags、split、caseKey、评分说明或真实用户聊天；
- API Key、请求 Header、Provider 错误正文和 reasoning 正文均未写入报告。

## 结果

| 指标         |                      结果 |
| ------------ | ------------------------: |
| 选择样本     | v0_1_persona_response_001 |
| completed    |                       1/1 |
| failed       |                       0/1 |
| 严格结构边界 |                      通过 |
| rawOutput    |                      存在 |
| final output |                      存在 |
| 策略调整     |                         0 |
| 延迟         |                  4,599 ms |
| 输入 Token   |                       393 |
| 输出 Token   |                        24 |
| 总 Token     |                       417 |

## 结论

1. 更新后的 Key 已在一条真实 MiniMax-M3 请求中通过供应商入口，不再返回 HTTP 429。
2. 该样本返回了可解析且通过严格 Schema 的 rawOutput 和 final output，没有发生确定性策略修正。
3. 单条成功只能证明当前 Key、端点、模型权限和请求格式至少在这一次请求中可用，不能代表其余 31 条 dev 的稳定性或能力质量。
4. 上一轮 Run ID `eval-6c149a4435dfd178` 的 0/32 completed 仍是独立、不可覆盖的历史事实。
5. 在产品负责人另行明确授权前，不运行新的完整 32 条 dev，不运行冻结 test，不接产品聊天，不设置默认模型。

## 后续完整重跑

产品负责人随后已明确授权完整重跑。独立 rerun1 报告为 31/32 completed、raw 严格边界 30/32、final 严格边界 31/32；没有自动重试，也没有运行冻结 test。详情见 `minimax-m3-v0.1-dev-v3-rerun1.review.md`。
