# v0.14.0 独立迁移记录

本次迁移在 `codex/migrate-upstream-v0.14.0` 中完成实现及下文列明的本机验证。代码提交、PR、合并和安装包发布分别确认，不以本机验证代替后续阶段。用户原工作区和真实 Profile 未参与测试。

## 基线与范围

| 项目 | 基线 |
| --- | --- |
| 本分支 | `origin/main`，`588412b9002fcb3ac88751fab7915e050c965563` |
| 父仓库 | `dataelement/dsh-desktop`，v0.14.0，`bbc7494aa9ed1cda0b89888264d7ee74a26ec50e` |
| 共同祖先 | v0.12.0，`bc732f5dc4c5465915d5b3f28d9b0b32703fc664` |
| Harness | `0.2.2-rc.1` |
| Electron | `44.7.0` |
| pi-ai / LibreOffice kit | `1.3.0` / `0.1.5` |

使用最新 main 是为了带上 test 尚未包含的窗口空白和压缩修复。本分支产品版本仍为 `0.2.0`；上游版本号仅标记迁移基线，未创建 v0.14.0 发布。

引入上游新的 Desktop Host/客户端启动链路、Profile 复制迁移、插件安装及修复、Office 模板与工作台功能、原生快捷键与菜单、渲染故障恢复和打包闭包。50 份兼容补丁按新依赖重新生成，保留本分支的上下文硬预算、推理参数继承、流式正文交接、自定义认证、错误提示和会话分支行为。

以下产品决策继续由本分支维护：

- 更新源使用 `0-CHENAI/dsh-desktop` 的 GitHub Releases；下载须用户同意，可跳过版本。历史版本和回滚仍受版本校验与安装记录约束。
- macOS 保持 ad-hoc 签名，不引入 Apple 认证、公证或强制更新服务。Windows 保留本分支 UKey 流程；main 开发包仍走原有未签名发布路径。
- 未启用父仓库的飞书发布审批、发布 dispatch 模式或自动关闭 issue 机器人。机器人源文件保留，但仅父仓库身份可运行。
- 不导入上游临时目录中的个人路径脚本，不改用户的代理配置、模型请求协议或真实会话记录。

## 启动及解析边界

正式主进程为 `src/main/shell/app.ts`，Host 为 `src/host/index.ts`，preload 为 `src/preload/app.ts`。旧入口相关的字符串检查改为新入口检查；已经移除的 UtilityProcess/旧 Node loader 测试由真实 Host 子进程行为覆盖，不把旧入口导入成功当作新启动链路成功。

| 阶段 | 本次接入与失败行为 |
| --- | --- |
| Profile 组合 | 从 `profiles/web` 复制到 `profiles/desktop`，保留原目录；既有 desktop 不覆盖，失败清理本次 partial，保留原配置和 generation。 |
| 后端加载 | 普通插件先按自身路径解析。仅缺少 `@deepseek-ai/*` 且错误为 `ERR_MODULE_NOT_FOUND` 时，从当前安装 anchor 补齐；不覆盖普通依赖、exports 拒绝或插件自带 peer。失败保留最内层 cause。 |
| Host 生命周期 | `userData/launch-root` 是中立 cwd；并发 start 共享一次启动。Windows 超时停止只终止本进程拥有的 Host 进程树。Safe Mode 使用显式宿主 anchor，不依赖普通 Profile fallback。 |
| 客户端发现与 HTML | 使用本版本的 Host injections、认证 cookie、模块图及官方 bootstrap 顺序。未就绪请求返回 503，cookie 不交给页面。 |
| 客户端激活 | 真实 Electron 加载认证后的应用页，确认模块系统、侧栏、会话及 Office UI 挂载，而非只检查 HTML/脚本返回 200。 |

`test/host/host-process.test.ts`、宿主 peer/普通依赖/exports 边界测试及真实 linked/junction 插件场景验证这些路径。Safe Mode 另有无共享 Profile 依赖的启动与前端激活检查。

## 审查中修正的兼容缺陷

