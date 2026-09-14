# Harness 0.1.5-rc.2 官方 npm 产物

固定上游 [`dsh-v0.1.5-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2)。这是 0.1.5 系列候选版，非正式版。

这些 tarball 来自已发布的 npm 包。`provenance.json` 记录每个包的版本、下载地址和完整性值，下载时逐包校验 SRI；根 `package-lock.json` 固定相同文件的完整性。

- `npm-dsh/`：Harness 包，除 `@deepseek-ai/dsh-typert-generator` 仍为 `0.1.5-rc.1`（registry 未发 rc.2）外均固定 `0.1.5-rc.2`。
- `npm-vendor/`：8 个 Cordis / CosmoKit / Schemastery 包。
- 补丁独立放在根 `patches/`，`npm ci` 的 postinstall 负责应用。

升级说明见 [harness-0.1.5-rc.2-upgrade.md](../../docs/harness-0.1.5-rc.2-upgrade.md)。
