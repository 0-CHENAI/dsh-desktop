# Harness 0.1.5-rc.1 官方 npm 产物

固定上游 [dsh-v0.1.5-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)，commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`。
截至 2026-09-10，npm `latest` 与 `next` 均指向此候选版本，尚无 `0.1.5` 正式版。

这些 tarball 来自已发布的 npm 包，不再使用本地源码构建。`provenance.json` 记录每个包的版本、下载地址和完整性值，下载时逐包校验 SRI；根 `package-lock.json` 固定相同文件的完整性。

- `npm-dsh/`：235 个 Harness 包，均固定 `0.1.5-rc.1`。
- `npm-vendor/`：8 个 Cordis / CosmoKit / Schemastery 包。
- 保留 Desktop 实际使用的公共 UI 包与运行时闭包；平台原生包由官方 `optionalDependencies` 按平台安装。
- 补丁独立放在根 `patches/`，`npm ci` 的 postinstall 负责应用。

升级说明和验证见 [harness-0.1.5-rc.1-upgrade.md](../../docs/harness-0.1.5-rc.1-upgrade.md)。
