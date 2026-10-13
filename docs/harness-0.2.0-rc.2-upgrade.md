# Harness 0.2.0-rc.2 升级记录

下述第一部分保留上游的历史验收记录，不代表本 fork 的升级起点或本机验证结果。本 fork 的迁移与验收见文末独立章节。

仓库内所有 `@deepseek-ai/dsh-*` 依赖从 `0.1.7-rc.2` 固定到 `0.2.0-rc.2`。上游 `@deepseek-ai/dsh` 的依赖集只新增了 `dsh-experimental-schedule-bundle`，Cordis 系包版本不变。仓库内插件和 PPT 运行时的 dsh peer 区间追加 `^0.2.0-rc.1`。

## 补丁处理

- 13 个 dsh 补丁（另有 `cordis-plugin-loader`、`undici` 两个）可原样重放，只改文件名。
- 11 个补丁上下文失效，采用三方合并迁移：以旧版原始包为基准，把旧补丁的改动合入新版原始包，再用 `patch-package` 重新生成。`@deepseek-ai/dsh` 补丁要修改 `package.json`，需用 `--exclude '^$'` 覆盖默认排除规则。
- 需要人工处理的冲突：
  - `dsh-client-ui-agent-preset`：上游移除了 `AgentPresetSection` 的 `useDeveloperTools`，导入/导出/搜索逻辑照旧追加。
  - `dsh-client-ui-chat`：上游让 Desktop 默认使用 `standard` 记录视图，`openUploadedAttachment` 提供者接在新的构造之后。
  - `dsh-client-ui-settings-models`：上游在编辑器提交时新增 `onSubmitCredential`，同步写入 Desktop 的 `footerProps`。
  - `dsh-client-ui-workspace` 类型：采用上游新的 `forkSession(sessionId, onCreated?) => Promise<SessionId>` 签名，保留 Desktop 的 `deleteSession` 及注册接口。
- 删除 `dsh-client-ui-model-selection` 补丁及其测试：上游 0.2.0 已原生提供模型搜索（超过 4 个模型时显示，按名称排序，带清除按钮）。与旧补丁的区别：搜索不再匹配服务商名称，模型少于 5 个时不显示搜索框。

## 验证边界

已执行：全新 `npm ci` 重放 26 个补丁、`npm run typecheck`、`npm run ppt:build` 后完整 `vitest`（170 个文件、1539 个用例）、`npm run build`、`scripts/verify-harness-auth.mjs`。macOS 开发构建使用临时 userData 启动：Harness 就绪，客户端完成挂载，Agent 预设页的导入、Awesome preset 和搜索可用，模型选择器可以打开。

未执行：Windows 验证、安装包打包与安装、Safe Mode 真机启动、自定义预设导出、超过 4 个模型时的搜索交互，以及市场插件在 0.2.0 下的兼容性（启动时多个已安装市场插件报告 peer 区间不含 0.2.0-rc.2 的兼容性警告，但未阻止启动）。

## 本 fork 集成记录（2026-10-12）

### 基线与取舍

从 `test@62e94a1` 的 Harness `0.1.5-rc.2` 出发，集成 `upstream/main@115a0b4`。本轮包含用户确认的底座与功能升级：Harness 0.2、Electron Node/macOS Helper、ASAR、Office Python、PPT 源码构建、Workbench、onboarding、插件 generation/恢复和 Repair Agent。

保留 fork 的 Windows 36px 独立标题栏、GitHub Releases 更新渠道、macOS ad-hoc 签名及 Windows 无证书更新配置。没有切换到上游的官方发布地址、publisherName 或 Apple 认证；没有推送、创建 PR、合并远端分支或发布安装包。

297 个 Harness/原生依赖分发包使用官方 npm 元数据的完整性校验并纳入 vendoring；新增平台原生包仍为 optional，不把其他平台二进制变成本平台必需依赖。旧版第三方分发包保留。仓库自有 PPT bundle/预览/清单从源码生成到 `.build`，不再重复跟踪旧构建产物，本地旧副本未删除。

### 兼容修复与审查

- 将 fork 补丁逐包迁移到新版真实 API，干净安装重放 35 个补丁；模型搜索交给 Harness 0.2 原生实现。恢复 OAuth 登录、服务商搜索、凭据可用性判断、Agent 预设传输及已读状态，补齐新版 primitives 与 settings.describe 接口适配。
- #99 的临时正文/权威消息分离、重试代次及原子交接保留，适配新版 snapshot store/publish 边界。不把工具成功回执当正文，不新增正文落盘，不修改工具提交协议。已复现并修复工具-only 完整消息和重试清空路径；未获得原现场的完整事件记录，不能认定它们是唯一现场原因。
- #96 保留分支成功后的打开/错误反馈，同时采用上游开放轮次分支能力。新增回归确认只收尾子会话，父会话事件不变。
- Windows 保留系统拖动区域；修复两侧栏加大缩放时会话操作区溢出，使用原生行换行和右对齐，不添加覆盖业务区的遮罩。固定菜单 IPC 限定到受信任菜单 frame，主题事件与 preload 对齐。
- 图片沙箱写入只保留 Windows SystemRoot/TEMP/TMP 与必要 Electron Node 模式，凭据、NODE_OPTIONS 和其余父环境仍清除；避免新版 ACL 锁落到不可写系统目录。
- PPT ZIP 导入规范化 Windows 路径，并拒绝规范化后重复条目。Windows 路径逃逸测试使用无需管理员权限的 directory junction，不跳过安全断言。
- 旧市场 fixture 独立于生产 node_modules，校验官方 tarball；新版市场保持 Profile-owned，避免旧版本遮蔽新基线。
- 发布 smoke 改为真实 Electron Node/ASAR 和临时 Profile，不再查找已移除的独立 node.exe，不删除现有 AppData，也不输出含启动 token 的完整日志。CI 新增原生 Windows/macOS 运行时与 Office/ASAR 打包门禁。

