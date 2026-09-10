# Harness 0.1.5-rc.1 升级

从 `0.1.2-rc.1` 升级至上游 [`dsh-v0.1.5-rc.1`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)，commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`。这是 0.1.5 系列候选版，非正式版。桌面应用自身的版本号与 Harness 后端版本独立。

## 依赖

替换旧本地构建产物为官方 npm tarball，并更新根依赖、锁文件、Desktop 插件 peer 范围和 PPT 包。新增会话格式迁移、文件上传、右侧文件预览、系统应用打开和 HTTP 代理等实际运行时依赖。保留 PPT 使用的公共 UI 包，不加入可选 Agent Teams 等 bundle。每个包的来源与完整性记录在 `packages/harness-0.1.5-rc.1/provenance.json`。

## Desktop 适配

- 启动入口调用新版导出的 `runCli()`；使用 `--profile web --patch ...`，兼容新版 CLI 对 `web` 快捷命令的参数限制。
- 迁移全部现有 Desktop 补丁，保留模型设置、模式搜索、预设导入导出、会话删除、未读标记、文件路径和 PPT 布局。CSS 以新版模块作用域为准，叠加原有定制差异。
- 新版持久化改为 `SessionHandle`。删除操作在同进程写所有权和跨进程文件锁下执行，删除该会话的全部日志代际，保留工作区文件和锁目录，避免旧代际使会话重新出现。
- `client-connection` 恢复调用插件的上下文，仅在注册 HTTP 路由时按需注入 `webServer`；连接服务可在无 Web 宿主下启动，RPC/Fetch 注册随调用插件卸载释放，支持重新挂载。真实 `/dsh-ppt/state` 测试覆盖鉴权与路由挂载。
- PPT 替换事件迁移为 `startSeq` / `endSeq`，保留开关、重启恢复与旧快照清理语义。
- 兼容现有 Persona 的 `text` 和全局系统提示词的 `persona` 字段，分别回退到新版 `prefix` / `personaPrefix`；显式新字段优先，不修改用户文件。
- 继续保留插件代际更新兼容、第三方设置卡片修复、安全模式和 main 自动发布配置。

## 验证

`npm ci` 验证官方 tarball 完整性及 25 个补丁。最终本机结果：102 个测试文件、822 项测试全部通过；`npm run typecheck` 与 `npm run build` 通过。自动测试包含完整 Desktop Profile 冷启动、PPT RPC 未认证拒绝和认证后调用、安全模式故障注入、SessionHandle 删除及锁冲突、Persona 旧配置、PPT 开关和插件更新兼容。

本机另使用内置 Node 24.9.0 验证 Harness 启动、令牌换 Cookie、会话列表 API；浏览器检查界面和模式菜单。Windows 安装包运行和真实模型推理仍需对应环境验收。
