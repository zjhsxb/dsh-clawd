# dsh-clawd 市场宣传图

本目录存放 zjhsxb/dsh-clawd 插件市场展示图。全部图片由真实精灵帧程序化渲染合成：
`scripts/render-market-frames.mjs` 从 `client.js` 的精灵定义提取 11 种状态的像素帧并放大为透明 PNG，
`scripts/compose-market.ps1` 用 GDI+ 合成排版。角色与项目运行时渲染的像素螃蟹完全一致。

## 文件说明

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `01-cover.png` | 1600 × 900 | 产品主视觉封面，用于市场/仓库头部。深色桌面背景 + 真实精灵 + 主标语 + 三大功能 chips |
| `02-ai-status.png` | 1200 × 900 | AI 状态感知展示。真实状态动画帧网格（idle/thinking/working/success/error/sleep 等）配中文标注 |
| `03-token-ledger.png` | 1200 × 900 | Token 账本展示。真实气泡样式与两行账本文案（余额/会话费用）、分段计价示意，**数据均为示意并已标注** |
| `04-interaction.png` | 1200 × 900 | 趣味互动展示。漫游、拖拽甩飞、右键菜单（真实 7 项）、双击账本与隐藏召回四场景 |
| `preview.png` | 1440 × 1180 | 四张图整体预览 |

## 数据真实性声明

- 03-token-ledger.png 中的余额、Token 数量与费用**均为示意数据**（图中带「示意数据」角标），
  不代表真实账户数据；文案格式（`余额：…` / `会话：约 ¥…（估）`）与真实实现一致。
- 所有精灵帧取自项目真实 `@sprite-base/@sprite-spec` 定义，未重新设计角色。
- 右键菜单 7 个条目与插件实际菜单一致。

## 重新生成

```powershell
node scripts/render-market-frames.mjs
powershell -File scripts/compose-market.ps1   # 或直接 & scripts\compose-market.ps1
```

生成中间产物位于 `docs/market/.build/`，发布前可删除。

## 更新记录

- 2026-11-20：初版四图 + preview.png（v0.1.2 代码基线）。
