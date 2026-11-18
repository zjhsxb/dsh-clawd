# dsh-clawd 🦀 Clawd娘

> 一只住进 DeepSeek Harness 的橙色像素螃蟹娘 —— 送给所有想和 Claude 说"我们很好，不必羡慕"的开发者。

**dsh-clawd** 是 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的桌宠插件：一只以 Claude 吉祥物小螃蟹 **Clawd** 为原型的像素风螃蟹娘，在你的工作区里自由漫游、观察你的会话状态、用气泡说些应景的碎碎念。搭配 [dsh-claude-style](https://github.com/Nwflower/dsh-claude-style) 主题使用，即可获得完整的"仿 Claude"体验。

| | |
|---|---|
| 原型 | Clawd（Anthropic 旗下 Claude Code 的像素风橙色小螃蟹吉祥物） |
| 形态 | 24×24 程序化像素精灵（代码即美术，无任何二进制素材依赖） |
| 技术栈 | 宿主侧 Cordis 插件 + 浏览器侧 React 像素渲染引擎 |

## ✨ 功能

- 🦀 **自由漫游**：重力、弹跳、沿底部来回横走，可拖拽、甩飞（松手带初速度），单击逗它、双击查看余额与用量
- 💬 **会话感知**：实时折叠 DSH 的会话事件流，映射为宠物情绪：
  | 会话状态 | 宠物表现 |
  |---|---|
  | thinking（回合开始/思考） | 🤔 托腮思考 |
  | working（工具调用中） | 🔧 举钳干活 + 火花 |
  | waiting（等待批准/问询） | 💬 冒泡提醒"在等你" |
  | result（工具返回/goal 续跑中轮） | 📖 认真核对 |
  | success（回合完成） | 🎉 跳起举钳 + 彩带 |
  | error（出错/被中止） | 💢 怒眉 + 汗 + 泪 |
- 😴 **自动睡觉**：5 分钟没动静就原地睡着（闭眼 + Z 粒子 + 口水），点击唤醒
- 🗨️ **气泡碎碎念**：空闲/工作/成功/失败各有台词，中文优先，部分玩梗（token、封号、摸鱼）
- ⚙️ **右键菜单**：说句话 / 吃 token / 余额・用量 / 睡觉 / 大小 ×1.5〜×5 / 回到底部 / 藏起来（右下角星芒按钮召回）
- 🧾 **小账本（双击）**：显示 DeepSeek 账户余额（充值 + 赠送，¥/$）+ 本会话 token 用量折算的费用；余额 30s 刷新，账本打开时随快照实时更新
- 💾 **状态记忆**：位置、大小、隐藏状态通过 localStorage 持久化，刷新不丢
- 🕹️ **仅前端渲染**：纯 canvas 像素渲染（`image-rendering: pixelated`），宿主提供 `/dsh-clawd-7788/state` 状态端点（含余额与用量快照）
- 🔒 **本机访问限制**：状态端点只接受 `localhost` / `127.0.0.1` / `[::1]` 的请求（拒绝跨站 Origin 与伪造 Host），浏览器里打开的任意网页无法读取你的余额数据；如需局域网访问请自行放宽 `index.js` 中的校验

## 📦 安装

在 DSH 中通过插件市场安装，或手动安装本包：

```bash
# 从 npm 安装（发布后可用）
dsh plugin install dsh-clawd
# 或从 GitHub 安装
dsh plugin --profile web add github:zjhsxb/dsh-clawd
# 开发模式：直接指向包目录
dsh plugin install <path-to-dsh-clawd>
```

安装后无需配置，宠物会立即出现在界面上（默认 3× 大小，可在右键菜单调整），可拖到任何位置。

## 🛠️ 开发

```bash
# 重新生成精灵接触表 preview.png 与插件图标 icon.svg（纯 node，无依赖）
node scripts/preview.mjs

# 以文本形式检查某个状态的每一帧（'.' = 透明）
node scripts/ascii-dump.cjs idle,walk,success
```

精灵数据全部以字符网格（`@sprite-base` / `@sprite-spec` / `@sprite-compile` 标记块）写在 `client.js` 里：
- 调色板：`o` 轮廓 #3D2A20、`D` 深橙 #B95E3B、`O` 主体橙 #D97757、`C` 奶油 #F5F0E8、`w` 白、`r` 腮红 #E8847A、`y` 星芒黄 #F0B65A、`b` 深棕 #2B1B12
- 帧编辑：`M([col, str], ...)` 按列覆盖（`.` 保留底图、` ` 挖空），`dy` 整体位移

## 📜 许可证与声明

- 本插件代码以 [MIT](./LICENSE) 开源。
- **Clawd 是 Anthropic 的角色形象。本插件是非官方爱好者作品，与 Anthropic 没有关联。**
- 本项目的会话状态折叠思路（`work-status` / `session-watch` / `http-route`）参考了开源项目 **[dsh-pet](https://github.com/PC2005-cloud/dsh-pet)**（MIT License），特此致谢。原作者地址：<https://github.com/PC2005-cloud/dsh-pet>
- 像素精灵与图标为**原创程序化生成**（由本项目 `scripts/preview.mjs` 从字符网格渲染），无第三方素材。

---

*Clawd娘说：这里没有封号，只有 token。🍊*
