# 上下文预算与请求边界压缩

## 已复现的问题

基线为 Harness `0.2.0-rc.2`。本地回归先运行原始实现，7 项检查中 5 项失败：

- 默认 `headroomTokens=65536` 导致 8K、32K、64K 模型无法形成有效压缩预算；原监听器只告警，随后继续请求。
- `agent/pre-step` 检查早于本轮消息、系统提示、工具清单和路由的落日志，因此首轮大输入、模型切换及新增输入不在该次检查范围内。
- 文本、工具参数及工具清单统一按 UTF-16 字符数除以 4 计价，4000 个中文字符只计为约 1000 tokens。

这些是确定的代码路径，不代表已取得用户现场失败请求。实际部署的模型窗口必须与服务端设置一致；本修复不探测或修改服务端配置。

## 修改范围

四个 `patch-package` 补丁均针对 `0.2.0-rc.2`：

- `dsh-agent`：声明临时、串行的 `agent/request-ready` 事件。
- `dsh-agent-loop`：在完整请求进入日志后、流式调用前等待上述事件；若压缩改变 surface，则重新构造请求。每次重试也执行此边界。
- `dsh-compaction-basic`：自动压力检查迁到请求边界；未显式配置的 headroom 取可用输入预算的 20%，上限保持 65536。显式配置保留并校验。摘要请求同时计入压缩指令、工具声明，限制输出额度不超过模型默认额度及剩余空间。压缩失败后仍重新检查硬预算，不能以警告代替保护。
- `dsh-token-meter`：ASCII 保持原估算，非 ASCII 按 UTF-8 字节权重估算；实际服务与公共 estimate 子路径同步。上下文构成投影版本升级以重算旧缓存。

现有接口没有“消息已写入、尚未发请求”的等待接缝，不能仅用 `pre-step` 插件修复该时序。新增事件不改变持久化事件格式、RPC、会话 ID 或工具并发协议，无 UI slot 变化。新事件与压缩实现需组合部署；本仓库 postinstall 同时重放这些补丁。

压缩仍沿用上游选区、工具调用配对、事务及有限次数恢复。不会截断用户最新消息或删除原始历史。手动关闭自动压缩仍受尊重。达到软阈值会尝试压缩；压缩不可行但尚在输入硬预算内时可继续；已知超过硬预算时明确结束当前请求，用户可缩短输入、减少工具或输出额度、选择更大窗口模型。

## 边界

- 多语言权重仍是启发式估算，不是任意模型的精确 tokenizer，不能保证所有供应商永不返回超限；保留供应商明确超限后的有限恢复逻辑。
- 系统提示、工具 schema、最新单条不可拆分输入不能靠历史摘要无限缩小。历史选区本身超过摘要模型窗口时，当前实现明确报错；没有新增分块递归摘要或悄悄丢弃内容。
- 未新增模型调用之外的网络请求、遥测上传、配置落盘或真实用户数据读取。
- 上游提供等价请求边界、窗口自适应预算和多语言估算后，应移除对应补丁并保留行为回归。

## 验证入口

`test/context-compaction.test.mjs` 使用安装依赖的真实 AgentLoop、Session、TokenMeter 和 BasicCompactionEngine，只有模型适配器是确定性的内存 fixture，不使用凭据或外部模型。

覆盖小窗口预算、显式配置、中文工具 schema、真实跨轮压缩与请求重建、模型切换、首轮超限、摘要失败、取消及关闭自动压缩。额外执行干净 `npm ci` 补丁重放、类型检查、构建与全量回归；具体结果以交付记录为准。源码验证不等于用户现有安装包已更新，也不替代真实服务端 tokenizer 验收。

### 本轮执行记录（2026-10-16，Windows x64）

- `npm ci --no-audit --no-fund`：postinstall 全部补丁重放成功。
- `npm run typecheck`、`npm run build`、`git diff --check`：通过。
- `npm test -- --maxWorkers=2 --reporter=json --outputFile=.build/context-compaction-tests.json`：207 文件、1817 项通过、7 项跳过、0 失败。
- 全量运行期间补充了大型工具结果配对测试；随后独立运行 `test/context-compaction.test.mjs`，全部 15 项通过（全量报告包含此前 14 项）。产品代码在这两次验证间没有变更。
- `node scripts/check-desktop-profile.cjs`：隔离 Windows Profile 下真实 Electron 44.0.0、认证 HTML/bootstrap、客户端挂载、Safe Mode 和窗口交互检查通过。
- 未构建或安装新发行安装包，未连接用户真实模型，未执行 macOS 原生验收；不声称线上超限问题已在用户安装版本中消失。

上游交叉核对：[默认固定 headroom 的问题讨论](https://github.com/deepseek-ai/deepseek-harness/discussions/8079)、[TokenMeter 的估算边界](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/token-meter/README.md)。实现与测试以本仓库锁定的实际安装依赖为准，不直接套用其他版本的结论。
