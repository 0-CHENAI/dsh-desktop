# Harness 0.1.5-rc.2 升级

从 `0.1.5-rc.1` 升级至上游 [`dsh-v0.1.5-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2)。桌面应用自身的版本号与 Harness 后端版本独立。上一版说明见 [harness-0.1.5-rc.1-upgrade.md](./harness-0.1.5-rc.1-upgrade.md)。

## 依赖

继续使用官方 npm tarball（`packages/harness-0.1.5-rc.2/`），不改为 registry 精确 pin。根依赖、锁文件、Desktop 插件 peer 范围和 PPT 包同步到 rc.2。`@deepseek-ai/dsh-typert-generator` 仍为 `0.1.5-rc.1`，因上游未发布 rc.2。每个包的来源与完整性记录在 `packages/harness-0.1.5-rc.2/provenance.json`。

27 个 Desktop 补丁文件名与内容已迁到 rc.2。相对 rc.1 另吸收：

- pi-ai 请求带上 `x-deepseek-harness-session-id`（#329）
- 流式结束时从已完成 block 补回缺失的 terminal content（#400）
- `client-modules` 的 newline / source-map / combo memo 启动加速（对照上游 V0.9.0，保留 fork 的 resolution fallback）

## Desktop 适配

- 市场 baseline 只把指向 `.generations` 的 symlink 当成代际链接；pnpm isolated-store 的 `.pnpm` 链接不再触发 Safe Mode 循环。
- 启动时钟前移到 splash / Profile 维护之前；login-shell 环境异步预热；首个健康探测即视为就绪。
- 项目级 `.npmrc` 固定 `legacy-peer-deps=true`，避免 Windows npm 10 在 optional peer 范围不匹配时失败 `npm ci`。
- 不接入上游 crash 服务的 5% 灰度配置；更新渠道仍走本 fork 的 GitHub Releases。
- 不引入首次启动导入本机 Web `~/.dsh` 的 UI。

## 验证

`npm ci` 验证 tarball 完整性及补丁应用。自动测试覆盖会话删除、pi-ai session header、terminal content 恢复、client-modules combo 性能补丁、市场 symlink 判定、`runCli` 入口契约。
