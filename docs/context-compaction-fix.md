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

## 2026-10-27：压缩请求的推理参数兼容

用户提供的会话记录显示，同一轮 54 次摘要请求全部被服务端以 HTTP 400 拒绝，均涉及 `reasoning_effort: "off"`。最后由本地请求边界保护以 373923 个估算输入 tokens 超过 372000 个可用 tokens 而结束；这不是成功压缩后的计量偏差。导出不包含完整模型配置或应用版本，因此不能仅凭此包确认现场配置的写入来源。

已在锁定的 `0.2.0-rc.2` 代码中复现两条组合路径：

- 模型设置中新增 `off` 会默认保存为 `off: "off"`，继而被 OpenAI-compatible 序列化器原样发送。新配置现在使用 `off: null`，表示不发送该参数；既有显式映射保持不变，避免改坏确实接受 `off` 或自定义 wire 值的服务。这不保证省略参数等同于所有服务的“关闭思考”；具体语义仍由线路能力和显式配置决定。
- 同模型的摘要请求未继承当前对话的显式推理选择。例如主请求是 `max`，摘要却落回线路默认值。摘要现在仅在 provider 和 model 均匹配时继承最新持久化请求的显式 `reasoningEffort`（包括 `off`）；独立配置的摘要模型不继承另一个模型的推理等级，仍使用自身默认设置。

自动压缩遇到结构化的 `INVALID_REQUEST`、`AUTH`、`FORBIDDEN`、`UNSUPPORTED_REASONING_EFFORT` 或 `UNSUPPORTED_OPTION` 时，保留原错误和会话数据并结束当前轮次，避免下一工具步骤再次请求同一个被拒绝的摘要。修正配置后新轮次可重新压缩，没有持久化失败缓存。网络、限流或服务端暂时失败仍沿用原恢复路径，并始终接受输入硬预算检查；不关闭压缩、不扩大模型窗口、不删除历史。

改动限定在 `dsh-client-ui-settings-models` 和 `dsh-compaction-basic` 的可重放补丁（含摘要钩子声明文档），不新增服务、RPC、slot 或持久化事件格式。前者缺少安全的 `off` 默认值，后者缺少摘要推理参数继承与确定性拒绝的退出路径；上游提供等价实现后可移除相应补丁，保留行为回归。

回归执行安装依赖中的真实 AgentLoop、Session、TokenMeter、BasicCompactionEngine、PiAiAdapter 和 HTTP/SSE 序列化；只有环回地址上的模型推理为合成 fixture，不包含真实会话正文、端点或凭据。覆盖旧 `off` 映射下主请求成功而摘要失败、显式关闭推理、独立摘要模型、400 拒绝后保留历史并恢复，以及暂时失败的可恢复性。模型等级 UI 的回归同时保留自定义 wire 映射。

### 本轮验证（Windows x64）

- 修复前先复现 9 项失败；修复后参数、压缩与真实 React 输入的定向回归全部通过。
- 干净 `npm ci --no-audit --no-fund` 的 postinstall 完成，40 个补丁重放成功；`npm run typecheck`、`npm run build` 和 `git diff --check` 通过。
- `npm test -- --maxWorkers=2 --reporter=json --outputFile=.build/compaction-reasoning-full.json`：239 个文件，2341 项通过、7 项平台条件跳过、0 失败。
- `verify-target` 确认本地 Electron 44.0.0 / Node 24.18.1 可加载原生 Harness。独立开发目录包复用该本地 Electron，未更改发布配置；两个补丁包的打包后 JS 与干净重放结果逐字节一致。
- 源码及开发目录包的隔离真实客户端验证通过，覆盖认证、HTML/bootstrap、界面挂载、Office 预览和恢复弹层。
- 未连接用户真实 SGLang 端点、未运行 macOS 原生验收、未安装或正式发布；合成 HTTP 推理通过不等于用户服务端的模型生成质量已经验收。现有显式 `off` wire 映射及用户真实配置没有被自动改写。