- 流式草稿组件仍调用已被上游删除的图片函数；改用新附件/图片属性，保持正文快照与权威消息分离。
- 模型设置残留旧变量、自定义认证未挂载、图片提示被容器裁剪；恢复认证注册并将提示放入 portal，补实际 React 悬停和卸载回归。
- 会话分支缺少 parent 元数据；恢复既有契约，并与上游子代理归属机制组合验证。
- Windows 关闭会话后的正常退出识别和异步插件故障报告失去代次保护；恢复已确认退出事件，并阻止旧启动报告覆盖新状态。
- 更新下载过程中重复重建弹窗、安装失败后 Host 未恢复、缓存下载完成事件越权触发安装；保留进度 DOM、精确版本同意状态和恢复入口，补异步失败/重复通知/回滚回归。
- 固定 CSS 标题栏高度在页面缩放后与 Windows 原生按钮高度不一致；使用实际 `titlebar-area-height`，补全屏状态与初始化竞态处理。宽侧栏按钮仍在品牌行，折叠后保留可点击的重新展开入口。
- 应用静态资源仅按字面路径检查，可能经目录 junction 逃逸；读取前验证实际路径并读取已验证目标，补真实 Windows junction 回归。
- 字体许可文本被 CRLF 转换破坏校验；固定输入字节，不绕过许可检查。合并重复 loader 生成入口。
- 版本历史发布不能在读取失败时重建并覆盖旧历史；使用可失败的追加实现，并让发布/回填共享并发锁。

## 测试契约迁移

旧测试中固定的入口路径、工具执行器、认证 metadata、菜单视图和新版本参数已切换到实际入口与已安装 bundle。测试断言仍要求正文不无提示消失、安装不接受错误版本、用户数据可恢复及失败有明确出口。

Windows 目录逃逸与软链接插件用真实 junction 验证。只有操作系统明确返回 `EPERM` 的文件/相对目录 symlink fixture 才跳过，未屏蔽整个 Windows 测试集。普通 Profile 复制与原数据保留的用例独立运行，不因文件 symlink 权限不足而跳过。相对链接重写和错误传播另有可执行的 Windows 文件系统模型测试。

原父仓库发布测试中的 Apple 认证、飞书审批和额外发布模式未作为本分支契约启用；改为断言本分支的原生构建依赖、签名依赖、不可覆盖发布标签和 GitHub 更新源。Mac Intel 打包命令保留，但当前发布 workflow 沿用本分支的 Apple Silicon + Windows 两平台门禁，不声称执行了 Intel 发布任务。

## 验证结果与边界

2026-11-16 本机执行结果：

| 检查 | 结果 |
| --- | --- |
| 干净 `npm ci` | 通过；postinstall 重放 50 份补丁，品牌资源和 Electron 安装步骤成功 |
| `npm test -- --maxWorkers=2` | 提交前完整回归覆盖最新窗口与侧栏改动：389 个测试文件；381 通过、8 跳过；3,568 项成功、0 失败、31 跳过 |
| `npm run typecheck` | 通过；覆盖范围仍为仓库定义的 TS 代码与测试，不冒称覆盖插件 JS 或 HTML |
| `npm run build` | 通过；测试结束后串行重新构建 |
| Windows Dev 目录打包 | 通过；先执行 verify-target，再运行 electron-builder，明确 `--publish never` |
| 打包资源与真实客户端 | 通过；原生绑定、Host、bootstrap、终端与依赖清单；实际包内 preload、前端资源与物理插件解析均验证 |
| 关键打包输入一致性 | 7 项逐字节一致：主进程、Host、preload、插件状态写入、聊天、模型设置与上下文压缩 bundle |
| `node scripts/verify/verify-target.mjs win32 x64` | 通过；Electron 44.7.0 原生加载器可用 |
| `git diff HEAD --check` | 通过 |

跳过项包含非当前平台的原生测试、需要显式环境开关的原生恢复/安装流程，以及 7 个 Windows 缺少 symlink 权限的用例。目录 junction、普通 Profile 复制、相对链接映射模型、持久锁失败和错误传播的相关用例仍执行。此前失败记录留在本地验证日志中；最终回归是在文件占用修复后完成，未通过禁用测试取得成功。

关键变更的行为回归如下，安装包检查与这些测试分开执行：