### 安全版本

Electron 44.0.0 已在本机通过 Harness 内部模块原生加载探测。选择的是 loader 明确支持且修复了本次审计告警的版本，没有绕过原生指纹检查（参见 [Electron 官方安全公告](https://github.com/electron/electron/security/advisories/GHSA-qmv3-fv6v-rmhq)）。MCP client 2.2.0、sharp 0.35.5、fflate 0.8.3、image-size 2.0.4 等依赖更新保持原业务测试通过。

`npm audit --omit=dev` 为 0 告警；完整审计仍有构建工具链的 11 项传递依赖告警（7 moderate、4 high），涉及 patch-package/braces 和 electron-builder/global-agent/sprintf-js。未用强制降级绕过；这不等于全依赖安全问题已经清零。linked PPT 的 image-size 锁定项另有回归，避免 npm 重算锁文件时恢复旧解析器。

### 本机验收与未验边界

- 全量测试：204 个文件，1798 用例通过、0 失败、7 平台限定跳过（JSON：`.build/integration-tests-complete.json`），包含安全锁定回归。
- `npm run typecheck`、`npm run build` 和干净 `npm ci` 成功。
- 真实 React 聊天视图 12 个场景/72 个交接阶段；Windows 标题栏 24 个实际几何/鼠标点击场景；Windows 退出诊断 6 个原生场景含 3 次系统结束/重启循环。
- Windows 开发目录包生成成功；afterPack 的 ASAR 解包、PPT 运行时和 Office 插件/技能/Python 依赖检查通过，实际生成 DOCX/PPTX/XLSX 并转换成 PDF。
- 源码和打包后的实际 Electron Harness 在临时 Profile 完成认证引导、bootstrap 执行与真实客户端挂载。截图输出 `.build/desktop-profile-smoke`，不会保存会话正文、凭据或完整工具回执。

本机是 Windows，尚未执行 macOS 真机/签名安装/自动更新验证；已加入原生 macOS CI 门禁，但不能把尚未运行的远端任务写成通过。Windows 验收为开发目录包，未覆盖 NSIS 安装升级；未调用真实外部模型/OAuth 账户或在线市场安装。正式发布须继续执行对应目标平台门禁。

### PR 验证补充（2026-10-13）

经用户授权创建面向 `test` 和 `main` 的 PR。首次 CI 复现了核心检查的 runner 错配：`npm test` 前置的 Office 准备不支持 Linux，而旧核心作业仍使用 Ubuntu。核心作业改在原生 Windows 上执行完整测试、类型检查和构建，保留 Windows/macOS 原生客户端与打包矩阵，并增加 YAML 配置回归。不通过跳过 Office、删除测试或放宽原生目标校验来处理该失败；最终远端通过状态以 PR 检查记录为准。

Windows 安装包作业还暴露了旧恢复 UI smoke 对已移除 `SafeModeOverlay` 的引用。恢复页面三档缩放的 120 个场景保留并通过，按钮验证改走实际 preload/IPC，而非覆写桥对象；125% 缩放的页脚断言仅容许已实测的单设备像素取整差，不容许实际布局溢出。真实 Harness smoke 使用完整生产 preload、桌面资源协议和 `SafeModeFrame`，覆盖侧栏保留、状态原位更新、过期代次拒绝、受信任 iframe 动作、非 iframe 消息拒绝、宿主重载与幂等关闭，源码和 Windows ASAR 包验证通过。新增脚本构建回归；补充后的本地全量为 205 个文件、1799 通过、7 个平台限定跳过、0 失败（`.build/pr-integration-tests.json`）。macOS CI 已通过原生目录包与 ad-hoc 安装包签名检查；补充 smoke 的最终远端状态仍以最新 PR 检查为准，不等同于真机自动更新已经验收。

随后 Windows 安装包作业的原生探针误报失败：PowerShell 直接调用 GUI 可执行文件后，`$LASTEXITCODE` 为未设置值，而非真实进程退出码。同一包的同一 `koffi`/`kernel32` PID 断言经 Node `spawnSync` 等待进程后退出码为 0。已将探针提取为参数数组调用、带 30 秒超时的独立脚本，严格拒绝非零或未知退出码，并保留启动/超时原始错误；不跳过原生调用。新增成功调用、未知/失败退出码及启动错误回归。本地真实包探针和 ASAR 内客户端再次通过，最终全量为 206 个文件、1802 通过、7 个平台限定跳过、0 失败（`.build/pr-integration-tests-final.json`），类型检查通过。最新提交的远端检查与合并结果仍以 PR 记录为准。
