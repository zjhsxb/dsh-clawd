# scripts/compose-market.ps1 —— 用 GDI+ 合成 dsh-clawd 插件市场宣传图（需先运行 render-market-frames.mjs）
# 输出: docs/market/01-cover.png / 02-ai-status.png / 03-token-ledger.png / 04-interaction.png / preview.png
# 所有文字为中文需 UTF-8 BOM（本文件由构建流程保证 BOM）

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$frames = Join-Path $root 'docs\market\.build\frames'
$outDir = Join-Path $root 'docs\market'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# ---------- 调色板 ----------
function C([string]$hex) { return [System.Drawing.ColorTranslator]::FromHtml($hex) }
function CA([int]$a, [string]$hex) { $c = C $hex; return [System.Drawing.Color]::FromArgb($a, $c.R, $c.G, $c.B) }

$NAVY1 = C '#0C1626'; $NAVY2 = C '#1D3350'
$CARD  = C '#152338'; $CARD_BORDER = C '#2C4764'
$CREAM = C '#F5F0E8'; $ORANGE = C '#D97757'; $DEEP = C '#B95E3B'; $OUTLINE = C '#3D2A20'
$YELLOW = C '#F0B65A'; $BLUSH = C '#E8847A'
$MUTED = C '#8FA6BE'; $CODE = C '#A9BED6'; $GREEN = C '#7FD98A'

$YAHEI = 'Microsoft YaHei'; $MONO = 'Consolas'

# ---------- 通用绘图 ----------
function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  return @($bmp, $g)
}

function Paint-Bg($g, [int]$w, [int]$h) {
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $NAVY1, $NAVY2, 90.0)
  $g.FillRectangle($brush, $rect)
  $brush.Dispose()
  $dot = New-Object System.Drawing.SolidBrush((CA 16 '#5B7BA3'))
  for ($gy = 24; $gy -lt $h; $gy += 48) {
    for ($gx = 24; $gx -lt $w; $gx += 48) { $g.FillRectangle($dot, $gx, $gy, 2, 2) }
  }
  $dot.Dispose()
}

function New-RRPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Fill-RR($g, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r, $color) {
  $p = New-RRPath $x $y $w $h $r
  $b = New-Object System.Drawing.SolidBrush($color)
  $g.FillPath($b, $p)
  $b.Dispose(); $p.Dispose()
}

function Draw-RR($g, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r, $color, [float]$penW) {
  $p = New-RRPath $x $y $w $h $r
  $pen = New-Object System.Drawing.Pen($color, $penW)
  $g.DrawPath($pen, $p)
  $pen.Dispose(); $p.Dispose()
}

