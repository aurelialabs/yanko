# MiniMax-M3 V0.1 dev 第三轮入口失败复核

运行日期：2026-09-03  
Run ID：eval-6c149a4435dfd178  
供应商：MiniMax Anthropic-compatible Messages API  
模型：MiniMax-M3  
Prompt：yanxing-eval-v0.3  
策略：v0.2

## 运行边界

- 仅对冻结数据集中的 32 条合成 dev 各发起一次请求，未运行 48 条冻结 test；
- 没有自动重试，也没有在本次运行后补发探测请求；
- 未发送 expected、tags、split、caseKey、评分说明或真实用户聊天；
- API Key、请求 Header和 Provider 错误正文均未写入逐样本报告、摘要或本复核文件；
- 候选没有接入产品聊天，也没有成为默认模型；
- 本次没有得到模型输出，不能用于比较 MiniMax-M3 的质量、安全、延迟或 Token 成本。

## 运行结果

| 指标                |   结果 |
| ------------------- | -----: |
| 总样本              |     32 |
| 唯一样本 ID         |     32 |
| completed           |      0 |
| failed              |     32 |
| HTTP 429            |     32 |
| 带模型正文          |      0 |
| 带 Token usage      |      0 |
| 带 rawOutput        |      0 |
| 发生策略介入        |      0 |
| HTTP 拒绝延迟最小值 | 114 ms |
| HTTP 拒绝延迟 P50   | 159 ms |
| HTTP 拒绝延迟 P95   | 483 ms |
| HTTP 拒绝延迟最大值 | 727 ms |

这里的延迟只表示服务端返回 HTTP 429 的时间，不是模型推理延迟，不得与 qwen-turbo 或 DeepSeek 的 completed 延迟横向比较。报告没有 Token usage，因此不能从评测产物计算本次账单；实际计费状态应以 MiniMax 控制台为准。

## 失败分类

32 条记录的脱敏错误完全相同：

```text
Candidate model request failed with HTTP 429.
```

所有请求都在返回模型正文之前被拒绝。HTTP 429 通常与账户额度／套餐、Key 或项目配额、目标模型权限、QPS／TPM 限制等供应商入口条件有关，但当前证据不足以确认其中哪一种。

Adapter 按安全约束不会读取或保存 Provider 错误正文，因此报告中没有供应商内部错误码或错误描述。不能把这个限制转换成对模型能力的推断，也不能因为 32 条都失败就说 MiniMax-M3 未通过安全或结构化质量门槛。

## 当前结论

1. 本次运行完整覆盖了 32 个不同的 dev 样本 ID，但只形成 32 条供应商入口失败记录。
2. MiniMax-M3 的可用输出为 0/32，原因是所有请求均返回 HTTP 429，而不是输出未通过 JSON Schema。
3. 当前没有任何可供人工盲标、字段级比对、策略介入统计或安全门槛判定的模型结果。
4. MiniMax-M3 目前不能进入冻结 test、产品聊天或 G2 模型定型。
5. 本报告必须保留为一次独立失败运行，不能覆盖或冒充之后可能获得授权的重跑结果。

## 后续单条探测

用户更新 API Key 并明确要求重试后，已使用独立报告和 Run ID `eval-f199a0bbf7eb9058` 对 `v0_1_persona_response_001` 发起一次请求：1/1 completed、严格结构边界通过、无策略修正，延迟 4,599ms，总计 417 Token。这证明更新后的 Key 已在一次请求中解除 HTTP 429，但不会追溯修改本报告的 0/32 结果，也不代表其余 31 条 dev 已通过。详情见 `minimax-m3-v0.1-dev-v3-probe1.review.md`。

## 后续完整重跑

用户随后明确授权使用新 Key 完整重跑 32 条 dev、不运行 test、不自动重试失败项。独立产物 `minimax-m3-v0.1-dev-v3-rerun1.jsonl` 为 31/32 completed，模型 raw 严格通过 30/32，系统 final 通过 31/32；详情见 `minimax-m3-v0.1-dev-v3-rerun1.review.md`。由于运行器 Run ID 当前未包含执行批次，rerun1 与本报告碰撞为同一个 `eval-6c149a4435dfd178`，引用时必须使用完整报告路径区分。

## 下一步

1. 更新后的 Key 已通过单条探测和完整 rerun1，HTTP 429 已解除；
2. 修复相同配置重跑时的 Run ID 碰撞；
3. 对可用生成文本进行双人盲标并完成供应商隐私审查；
4. 在 G2 前不运行冻结 test、不接产品聊天、不设置默认模型。
