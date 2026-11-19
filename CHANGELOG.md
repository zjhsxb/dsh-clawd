# 更新日志

## [0.1.1] - 2026-11-19

### 可靠性（P0）

- **Token 统计**：同 `turn:step` 事件改为替换语义（与 DSH token-meter 一致），不再重复累计流式更新；新增跨重启水位线（`lastTurn/lastStep` 落盘），插件重载后重放历史事件不会重复计费；非法/异常数值（负数、NaN、超大值）一律忽略。
- **费用估算**：价格表更新为 DeepSeek 官方 2026-05-31 永久价（deepseek-flash / deepseek-v4-pro / deepseek-chat / deepseek-reasoner），区分北京时间高峰/空闲时段（周一至五 9-12、14-18）；思考 token 不再重复计费（已含在输出中）；未知模型显示"价格未知"；会话费用标注"约 ¥x.xx（估）"。
- **持久化**：`usage.json` / `balance.json` 改为临时文件 + 原子替换写入；损坏文件自动备份为 `.bak-<时间戳>` 后从零开始；余额缓存带版本字段。
- **本机接口**：`/dsh-clawd-7788` 仅接受 GET/HEAD（其余 405），新增滑动窗口限流（60s 内 120 次，超出 429）；仅回环地址/同源请求可访问（原有 Origin/Host 校验保留）。

### 性能（P1）

- 精灵渲染改为**帧缓存**：每个 状态×帧×朝向 只画一次 576 像素，之后全部 `drawImage`。
- 主循环 DOM 写入去重：宽高/transform/阴影仅在变化时写入。
- 后台标签页轮询从 1.5s 自动降到 60s，回到前台立即恢复。

### 状态机（P1）

- 新增 stall 看门狗：`waiting/working/thinking/result` 状态 5 分钟无新事件自动清除回空闲，避免回合卡死时宠物表情永久卡住。

### 工程（P1）

- 新增 `tests/`（19 个测试，node:test，零依赖）：宿主 Token 累计/替换/水位线/异常值/损坏恢复、HTTP 安全（403/405/429/404）、费用估算（价格表/高峰时段/未知模型）、精灵网格完整性。
- 新增 GitHub Actions CI（`.github/workflows/ci.yml`）：语法检查、单元测试、精灵素材同步校验、打包干跑。

### 文档（P2）

- 新增 CHANGELOG.md、FAQ.md、.github/ISSUE_TEMPLATE 反馈模板。

## [0.1.0] - 2026-11-15

- 初始发布：橙色像素螃蟹娘 Clawd 桌宠（24×24 像素精灵、物理漫游、拖拽甩飞、双击账本、右键菜单）。
- 状态事件折叠：thinking/working/result/waiting/success/error 六态映射宠物表情。
- 双击显示 DeepSeek 余额与会话用量（气泡形式）。
- 会话用量/余额本地持久化（跨重启连续累计）。
- 收录进 awesome-dsh-plugin 市场目录（PR #15980）。