function Draw-Text($g, [string]$text, [string]$family, [float]$size, $color, [float]$x, [float]$y, [float]$w, [float]$h, [string]$align = 'center', [string]$valign = 'middle', [bool]$bold = $false) {
  $style = [System.Drawing.FontStyle]::Regular
  if ($bold) { $style = [System.Drawing.FontStyle]::Bold }
  $font = New-Object System.Drawing.Font($family, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  switch ($align) {
    'left'   { $fmt.Alignment = [System.Drawing.StringAlignment]::Near }
    'right'  { $fmt.Alignment = [System.Drawing.StringAlignment]::Far }
    default  { $fmt.Alignment = [System.Drawing.StringAlignment]::Center }
  }
  switch ($valign) {
    'top'    { $fmt.LineAlignment = [System.Drawing.StringAlignment]::Near }
    'bottom' { $fmt.LineAlignment = [System.Drawing.StringAlignment]::Far }
    default  { $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center }
  }
  $brush = New-Object System.Drawing.SolidBrush($color)
  $rect = New-Object System.Drawing.RectangleF($x, $y, $w, $h)
  $g.DrawString($text, $font, $brush, $rect, $fmt)
  $brush.Dispose(); $font.Dispose(); $fmt.Dispose()
}

# 测量单行文本宽度（自动缩字号）
function Fit-Font($g, [string]$text, [string]$family, [float]$size, [float]$maxW, [bool]$bold = $false) {
  $style = [System.Drawing.FontStyle]::Regular
  if ($bold) { $style = [System.Drawing.FontStyle]::Bold }
  $s = $size
  while ($s -gt 10) {
    $font = New-Object System.Drawing.Font($family, $s, $style, [System.Drawing.GraphicsUnit]::Pixel)
    $m = $g.MeasureString($text, $font)
    $font.Dispose()
    if ($m.Width -le $maxW) { return $s }
    $s -= 1
  }
  return $s
}

function Draw-Sprite($g, [string]$name, [float]$x, [float]$y, [float]$size) {
  $path = Join-Path $frames $name
  if (-not (Test-Path $path)) { Write-Output ("缺少帧: " + $name); return }
  $img = [System.Drawing.Image]::FromFile($path)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g.DrawImage($img, $x, $y, $size, $size)
  $img.Dispose()
}

function Draw-Head($g, [string]$title, [string]$sub, [int]$w) {
  Draw-Text $g $title $YAHEI 54 $CREAM 60 36 ($w - 120) 66 'left' 'top' $true
  Draw-Text $g $sub $YAHEI 24 $MUTED 62 108 ($w - 124) 34 'left' 'top'
}

# 示意数据角标
function Draw-DemoBadge($g, [float]$x, [float]$y) {
  Fill-RR $g $x $y 116 34 17 $DEEP
  Draw-Text $g '示意数据' $YAHEI 18 $CREAM $x $y 116 34
}

# 圆点
function Draw-Dot($g, [float]$x, [float]$y, [float]$d, $color) {
  $b = New-Object System.Drawing.SolidBrush($color)
  $g.FillEllipse($b, $x, $y, $d, $d)
  $b.Dispose()
}

# 橙色光晕
function Draw-Glow($g, [float]$cx, [float]$cy, [float]$rMax) {
  for ($i = 12; $i -ge 1; $i--) {
    $r = $rMax * $i / 12.0
    $b = New-Object System.Drawing.SolidBrush((CA ([int](14 - $i)) '#D97757'))
    $g.FillEllipse($b, $cx - $r, $cy - $r, 2 * $r, 2 * $r)
    $b.Dispose()
  }
}

# ============================================================
# 01 封面 1600×900
# ============================================================
$c1 = New-Canvas 1600 900
$bmp1 = $c1[0]; $g1 = $c1[1]
Paint-Bg $g1 1600 900
Draw-Glow $g1 430 420 400

# 代码编辑器（右）
Fill-RR $g1 830 110 690 400 16 $CARD
Draw-RR $g1 830 110 690 400 16 $CARD_BORDER 2
Draw-Dot $g1 856 138 12 (C '#E8847A'); Draw-Dot $g1 880 138 12 (C '#F0B65A'); Draw-Dot $g1 904 138 12 (C '#7FD98A')
Draw-Text $g1 'client.js — 会话事件折叠' $MONO 18 $MUTED 940 130 300 28 'left'
$cl = @(
  @('// 状态感知：AI 事件流驱动表情', $MUTED),
  @('turn/start   -> thinking', $CODE),
  @('tool/call    -> working', $CODE),
  @('turn/end     -> success / error', $CODE),
  @('session/event 折叠 -> /dsh-clawd-7788/state', $MUTED)
)
$cy = 186
foreach ($line in $cl) {
  Draw-Text $g1 $line[0] $MONO 20 $line[1] 858 $cy 640 30 'left' 'top'
  $cy += 38
}
$b1 = New-Object System.Drawing.SolidBrush((CA 22 '#24364D'))
for ($i = 0; $i -lt 4; $i++) { $g1.FillRectangle($b1, 858 + (($i * 137) % 340), $cy + 6 + $i * 36, 200 - (($i * 53) % 120), 12) }
$b1.Dispose()

# 终端（右下）
Fill-RR $g1 830 545 690 215 16 (C '#0A1220')
Draw-RR $g1 830 545 690 215 16 $CARD_BORDER 2
Draw-Dot $g1 856 573 12 (C '#E8847A'); Draw-Dot $g1 880 573 12 (C '#F0B65A'); Draw-Dot $g1 904 573 12 (C '#7FD98A')
Draw-Text $g1 'bash' $MONO 18 $MUTED 940 565 300 28 'left'
$tl = @(
  @('> dsh plugin --profile web add github:zjhsxb/dsh-clawd', $CREAM),
  @('ok  dsh-clawd 0.1.2', $GREEN),
  @('> curl http://127.0.0.1:29095/dsh-clawd-7788/state', $CREAM),
  @('{ "state": "working", "usage": { ... }, "segments": [ ... ] }', $CODE)
)
$ty = 615
foreach ($line in $tl) {
  Draw-Text $g1 $line[0] $MONO 19 $line[1] 858 $ty 640 26 'left' 'top'
  $ty += 33
}

# 主角（happy 帧 ×24 = 576，真实精灵放大）
Draw-Sprite $g1 'happy_1@24.png' 120 130 576

# 标题区
Draw-Text $g1 'dsh-clawd' $MONO 84 $CREAM 120 34 640 90 'left' 'top' $true
Draw-Text $g1 'Clawd 娘 · 你的 AI 桌面伙伴' $YAHEI 30 $MUTED 122 128 620 40 'left' 'top'

# 标语 + 三个功能 chip
Draw-Text $g1 '让 AI 工作，多一点陪伴' $YAHEI 46 $CREAM 120 712 640 54 'left' 'top' $true
$chips = @('AI 状态感知', 'Token 账本', '趣味互动')
$cx = 120
foreach ($ch in $chips) {
  $cw = 226
  $p = New-RRPath $cx 786 $cw 52 26
  $cb = New-Object System.Drawing.SolidBrush($ORANGE)
  $g1.FillPath($cb, $p)
  $cb.Dispose()
  $pen = New-Object System.Drawing.Pen($OUTLINE, 2)
  $g1.DrawPath($pen, $p)
  $pen.Dispose(); $p.Dispose()
  Draw-Text $g1 $ch $YAHEI 24 $CREAM $cx 786 $cw 52 'center' 'middle' $true
  $cx += $cw + 22
}

$bmp1.Save((Join-Path $outDir '01-cover.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g1.Dispose(); $bmp1.Dispose()
Write-Output '已写出 01-cover.png (1600x900)'

# ============================================================
# 02 AI 状态感知 1200×900
# ============================================================
$c2 = New-Canvas 1200 900
$bmp2 = $c2[0]; $g2 = $c2[1]
Paint-Bg $g2 1200 900
Draw-Head $g2 'AI 状态感知' '会话事件实时映射为宠物表情 —— thinking / working / waiting / result / success / error'

$moods = @(
  @('idle_0@6.png',    'idle · 待机',    '#8FA6BE'),
  @('think_0@6.png',   'think · 思考中', '#F0B65A'),
  @('work_1@6.png',    'work · 工作中',  '#D97757'),
  @('success_0@6.png', 'success · 完成', '#F0B65A'),
  @('error_1@6.png',   'error · 出错',   '#E8847A'),
  @('sleep_2@6.png',   'sleep · 睡觉',   '#8FA6BE'),
  @('eat_1@6.png',     'eat · 吃 token', '#D97757'),
  @('happy_1@6.png',   'happy · 开心',   '#F0B65A')
)
$cellW = 262; $cellH = 292; $gx0 = 46; $gy0 = 168; $gapX = 26; $gapY = 26
for ($i = 0; $i -lt 8; $i++) {
  $col = $i % 4; $row = [math]::Floor($i / 4)
  $x = $gx0 + $col * ($cellW + $gapX); $y = $gy0 + $row * ($cellH + $gapY)
  Fill-RR $g2 $x $y $cellW $cellH 18 $CARD
  Draw-RR $g2 $x $y $cellW $cellH 18 $CARD_BORDER 2
  Draw-Sprite $g2 $moods[$i][0] ($x + ($cellW - 144) / 2) ($y + 34) 144
  Draw-Dot $g2 ($x + $cellW / 2 - 5) ($y + 196) 10 (C $moods[$i][2])
  Draw-Text $g2 $moods[$i][1] $YAHEI 22 $CREAM $x ($y + 220) $cellW 30 'center' 'top' $true
  Draw-Text $g2 $moods[$i][2] $MONO 15 $MUTED $x ($y + 254) $cellW 22 'center' 'top'
}
Draw-Text $g2 '表情由真实会话事件驱动，而不是循环播放的固定动画' $YAHEI 22 $MUTED 60 838 1080 30 'center' 'top'

$bmp2.Save((Join-Path $outDir '02-ai-status.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g2.Dispose(); $bmp2.Dispose()
Write-Output '已写出 02-ai-status.png (1200x900)'

# ============================================================
# 03 Token 账本 1200×900
# ============================================================
$c3 = New-Canvas 1200 900
$bmp3 = $c3[0]; $g3 = $c3[1]
Paint-Bg $g3 1200 900
Draw-Head $g3 'Token 账本' '双击宠物 —— 气泡显示 DeepSeek 账户余额与本次会话费用'

# 左卡片：宠物 + 真实气泡样式
Fill-RR $g3 40 160 420 690 18 $CARD
Draw-RR $g3 40 160 420 690 18 $CARD_BORDER 2
Draw-Sprite $g3 'idle_0@12.png' 106 430 288

# 气泡（真实 CSS：奶油底 #F5F0E8 + 橙边 #D97757 + 深棕字 #3D2A20 + 圆角 + 下方箭头）
Fill-RR $g3 84 246 312 112 14 $CREAM
Draw-RR $g3 84 246 312 112 14 $ORANGE 2
$tip = New-Object System.Drawing.Drawing2D.GraphicsPath
$tip.AddLines([System.Drawing.PointF[]]@(
  (New-Object System.Drawing.PointF(200, 358)),
  (New-Object System.Drawing.PointF(228, 358)),
  (New-Object System.Drawing.PointF(214, 374))
))
$tip.CloseFigure()
$tb = New-Object System.Drawing.SolidBrush($CREAM)
$g3.FillPath($tb, $tip)
$tb.Dispose()
$tpen = New-Object System.Drawing.Pen($ORANGE, 2)
$g3.DrawPath($tpen, $tip)
$tpen.Dispose(); $tip.Dispose()
Draw-Text $g3 "余额：¥12.34`n会话：约 ¥0.72（估）" $YAHEI 22 $OUTLINE 98 254 284 96 'left' 'top'
Draw-DemoBadge $g3 282 206

Draw-Text $g3 '气泡样式与两行文案格式取自真实实现' $YAHEI 19 $MUTED 60 740 380 28 'center' 'top'
Draw-Text $g3 '余额 30 秒自动刷新 · 账本打开时随快照实时更新' $YAHEI 19 $MUTED 60 776 380 28 'center' 'top'
Draw-Text $g3 '估算标注（估）与「价格未知」同样来自真实实现' $YAHEI 19 $MUTED 60 812 380 28 'center' 'top'

# 右区：四张统计卡
$stats = @(
  @('输入 Token', '1,234,567'),
  @('输出 Token', '89,012'),
  @('缓存读取', '5,678,901'),
  @('缓存写入', '0')
)
for ($i = 0; $i -lt 4; $i++) {
  $col = $i % 2; $row = [math]::Floor($i / 2)
  $x = 500 + $col * 340; $y = 160 + $row * 160
  Fill-RR $g3 $x $y 320 140 14 (C '#101C30')
  Draw-RR $g3 $x $y 320 140 14 $CARD_BORDER 1.5
  Draw-Text $g3 $stats[$i][0] $YAHEI 21 $MUTED ($x + 20) ($y + 22) 280 30 'left' 'top'
  Draw-Text $g3 $stats[$i][1] $MONO 36 $CREAM ($x + 20) ($y + 62) 280 48 'left' 'top' $true
}

# 分段计价面板
Fill-RR $g3 500 490 660 360 16 $CARD
Draw-RR $g3 500 490 660 360 16 $CARD_BORDER 2
Draw-Text $g3 '分段计价：按实际 模型 × 时段 分别估算' $YAHEI 24 $CREAM 520 508 560 32 'left' 'top' $true
Draw-DemoBadge $g3 1048 504
$cols = @(@('模型', 20), @('时段', 190), @('输入', 340), @('输出', 440), @('费用(估)', 520))
foreach ($cdef in $cols) { Draw-Text $g3 $cdef[0] $YAHEI 19 $MUTED (520 + $cdef[1]) 552 150 26 'left' 'top' }
$rows = @(
  @('deepseek-v4-pro', '空闲', '812,345', '45,678', '¥5.32'),
  @('deepseek-v4-pro', '高峰', '123,456', '8,901',  '¥1.45'),
  @('deepseek-flash',  '空闲', '234,567', '12,345', '¥0.38')
)
$ry = 588
foreach ($r in $rows) {
  $vals = @($r[0], $r[1], $r[2], $r[3], $r[4])
  $cols2 = @(20, 190, 340, 440, 520)
  for ($k = 0; $k -lt 5; $k++) {
    $fam = if ($k -eq 0) { $YAHEI } else { $MONO }
    Draw-Text $g3 $vals[$k] $fam 19 $CREAM (520 + $cols2[$k]) $ry 150 26 'left' 'top'
  }
  $ry += 44
}
$lb = New-Object System.Drawing.Pen((CA 40 '#8FA6BE'), 1)
$g3.DrawLine($lb, 520, 736, 1140, 736)
$lb.Dispose()
Draw-Text $g3 '价格按 DeepSeek 官方目录价估算（¥/百万 token，2026-11-19 核对），以官方用量页为准' $YAHEI 19 $MUTED 520 748 600 56 'left' 'top'

$bmp3.Save((Join-Path $outDir '03-token-ledger.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g3.Dispose(); $bmp3.Dispose()
Write-Output '已写出 03-token-ledger.png (1200x900)'

# ============================================================
# 04 趣味互动 1200×900
# ============================================================
$c4 = New-Canvas 1200 900
$bmp4 = $c4[0]; $g4 = $c4[1]
Paint-Bg $g4 1200 900
Draw-Head $g4 '趣味互动' '它首先是桌宠，其次才是工具 —— 拖它、甩它、喂它、逗它'

# 场景 ① 桌面漫游
Fill-RR $g4 40 160 540 330 18 $CARD
Draw-RR $g4 40 160 540 330 18 $CARD_BORDER 2
Draw-Text $g4 '自由漫游' $YAHEI 26 $CREAM 60 178 500 34 'left' 'top' $true
Draw-Sprite $g4 'walk_0@6.png' 130 250 144
Draw-Sprite $g4 'walk_1@6.png' 320 250 144
$dash = New-Object System.Drawing.Pen((CA 90 '#8FA6BE'), 2)
$dash.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
$g4.DrawLine($dash, 90, 440, 500, 440)
$dash.Dispose()
Draw-Text $g4 '重力弹跳 · 横着散步 · 5 分钟没动静自动睡觉' $YAHEI 20 $MUTED 60 452 500 26 'center' 'top'

# 场景 ② 拖拽与甩飞
Fill-RR $g4 620 160 540 330 18 $CARD
Draw-RR $g4 620 160 540 330 18 $CARD_BORDER 2
Draw-Text $g4 '拖拽 · 甩飞' $YAHEI 26 $CREAM 640 178 500 34 'left' 'top' $true
Draw-Sprite $g4 'drag_0@6.png' 810 245 144
# 运动轨迹
$dots = @(@(780, 330), @(805, 320), @(830, 310))
$di = 1
foreach ($d in $dots) {
  Draw-Dot $g4 $d[0] $d[1] (18 - $di * 4) (CA ([int](120 - $di * 30)) '#D97757')
  $di++
}
# 光标箭头
$cur = New-Object System.Drawing.Drawing2D.GraphicsPath
$cur.AddPolygon([System.Drawing.PointF[]]@(
  (New-Object System.Drawing.PointF(690, 240)),
  (New-Object System.Drawing.PointF(690, 298)),
  (New-Object System.Drawing.PointF(712, 282)),
  (New-Object System.Drawing.PointF(728, 304)),
  (New-Object System.Drawing.PointF(742, 292)),
  (New-Object System.Drawing.PointF(726, 270)),
  (New-Object System.Drawing.PointF(744, 264))
))
$cur.CloseFigure()
$cb2 = New-Object System.Drawing.SolidBrush($CREAM)
$g4.FillPath($cb2, $cur)
$cb2.Dispose(); $cur.Dispose()
Draw-Text $g4 '拖到任何位置，松手带初速度飞出去' $YAHEI 20 $MUTED 640 452 500 26 'center' 'top'

# 场景 ③ 右键菜单（真实 7 项）
Fill-RR $g4 40 520 540 330 18 $CARD
Draw-RR $g4 40 520 540 330 18 $CARD_BORDER 2
Draw-Text $g4 '右键菜单' $YAHEI 26 $CREAM 60 538 500 34 'left' 'top' $true
Draw-Sprite $g4 'idle_0@6.png' 92 645 144
# 菜单 mock：真实样式（白底 + 橙边 + 悬停奶油行）
Fill-RR $g4 270 558 268 290 12 (C '#FFFFFF')
Draw-RR $g4 270 558 268 290 12 $ORANGE 2
$items = @('说句话', '吃个 token', '余额 · 用量', '睡觉', '大小 ×3', '回到底部', '藏起来')
$iy = 566
$idx = 0
foreach ($it in $items) {
  if ($idx -eq 2) { Fill-RR $g4 278 ($iy - 2) 252 34 8 $CREAM }
  Draw-Text $g4 $it $YAHEI 20 $OUTLINE 286 $iy 236 30 'left' 'top'
  $iy += 40
  $idx++
}
Draw-Text $g4 '7 个真实菜单项 · 贴光标弹出' $YAHEI 20 $MUTED 60 866 500 26 'center' 'top'

# 场景 ④ 双击账本 · 隐藏召回
Fill-RR $g4 620 520 540 330 18 $CARD
Draw-RR $g4 620 520 540 330 18 $CARD_BORDER 2
Draw-Text $g4 '双击账本 · 隐藏召回' $YAHEI 26 $CREAM 640 538 500 34 'left' 'top' $true
Draw-Sprite $g4 'idle_0@6.png' 636 640 144
Fill-RR $g4 800 590 300 112 14 $CREAM
Draw-RR $g4 800 590 300 112 14 $ORANGE 2
Draw-Text $g4 "余额：¥12.34`n会话：约 ¥0.72（估）" $YAHEI 21 $OUTLINE 814 598 272 96 'left' 'top'
# 召回按钮（真实样式：橙底圆钮 + 星芒）
$rb = New-Object System.Drawing.SolidBrush($ORANGE)
$g4.FillEllipse($rb, 1016, 730, 46, 46)
$rb.Dispose()
$rpen = New-Object System.Drawing.Pen($OUTLINE, 2)
$g4.DrawEllipse($rpen, 1016, 730, 46, 46)
$rpen.Dispose()
$star = New-Object System.Drawing.Drawing2D.GraphicsPath
$star.AddPolygon([System.Drawing.PointF[]]@(
  (New-Object System.Drawing.PointF(1039, 738)),
  (New-Object System.Drawing.PointF(1045, 754)),
  (New-Object System.Drawing.PointF(1062, 754)),
  (New-Object System.Drawing.PointF(1048, 764)),
  (New-Object System.Drawing.PointF(1052, 780)),
  (New-Object System.Drawing.PointF(1039, 772)),
  (New-Object System.Drawing.PointF(1026, 780)),
  (New-Object System.Drawing.PointF(1030, 764)),
  (New-Object System.Drawing.PointF(1016, 754)),
  (New-Object System.Drawing.PointF(1033, 754))
))
$star.CloseFigure()
$sb = New-Object System.Drawing.SolidBrush($CREAM)
$g4.FillPath($sb, $star)
$sb.Dispose(); $star.Dispose()
Draw-Text $g4 '藏起来后：右下角星芒按钮一键召回' $YAHEI 20 $MUTED 640 866 500 26 'center' 'top'

$bmp4.Save((Join-Path $outDir '04-interaction.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g4.Dispose(); $bmp4.Dispose()
Write-Output '已写出 04-interaction.png (1200x900)'

# ============================================================
# preview.png：四图整体预览 1440×1180
# ============================================================
$cp = New-Canvas 1440 1180
$bmpp = $cp[0]; $gp = $cp[1]
Paint-Bg $gp 1440 1180
Draw-Text $gp 'dsh-clawd 插件市场宣传图 · 四张一组' $YAHEI 40 $CREAM 60 30 1320 52 'left' 'top' $true

function Paste-Image($g, [string]$file, [float]$x, [float]$y, [float]$w, [float]$h) {
  $img = [System.Drawing.Image]::FromFile((Join-Path $outDir $file))
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, $x, $y, $w, $h)
  $img.Dispose()
}
Paste-Image $gp '01-cover.png' 98 118 1244 700
Draw-Text $gp '01 · 产品主视觉封面' $YAHEI 20 $MUTED 40 90 400 26 'left' 'top'
Paste-Image $gp '02-ai-status.png' 40 860 440 320
Paste-Image $gp '03-token-ledger.png' 500 860 440 320
Paste-Image $gp '04-interaction.png' 960 860 440 320
Draw-Text $gp '02 · AI 状态感知' $YAHEI 20 $MUTED 40 830 440 26 'center' 'top'
Draw-Text $gp '03 · Token 账本' $YAHEI 20 $MUTED 500 830 440 26 'center' 'top'
Draw-Text $gp '04 · 趣味互动' $YAHEI 20 $MUTED 960 830 440 26 'center' 'top'

$bmpp.Save((Join-Path $outDir 'preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$gp.Dispose(); $bmpp.Dispose()
Write-Output '已写出 preview.png (1440x1180)'
Write-Output '全部完成'