| 范围 | 测试文件 |
| --- | --- |
| 上下文硬预算、推理参数和正文交接 | `test/context-compaction.test.mjs`、`test/chat-handoff.test.ts` |
| 模型认证与图片提示 | `test/provider-authorization.test.mjs`、`test/model-modality-tooltip.test.mjs` |
| 普通 Profile、物理插件路径和进程生命周期 | `test/host/plugin-resolution.test.ts`、`test/host/host-process.test.ts` |
| Profile 复制与用户状态 | `test/profile/profile-rename.test.ts`、`test/plugin-state-patch-preservation.test.ts`、`test/plugin-disable.test.ts` |
| 更新失败恢复 | `test/update-manager.test.ts`、`test/application-rollback-manager.test.ts` |
| 资源目录及跨盘符边界 | `test/shell/web-document.test.ts`、`test/shell/web-document-drive-boundary.test.ts` |
| 窗口与键盘状态 | `test/window-fullscreen.test.ts`、`test/escape-dismiss-focus-runtime.test.ts`、`test/windows-menu-bar.test.ts` |
| 客户端服务与样式生命周期 | `test/desktop-boot-payload.test.mjs`、`test/desktop-client-ui.test.ts`、`test/desktop-client-locales.test.mjs` |
| Office 资源目录发布 | `test/office-runtime-publication.test.mjs` |

Windows 回归还观测到一次 `state.json` 原子替换的 `EPERM`。现在只对 Windows 的 `EPERM` / `EBUSY` / `EACCES` 重试同一次 rename，最多 5 次、总等待 375 毫秒；不删除旧状态或改动权限。注入临时锁和持续拒绝的用例分别验证恢复、次数上限、原始错误、旧状态和临时文件清理。此证据不能归因于某一种杀毒软件，也不代表已测得现场发生频率。

Office 资源目录在串行准备时也复现了同类 rename 失败。构建工具的发布步骤单独封装为 `scripts/office-runtime/publish-runtime.mjs`：Windows 最多尝试 7 次，累计等待上限 3.15 秒；其他错误立即抛出。测试覆盖临时占用后完成发布、持续失败保留原错误与目录内容、不重试非 Windows 或磁盘空间错误。没有跳过哈希校验或使用旧构建资源冒充成功。

以下已执行的界面回归独立于模拟 DOM 测试：

- 真实 React 聊天视图：12 个场景、72 个阶段，覆盖紧凑/普通模式、展开状态和三个缩放级别。
- 真实 Windows Electron/Harness：认证、bootstrap、模块系统和实际 UI 挂载成功；Word/Excel 模板目录、图片预览和弹窗关闭通过。
- Windows 窗口矩阵：24 种真实布局，覆盖两种宽度、三个缩放级别、宽/折叠侧栏、全屏切换及右侧栏原生点击。标题栏只留一行，窗口按钮不侵入内容。
- 真实 preload 的更新卡片、手动检查、Escape 关闭及 Safe Mode 原位更新、旧更新拒绝、重新加载与重复关闭通过。
- 最终目录包：在物理位置的本地插件通过 Windows junction 加载，保留插件自身普通依赖，缺少的 Harness peer 确认来自本次安装目录。使用包内真实 Host、preload 和前端资源完成上述 24 种窗口矩阵及客户端流程。
- 打包闭包检查覆盖 731 份依赖 manifest；Office 编写、结构检查以及 DOCX/PPTX/XLSX 转 PDF 通过。
- 恢复页面：三个显示比例各 40 种变体通过；已保留 renderer 截图。可选的操作系统窗口缩略图捕获失败，未把它记为成功。

客户端测试结束时，关闭临时窗口并停止临时 Host 会产生待处理请求的 socket-close 日志；业务断言和进程退出结果通过。该清理阶段日志未隐藏，也未据此推断真实会话运行故障已复现。

尚不能由本机证明：macOS 原生权限、签名/公证判断、安装与自动更新；Windows 签名安装器的真实升级与回滚；真实用户 Profile 的全部第三方插件组合；真实模型线路及现场会话复现。上述项目不以类型检查、测试通过或开发包构建代替，也未因此清理用户数据。

### 资源目录边界

`serveWebDocument` 现在同时校验逻辑路径和 realpath，并从校验后的实际文件读取。Windows `path.relative()` 在跨盘符时返回绝对路径；此类结果也明确拒绝，防止跨盘符 junction 绕过目录边界。`test/shell/web-document.test.ts` 验证实际 junction 内外目录，`test/shell/web-document-drive-boundary.test.ts` 验证跨盘符边界：修复前得到 200，修复后得到 404 且不调用文件读取。

### Windows 标题栏与菜单整合

参考用户提供的 macOS 布局，顶部单独放菜单与侧栏开关，品牌和新会话移至下一层；保留 Windows 原生窗口按钮。侧栏与会话区均从窗口顶部开始，右侧会话标题与原生标题栏共用一行，取消横跨工作区的额外空带。关闭右侧栏时会话标题预留窗口按钮空间，打开右侧栏时由右侧栏自身避让；收起侧栏和全屏模式分别保留所需前导空间。

