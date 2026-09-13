# #70 侧栏新会话按钮验收

验收日期：2026-09-13。基于 test 分支 a684dc0，使用正在运行的本地开发 Harness 页面，通过 Chromium 浏览器检查；未验证 Windows 原生安装包。

## 最终修复

- 展开态 IconNewChatOutline16 从 14px 改为其原生 viewBox 尺寸 16px，折叠态保持 18px。
- 新会话按钮 SVG 设置 shape-rendering: geometricPrecision；该属性是渲染提示，不保证所有平台字体和抗锯齿效果相同。
- 保留对称 padding:8px 16px、38px 高度和 6px gap。撤掉之前未提交的 padding:8px 18px 8px 14px，因为实测它会造成整组左移 2px、左右留白分别 92px 和 96px。

图标与文字并排时，分别的中心不可能同时与按钮中心重合；验收针对整组内容和折叠态单图标的中心。

## 实际页面检查

在禁用浏览器资源缓存并刷新后，确认页面加载最终补丁，未使用临时 CSS 覆盖。

| 状态 | 测量结果 |
| --- | --- |
| 中文展开态，按钮宽 252px | 图文元素左右留白均为 94px，整组中心偏差 0px |
| 中文截图，1x 像素 | 按钮横向边界 [14,266)，可见深色内容边界 [108,172)，左右留白均为 94px；在按钮内容区域内以 RGB 最大通道小于 140 检测可见像素 |
| 英文展开态 | 左右留白 72.7265625px / 72.734375px，中心偏差 -0.00390625px |
| 折叠态 | 按钮 36×36px、图标 18px、padding 0、图标横向中心偏差 0px |
| 展开态尺寸 | 按钮高 38px、图标 16px、gap 6px |

已操作展开/折叠并检查过渡结束后的截图；按钮仍保留原生 button、aria-label 和点击处理器。

## 工程验证

- 全量 npm test：114 个文件、952 项测试通过。
- npm run typecheck、npm run build：通过。
- 最终撤掉不对称 padding 后，复跑 test/branding-patch.test.ts：5 项通过。
- 从仓库内原始 sidebar tgz 提取 client.js 并应用最终补丁成功，结果与实际安装的 client.js 逐字节一致。
- git diff --check：通过。
