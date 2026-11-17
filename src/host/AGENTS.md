# Host 入口约束

继承根目录规则。这个目录是 Harness 子进程入口，不是 Electron 主进程。

- 不得导入 `electron`、`src/main` 或 `src/preload`。
- `DSH_HOME` 只使用父进程传入的环境变量。不调用会落到 `~/.dsh` 的默认解析。
- 对版本敏感的上游调用集中到 `upstream-api.ts`。插件操作事件的订阅和卸载、会话文件地址的解析在这个文件。
- 启动失败通过 IPC 的 `fatal` 带回消息和诊断，不在这里弹窗。
- 普通 Profile 沿用 fork 的窄宿主 peer fallback：先走插件自身的正常 Node 解析，仅对 `@deepseek-ai/*` 的 `ERR_MODULE_NOT_FOUND` 使用当前安装目录 anchor；不覆盖普通依赖或 exports 拒绝。最内层失败及父模块保留，Host 停止时注销 hook。Safe Mode 不注册此 fallback，仍由上游安装锚点解析核心包，不创建 `profiles/node_modules`。
- 安装包里的文档预览在 `runProfile` 之前调用 `registerOfficeEngineResolution`，把 LibreOffice 引擎解析到 `app.asar.unpacked`。传入路径要有 `dsh/lib/bin.js` 这一层深度，这个文件本身不执行。开发目录里这次注册没有效果。不要改到插件加载之后。