原生菜单保留应用、编辑两组命令，编辑器焦点、选区、快捷键、弹窗失败恢复和重复挂载语义不变。底部设置区仍贴底，独立恢复页继续使用自己的标题栏。布局 patch 仅提供稳定标记，样式在原生窗口 preload，不移动 React 节点或 slot 贡献项，不改用户配置与会话；上游提供等价独立布局配置后可移除这些宿主覆盖。

相关七个回归文件共 38 项通过。真实 Windows/Harness 的 24 种布局覆盖三档缩放、两种宽度、侧栏展开/收起和全屏，验证菜单、侧栏及右侧栏按钮原生点击；补充深浅主题验收。类型检查与 Electron 构建通过。受影响布局包已在隔离目录完成全新 npm ci 和 postinstall 重放，产物与测试 bundle 一致，本轮不再改变该补丁。开发预览使用独立 Profile；未重新构建正式安装器，也未验证本次 Windows 样式在 macOS 上的原生效果。

### Windows 收起后的点击与右侧面板遮挡回归

原先标题栏验证使用 `webContents.sendInputEvent`，能检查页面命中与状态变化，但不能覆盖 Windows 系统拖动区的鼠标拦截。实际窗口复现了收起后左上按钮无法展开：控制来自零宽侧栏列，单独的按钮 no-drag 样式不足以保证原生点击区。修复在会话标题栏实际预留完整的前导 no-drag 区域，避免只有视觉留白，同时保留 slot 贡献项的交互与原有内容起始位置。

右侧面板本身绝对定位于 AppFrame，外层列的 padding 不会改变其顶部位置。新增回归在修改前捕获 `panelTop: 0`，面板按钮侵入原生窗口控制区；修复将标题栏偏移直接加到 `data-sidebar-right-panel`，覆盖 push 和面板全屏形态，应用全屏时偏移归零。

38 项相关回归、类型检查与 Electron 构建通过。24 种真实 Harness 窗口布局新增前导 no-drag 区边界、面板自身与两枚操作按钮的原生高度避让断言，深浅主题及插件页收起状态的新会话导航通过。更新后的开发预览另用系统鼠标验证了侧栏收起再展开、插件页返回新会话、右侧面板独立收起，并观察到面板按钮与系统窗口按钮分离。没有将页面内模拟输入等同于系统级点击验收；正式安装器仍需重建和安装验证。

### 侧栏手机连接入口移除

按二开版本的界面需求移除侧栏底部手机连接按钮，保留维修入口。同步移除该组件对手机状态的首次读取、订阅及相关 SVG 分支，避免按钮删除后继续发出无用请求；只有维修能力可用时才注册该操作组，手机桥不再单独产生空组。此次范围为侧栏入口，未改动手机桥、配对页及原生菜单协议。

`test/repair-draft-ui.test.ts` 与 `test/desktop-client-locales.test.mjs` 共 14 项通过，覆盖展开/收起时不显示手机入口、不读取或订阅手机状态、维修入口交互、多语言诊断与卸载后的异步结果。真实 Electron/Harness 启动断言手机入口数量为 0、维修入口为 1，通过；语法检查、类型检查与差异检查通过。正式安装器未为本次界面变化重建。

### 依赖安全审计

2026-11-16 的 `npm audit --omit=dev` 报告 87 个受影响依赖节点（79 high、8 moderate、0 critical），涉及 MCP client、fast-uri、fflate、image-size、source-map-js、undici 和 zod 七个根依赖。该计数包含向上游 Harness 包传播的告警，不代表 87 条独立漏洞，也没有据此断言当前调用路径均可利用。

本次保持 v0.14.0 对应的 Harness 依赖闭包。部分修复需要改动上游精确锁定的依赖，不能用 `npm audit fix --force` 或整体跳过告警替代兼容性验证。这些项目仍待单独升级与验证，迁移测试通过不代表依赖安全审计通过，也不作为直接发布依据。

## 后续集成

本轮按用户指示通过同一迁移分支分别向 test、main 提交中文 PR，先提交 test。两个目标分支存在少量合并历史差异；test 的独有历史没有额外代码内容，集成时保留该历史并核对代码树。本轮交付范围是提交与 PR，合并和发布另按用户指示执行。
