/*!
 * dsh-clawd —— Claude 吉祥物 Clawd 像素螃蟹娘的 DSH 桌宠（浏览器半侧）
 * 单文件、零构建：像素精灵引擎 + 物理漫游 + 拖拽甩飞 + 气泡碎碎念 + 右键菜单。
 *
 * 精灵数据与编译器用 @sprite-* 标记块包裹，scripts/preview.mjs 会原样抽取渲染预览图
 * （改美术时先改这里，再跑 npm run preview 目检）。
 *
 * 声明：Clawd 是 Anthropic 的角色形象；本插件是非官方爱好者作品，与 Anthropic 没有关联。
 */
(function () {
  'use strict';

  var ROUTE = '/dsh-clawd-7788';
  var GRID = 24;

  var PALETTE = {
    o: '#3D2A20', // 轮廓
    D: '#B95E3B', // 深橙
    O: '#D97757', // Clawd 橙（Claude 官方主色）
    C: '#F5F0E8', // 奶油
    b: '#2B1B12', // 深棕（瞳孔/线）
    w: '#FFFFFF', // 白
    r: '#E8847A', // 腮红
    y: '#F0B65A'  // 金黄（星芒/火花）
  };

  /* @sprite-base */
  // 24×24 基础网格：头顶 Claude 星芒发饰 + 橘发 + 奶油脸 + 蟹钳 + 四条小短腿
  // 锚点（FRAME_SPEC 依赖，勿动）：眼睛 ww@行11/列8-9,14-15；眼睑 bb@行12 同列；腮红 rr@行13；嘴 bb@行14/列11；钳@行16-18/列0-3,20-23；腿@行20-21/列5-6,9-10,13-14,17-18；脚@行22 同列
  var SPRITE_BASE = [
    '............y...........',
    '.........y..y..y........',
    '.........yyyyyyy........',
    '.........y..y..y........',
    '............y...........',
    '....oDDDDDDDDDDDDDDo....',
    '....oDDDDCCDDDDDDDDo....',
    '....oDCOOOOOOOOOOCDo....',
    '....oDCOOOOOOOOOOCDo....',
    '....oDCOOOOOOOOOOCDo....',
    '....oOOOOOOOOOOOOOOo....',
    '....oOCCwwCCCCwwCCOo....',
    '....oOCCbbCCCCbbCCOo....',
    '....oOCCrrCCCCrrCCOo....',
    '....oOCCCCbbCCCCCCOo....',
    '....oOOOOOOOOOOOOOOo....',
    'oOOoOOOOOOOOOOOOOOOOoOOo',
    'oOOoOOOCCCCCCCCCCOOOoOOo',
    'oOOooDOOOOOOOOOOOODooOOo',
    '....oDDDDDDDDDDDDDDo....',
    '....oO..oO..oO..oO......',
    '....oO..oO..oO..oO......',
    '....oo..oo..oo..oo......',
    '........................'
  ];
  /* @sprite-base-end */

  /* @sprite-spec */
  // 帧编辑器：M([col, str], ...) 在 24 宽的"保留底图"行上按列覆盖像素（'.'=保留底图，' '=挖空）
  function M() {
    var s = new Array(GRID);
    for (var i = 0; i < GRID; i++) s[i] = '.';
    for (var j = 0; j < arguments.length; j++) {
      var col = arguments[j][0];
      var str = arguments[j][1];
      for (var k = 0; k < str.length; k++) s[col + k] = str[k];
    }
    return s.join('');
  }
  var EYES_CLOSED = { '11': M([8, 'bb'], [14, 'bb']), '12': M([8, 'CC'], [14, 'CC']) };
  function rows() {
    var out = {};
    for (var i = 0; i < arguments.length; i++) {
      var r = arguments[i];
      out[r[0]] = r[1];
    }
    return out;
  }
  // 双钳上举（success/drag 共用）
  function clawsUp() {
    return {
      '13': M([0, '.oo.'], [20, '.oo.']),
      '14': M([0, 'oOOo'], [20, 'oOOo']),
      '15': M([0, 'oo.o'], [20, 'o.Oo']),
      '16': M([0, '.oo.'], [20, '.oo.']),
      '17': M([0, '    '], [20, '    ']),
      '18': M([0, '    '], [20, '    '])
    };
  }

  var FRAME_SPEC = {
    idle: { frames: [{ dy: 0 }, { dy: 0 }, { dy: 0 }, { dy: 1 }, { dy: 0 }] },
    blink: { frames: [{ dy: 0, rows: EYES_CLOSED }], once: true },
    walk: { frames: [
      { dy: 0 },
      { dy: 0, rows: { '22': M([4, '  '], [8, '  '], [12, '  '], [16, '  '], [5, 'oo'], [9, 'oo'], [13, 'oo'], [17, 'oo']) } },
      { dy: 0 },
      { dy: 0, rows: { '22': M([4, '  '], [8, '  '], [12, '  '], [16, '  '], [5, 'oo'], [9, 'oo'], [13, 'oo'], [17, 'oo']) } }
    ] },
    think: { frames: [
      { dy: 0, rows: EYES_CLOSED },
      { dy: 0 },
      { dy: 0, rows: EYES_CLOSED },
      { dy: 0 }
    ] },
    work: { frames: [
      { dy: 0 },
      { dy: 0, rows: rows(['13', M([0, '.oo.'], [20, '.oo.'])],
        ['14', M([0, 'oOOo'], [20, 'oOOo'])],
        ['15', M([0, 'oo.o'], [20, 'o.Oo'])],
        ['16', M([0, '.oo.'], [20, '.oo.'])],
        ['17', M([0, '    '], [20, '    '])],
        ['18', M([0, '    '], [20, '    '])],
        ['10', M([1, 'y'], [22, 'y'])]) },
      { dy: 0 },
      { dy: 0, rows: rows(['13', M([0, '.oo.'], [20, '.oo.'])],
        ['14', M([0, 'oOOo'], [20, 'oOOo'])],
        ['15', M([0, 'oo.o'], [20, 'o.Oo'])],
        ['16', M([0, '.oo.'], [20, '.oo.'])],
        ['17', M([0, '    '], [20, '    '])],
        ['18', M([0, '    '], [20, '    '])],
        ['10', M([2, 'y'], [21, 'y'])]) }
    ] },
    success: { frames: [
      { dy: -2, rows: rows(['13', M([0, '.oo.'], [20, '.oo.'])],
        ['14', M([0, 'oOOo'], [20, 'oOOo'])],
        ['15', M([0, 'oo.o'], [20, 'o.Oo'])],
        ['16', M([0, '.oo.'], [20, '.oo.'])],
        ['17', M([0, '    '], [20, '    '])],
        ['18', M([0, '    '], [20, '    '])],
        ['12', M([0, 'w'], [23, 'w'])],
        ['10', M([1, 'y'], [22, 'y'])]) },
      { dy: -2, rows: rows(['13', M([0, '.oo.'], [20, '.oo.'])],
        ['14', M([0, 'oOOo'], [20, 'oOOo'])],
        ['15', M([0, 'oo.o'], [20, 'o.Oo'])],
        ['16', M([0, '.oo.'], [20, '.oo.'])],
        ['17', M([0, '    '], [20, '    '])],
        ['18', M([0, '    '], [20, '    '])],
        ['12', M([0, 'w'], [23, 'w'])],
        ['10', M([1, 'y'], [22, 'y'])]) },
      { dy: 0 }
    ], repeat: 2 },
    error: { frames: [
      { dy: 1, rows: { '10': M([8, 'b'], [15, 'b']), '1': M([10, 'C']) } },
      { dy: 1, rows: { '10': M([8, 'b'], [15, 'b']), '0': M([11, 'C']), '13': M([9, 'w']) } },
      { dy: 1, rows: { '10': M([8, 'b'], [15, 'b']), '14': M([9, 'w']) } }
    ], repeat: 2 },
    sleep: { frames: [
      { dy: 1, rows: rows(['11', M([8, 'bb'], [14, 'bb'])], ['12', M([8, 'CC'], [14, 'CC'])], ['7', M([20, 'w'])]) },
      { dy: 1, rows: rows(['11', M([8, 'bb'], [14, 'bb'])], ['12', M([8, 'CC'], [14, 'CC'])], ['6', M([21, 'w'])], ['7', M([20, 'w'])]) },
      { dy: 1, rows: rows(['11', M([8, 'bb'], [14, 'bb'])], ['12', M([8, 'CC'], [14, 'CC'])], ['5', M([22, 'w'])], ['6', M([21, 'w'])], ['7', M([20, 'w'])], ['14', M([11, 'w'])]) },
      { dy: 1, rows: rows(['11', M([8, 'bb'], [14, 'bb'])], ['12', M([8, 'CC'], [14, 'CC'])], ['6', M([21, 'w'])], ['7', M([20, 'w'])]) }
    ] },
    eat: { frames: [
      { dy: 0, rows: { '16': M([0, 'yy']), '17': M([0, 'yy']) } },
      { dy: 0, rows: { '13': M([11, 'yy']), '14': M([11, 'yy']) } },
      { dy: 0, rows: { '13': M([11, 'y']), '16': M([10, 'y'], [14, 'y']) } },
      { dy: 0 }
    ], repeat: 1 },
    drag: { frames: [
      { dy: 1, rows: rows(['13', M([0, '.oo.'], [20, '.oo.'])],
        ['14', M([0, 'oOOo'], [20, 'oOOo'])],
        ['15', M([0, 'oo.o'], [20, 'o.Oo'], [11, 'ww'])],
        ['16', M([0, '.oo.'], [20, '.oo.'])],
        ['17', M([0, '    '], [20, '    '])],
        ['18', M([0, '    '], [20, '    '])],
        ['10', M([8, 'ww'], [14, 'ww'])],
        ['22', M([4, '    '], [8, '    '], [12, '    '], [16, '    '])],
        ['23', M([4, '    '], [8, '    '], [12, '    '], [16, '    '])]) }
    ] },
    happy: { frames: [
      { dy: -1, rows: { '14': M([10, 'bwwb']), '5': M([1, 'y'], [22, 'y']) } },
      { dy: 0, rows: { '14': M([10, 'bwwb']), '4': M([0, 'y'], [23, 'y']) } },
      { dy: -1, rows: { '14': M([10, 'bwwb']), '6': M([2, 'y'], [21, 'y']) } }
    ], repeat: 2 }
  };
  /* @sprite-spec-end */

  /* @sprite-compile */
  function compileFrames(base, spec) {
    var out = {};
    for (var state in spec) {
      if (!Object.prototype.hasOwnProperty.call(spec, state)) continue;
      var def = spec[state];
      var frames = def.frames.map(function (f) {
        var dy = f.dy || 0;
        var grid = [];
        for (var r = 0; r < GRID; r++) {
          var src = r - dy; // dy>0 → 精灵整体下移
          grid.push(src >= 0 && src < GRID ? base[src].split('') : new Array(GRID).fill(' '));
        }
        var rows = f.rows || {};
        for (var rk in rows) {
          if (!Object.prototype.hasOwnProperty.call(rows, rk)) continue;
          var rn = parseInt(rk, 10);
          var edit = rows[rk];
          for (var c = 0; c < GRID; c++) {
            var ch = edit.charAt(c);
            if (ch !== '.') grid[rn][c] = ch;
          }
        }
        return grid;
      });
      out[state] = { frames: frames, repeat: def.repeat || 0 };
    }
    return out;
  }
  /* @sprite-compile-end */

  // ============================== 引擎 ==============================

  window.__ModuleLoader__.load({
    id: 'dsh-clawd',
    factory: function (require) {
      var React = require('react');
      var FRAMES = compileFrames(SPRITE_BASE, FRAME_SPEC);

      var TICK_MS = 110;
      var SPEED_WALK = 0.7;
      var GRAVITY = 0.45;
      var BOUNCE = 0.45;
      var THROW_MIN = 3.5;
      var STORAGE_KEY = 'dsh-clawd:v3'; // v3: 默认 3×，旧存档（≤2×）作废
      var SCALES = [1.5, 2, 2.5, 3, 3.5, 4, 5]; // 右键菜单大小挡位循环

      var MOOD_BY_STATE = {
        thinking: 'think',
        working: 'work',
        result: 'think',
        waiting: 'wait',
        success: 'success',
        error: 'error'
      };

      var QUIPS = {
        hello: 'Clawd 来啦！咔哒咔哒～',
        click: ['呀！不要戳我！', '再戳我也不会变聪明的啦', '嘿嘿，什么事呀？', '有什么吩咐？', '别戳啦，好痒～'],
        idle: ['咔哒咔哒……(横着散步)', '今天也要好好写代码哦', '我也有 Claude 同款橙色！', 'token 又少了一截，真香', '这里不封号，放心用', '像素风才是永远的神', '呼……有点困了', '什么时候带我出海？', '我超会横着走的', '盯——(正在观察你写代码)'],
        think: ['让我想想…', '嗯…这个有点意思', '脑袋里的小齿轮转起来了'],
        work: ['干活中！', '咔咔咔，马上就好', '交给我吧！'],
        wait: ['等你拍板哦', '需要你确认一下', '我在这儿等着呢'],
        success: ['完成啦 ✌', '搞定！', '轻轻松松～', '收工！'],
        error: ['呜哇，出错了…', '别慌，我们再试一次', '碰到点小问题，深呼吸'],
        eat: ['咔嚓咔嚓…token 真香', '好吃！还有吗？', 'yummy！'],
        fly: ['哇——飞起来了！', '芜湖！', '慢、慢点——'],
        wake: ['早啊…', '唔…几点了？'],
        doze: ['zzz…呼…', '好困…先睡会儿']
      };

      function pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
      }

      // 余额总额（充值 + 赠送，按货币合并）
      function totalBalance(bal) {
        var wallets = (bal.wallets || []).concat(bal.bonusWallets || []);
        var byCur = {};
        wallets.forEach(function (w) {
          if (!w || w.currency === undefined) return;
          var n = Number(w.balance);
          if (!Number.isFinite(n)) return;
          byCur[w.currency] = (byCur[w.currency] || 0) + n;
        });
        var keys = Object.keys(byCur);
        if (keys.length === 0) return null;
        return keys.map(function (cur) {
          return (cur === 'USD' ? '$' : '¥') + byCur[cur].toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }).join(' + ');
      }

      // 会话费用估算（CNY，按 DeepSeek 官方标准时段单价，百万 token）
      // deepseek-chat: 输入缓存命中 ¥0.5 / 未命中 ¥2 / 输出 ¥8
      // deepseek-reasoner: 命中 ¥1 / 未命中 ¥4 / 输出 ¥16（reasoning 按输出计）
      function estimateCost(u, model) {
        if (!u) return null;
        var reasoner = /reasoner|r1/i.test(String(model || ''));
        var hit = reasoner ? 1 : 0.5;
        var miss = reasoner ? 4 : 2;
        var out = reasoner ? 16 : 8;
        var input = Number(u.input) || 0;
        var cacheRead = Number(u.cacheRead) || 0;
        var output = Number(u.output) || 0;
        var reasoning = Number(u.reasoning) || 0;
        var uncached = Math.max(0, input - cacheRead);
        return (uncached / 1e6) * miss + (cacheRead / 1e6) * hit + (output / 1e6) * out + (reasoning / 1e6) * out;
      }

      function fmtMoney(v) {
        return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }

      // 双击账本：从 /state 快照生成两行气泡文本（余额 + 会话费用估算）
      function ledgerLines(snap) {
        snap = snap || {};
        var bal;
        if (snap.account === 'unavailable') bal = '账户服务不可用';
        else if (snap.account === 'signed-out') bal = '未登录 DeepSeek';
        else if (snap.balance && snap.balance.status === 'ready') bal = totalBalance(snap.balance) || '—';
        else if (snap.balance && snap.balance.status === 'failed') bal = '查询失败';
        else bal = '加载中…';
        var cost = estimateCost(snap.usage, snap.model);
        var line2 = cost === null ? '暂无用量' : fmtMoney(cost);
        return '💰 余额：' + bal + '\n📊 会话：' + line2;
      }

      var CSS = [
        '.dsc-root{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:20;}',
        '.dsc-pet{position:absolute;left:0;top:0;width:24px;height:24px;pointer-events:auto;cursor:grab;touch-action:none;user-select:none;}',
        '.dsc-pet:active{cursor:grabbing;}',
        '.dsc-pet canvas{width:100%;height:100%;image-rendering:pixelated;display:block;}',
        '.dsc-shadow{position:absolute;left:50%;bottom:-3px;transform:translateX(-50%);border-radius:50%;background:rgba(61,42,32,.15);height:6px;}',
        '.dsc-bubble{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%);background:#F5F0E8;border:1px solid #D97757;color:#3D2A20;font-size:12px;line-height:1.5;padding:6px 10px;border-radius:10px;max-width:240px;box-shadow:0 2px 8px rgba(61,42,32,.12);pointer-events:none;white-space:pre-line;word-break:break-all;text-align:left;}',
        '.dsc-bubble::after{content:"";position:absolute;top:100%;left:50%;transform:translateX(-50%);border:6px solid transparent;border-top-color:#D97757;}',
        '.dsc-menu{position:fixed;z-index:2147483000;background:#FFFFFF;border:1px solid #D97757;border-radius:10px;box-shadow:0 6px 24px rgba(61,42,32,.18);padding:4px;min-width:150px;font-size:13px;color:#3D2A20;font-family:inherit;pointer-events:auto;}',
        '.dsc-menu-item{padding:7px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;}',
        '.dsc-menu-item:hover{background:#F5F0E8;}',
        '.dsc-restore{position:fixed;right:16px;bottom:16px;width:46px;height:46px;border-radius:50%;background:#D97757;border:2px solid #3D2A20;box-shadow:0 2px 10px rgba(61,42,32,.25);cursor:pointer;pointer-events:auto;z-index:2147483000;display:flex;align-items:center;justify-content:center;}',
        '.dsc-restore canvas{width:30px;height:30px;image-rendering:pixelated;}'
      ].join('');

      var cssInjected = false;
      function injectCss() {
        if (cssInjected || typeof document === 'undefined') return;
        cssInjected = true;
        var el = document.createElement('style');
        el.textContent = CSS;
        document.head.appendChild(el);
      }

      function drawGrid(ctx, grid) {
        ctx.clearRect(0, 0, GRID, GRID);
        for (var r = 0; r < GRID; r++) {
          for (var c = 0; c < GRID; c++) {
            var ch = grid[r][c];
            if (ch === '.' || ch === ' ') continue;
            var color = PALETTE[ch];
            if (!color) continue;
            ctx.fillStyle = color;
            ctx.fillRect(c, r, 1, 1);
          }
        }
      }

      function loadSave() {
        try {
          var raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return null;
          return JSON.parse(raw);
        } catch (e) {
          return null;
        }
      }
      function writeSave(s) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        } catch (e) { /* 隐私模式等场景忽略 */ }
      }

      function ClawdApp() {
        var rootRef = React.useRef(null);
        var petRef = React.useRef(null);
        var canvasRef = React.useRef(null);
        var shadowRef = React.useRef(null);
        var bubbleTimerRef = React.useRef(null);
        var menuRef = React.useRef(null);

        var save0 = React.useMemo(loadSave, []);
        var initialScale = (save0 && save0.scale) || 3; // 默认 3×（72px），像素风整数缩放更清晰

        var bubbleState = React.useState(null);
        var bubble = bubbleState[0];
        var setBubble = bubbleState[1];
        var menuState = React.useState(null);
        var menu = menuState[0];
        var setMenu = menuState[1];
        var snapshotRef = React.useRef(null); // 最新 /state 快照（双击时读余额/用量）
        var hiddenState = React.useState(Boolean(save0 && save0.hidden));
        var hidden = hiddenState[0];
        var setHidden = hiddenState[1];
        var asleepState = React.useState(Boolean(save0 && save0.asleep));
        var asleep = asleepState[0];
        var setAsleep = asleepState[1];
        var scaleState = React.useState(initialScale);
        var scale = scaleState[0];
        var setScale = scaleState[1];

        var st = React.useRef({
          x: (save0 && save0.x) || 60,
          y: (save0 && save0.y) || 120,
          vx: 0, vy: 0,
          mood: 'idle',
          prevMood: 'idle',
          frame: 0,
          tickAcc: 0,
          facing: 1,
          dragging: false,
          moved: 0,
          airborne: true,
          onFloor: false,
          animUntil: 0,
          blinkUntil: 2000,
          nextWander: 6000,
          nextChatter: 20000,
          nextSave: 5000,
          lastActivity: 0,
          lastState: null,
          lastTask: null,
          grabDX: 0, grabDY: 0,
          samples: [],
          squashUntil: 0,
          saidHello: false
        });

        function bubbleSay(text, ms) {
          if (!text) return;
          setBubble({ text: text, id: Date.now() + Math.random() });
          if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
          bubbleTimerRef.current = setTimeout(function () { setBubble(null); }, ms || 3800);
        }

        function setMood(mood, untilMs) {
          var s = st.current;
          if (s.mood === mood) return;
          s.prevMood = s.mood;
          s.mood = mood;
          s.frame = 0;
          s.tickAcc = 0;
          s.animUntil = untilMs || 0;
        }

        function applyWorkState(rawState, task, force) {
          var s = st.current;
          if (!force && rawState === s.lastState) return;
          var changed = rawState !== s.lastState;
          s.lastState = rawState;
          s.lastTask = task;
          if (asleepRef.current) return; // 睡觉时只记录
          var mood = rawState ? MOOD_BY_STATE[rawState] : null;
          if (mood === 'wait') {
            setMood('think');
            if (changed) bubbleSay(pick(QUIPS.wait));
          } else if (mood === 'think') {
            setMood('think');
            if (changed) bubbleSay(pick(QUIPS.think));
          } else if (mood === 'work') {
            setMood('work');
            if (changed) bubbleSay(task ? ('在弄：' + task) : pick(QUIPS.work));
          } else if (mood === 'success') {
            setMood('success', Date.now() + 2600);
            if (changed) bubbleSay(pick(QUIPS.success));
          } else if (mood === 'error') {
            setMood('error', Date.now() + 3200);
            if (changed) bubbleSay(pick(QUIPS.error));
          } else {
            setMood('idle');
          }
        }

        // —— 主循环 ——
        React.useEffect(function () {
          injectCss();
          var s = st.current;
          s.lastActivity = Date.now();
          if (asleepRef.current) s.mood = 'sleep'; // 带着睡意醒来

          function size() {
            var viewW = window.innerWidth || document.documentElement.clientWidth;
            var viewH = window.innerHeight || document.documentElement.clientHeight;
            var W = viewW - GRID * scaleRef.current;
            var floor = viewH - GRID * scaleRef.current - 4;
            s.x = Math.max(0, Math.min(W, s.x));
            s.y = Math.max(0, Math.min(floor, s.y));
            return { W: W, floor: floor };
          }

          var raf = null;
          var lastT = performance.now();

          function loop(now) {
            raf = requestAnimationFrame(loop);
            var dt = Math.min(50, now - lastT);
            lastT = now;
            var sc = scaleRef.current;
            var S = GRID * sc;
            var box = size();

            // —— 精灵帧推进 ——
            s.tickAcc += dt;
            var frames = FRAMES[s.mood].frames;
            while (s.tickAcc >= TICK_MS) {
              s.tickAcc -= TICK_MS;
              s.frame = (s.frame + 1) % frames.length;
              var def = FRAMES[s.mood];
              if (s.mood === 'success' || s.mood === 'error' || s.mood === 'happy' || s.mood === 'eat') {
                if (s.animUntil && now > s.animUntil) {
                  setMood('idle');
                  frames = FRAMES[s.mood].frames;
                  def = FRAMES[s.mood];
                }
              }
              if (s.mood === 'blink' && s.animUntil && now > s.animUntil) {
                setMood('idle');
                frames = FRAMES[s.mood].frames;
                def = FRAMES[s.mood];
              }
            }

            // —— 物理 ——
            if (!s.dragging) {
              if (s.mood === 'walk') {
                s.vx = s.facing * SPEED_WALK;
              }
              s.vy = Math.min(12, s.vy + GRAVITY);
              s.x += s.vx;
              s.y += s.vy;
              if (s.x < 0) { s.x = 0; s.vx = Math.abs(s.vx) * 0.5; if (s.mood === 'walk') s.facing = 1; }
              if (s.x > box.W) { s.x = box.W; s.vx = -Math.abs(s.vx) * 0.5; if (s.mood === 'walk') s.facing = -1; }
              if (s.y < 0) { s.y = 0; s.vy = Math.abs(s.vy) * 0.4; }
              var wasAir = !s.onFloor;
              if (s.y >= box.floor) {
                s.y = box.floor;
                if (s.vy > 1.5) {
                  s.vy = -s.vy * BOUNCE;
                  s.squashUntil = now + 140;
                  if (s.mood === 'drag') setMood('idle');
                } else {
                  s.vy = 0;
                  s.vx *= 0.94;
                  if (s.mood === 'drag' && now > 120) setMood('idle');
                }
                s.onFloor = true;
              } else {
                s.onFloor = false;
                s.vx *= 0.995;
                if (!wasAir && s.mood === 'idle') setMood('drag'); // 掉落时手脚乱蹬
              }

              // —— 发呆时的小动作 ——
              if (s.mood === 'idle' && s.onFloor) {
                if (now > s.blinkUntil) {
                  setMood('blink', now + 180);
                  s.blinkUntil = now + 2500 + Math.random() * 5000;
                } else if (now > s.nextWander && !asleepRef.current) {
                  if (Math.random() < 0.4) {
                    s.facing = Math.random() < 0.5 ? 1 : -1;
                    setMood('walk', now + 1400 + Math.random() * 2600);
                  }
                  s.nextWander = now + 6000 + Math.random() * 12000;
                }
              } else if (s.mood === 'walk' && s.animUntil && now > s.animUntil) {
                setMood('idle');
              }

              // —— 自动睡觉（5 分钟没动静）——
              if (!asleepRef.current && s.mood === 'idle' && s.onFloor && now - s.lastActivity > 300000) {
                setAsleepState(true);
              }

              // —— 闲时碎碎念 ——
              if (!asleepRef.current && (s.mood === 'idle' || s.mood === 'walk') && now > s.nextChatter) {
                if (Math.random() < 0.35) bubbleSay(pick(QUIPS.idle), 4200);
                s.nextChatter = now + 35000 + Math.random() * 55000;
              }

              // —— 定期存档 ——
              if (now > s.nextSave) {
                s.nextSave = now + 5000;
                persistNow();
              }
            }

            // —— 绘制 ——
            var canvas = canvasRef.current;
            if (canvas) {
              var ctx = canvas.getContext('2d');
              var grid = frames[Math.min(s.frame, frames.length - 1)];
              ctx.save();
              if (s.facing === -1) {
                ctx.translate(GRID, 0);
                ctx.scale(-1, 1);
              }
              drawGrid(ctx, grid);
              ctx.restore();
            }
            var pet = petRef.current;
            if (pet) {
              pet.style.width = S + 'px';
              pet.style.height = S + 'px';
              var squash = s.squashUntil && now < s.squashUntil ? 0.86 : 1;
              pet.style.transform = 'translate(' + s.x + 'px,' + s.y + 'px) scaleY(' + squash + ')';
            }
            var shadow = shadowRef.current;
            if (shadow) {
              var h = Math.max(0, box.floor + GRID * sc - (s.y + GRID * sc));
              var ratio = 1 - Math.min(1, h / (GRID * sc * 2));
              shadow.style.width = Math.round((8 + 10 * ratio) * sc) + 'px';
              shadow.style.opacity = String(0.12 + 0.14 * ratio);
            }
          }

          raf = requestAnimationFrame(loop);
          return function () {
            if (raf) cancelAnimationFrame(raf);
            persistNow();
            if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
          };
        }, []); // 仅挂载一次；loop 内部读取 ref 取最新 scale/asleep

        // —— 轮询宿主 /state ——
        React.useEffect(function () {
          var stopped = false;
          function poll() {
            fetch(ROUTE + '/state', { cache: 'no-store' })
              .then(function (r) { return r.json(); })
              .then(function (s) {
                if (stopped || !s || s.ok === false) return;
                applyWorkState(s.state || null, s.task || null, false);
                snapshotRef.current = s;
              })
              .catch(function () { /* 宿主未就绪时静默 */ });
          }
          poll();
          var timer = setInterval(poll, 1500);
          return function () { stopped = true; clearInterval(timer); };
        }, []);

        // —— 睡觉 / 唤醒联动 ——
        var asleepRef = React.useRef(asleep);
        asleepRef.current = asleep;
        var setAsleepState = function (v) {
          setAsleep(v);
          var s = st.current;
          if (v) {
            setMood('sleep');
            bubbleSay(pick(QUIPS.doze), 2600);
          } else {
            s.lastActivity = Date.now();
            if (s.mood === 'sleep') setMood('idle');
            bubbleSay(pick(QUIPS.wake));
          }
          persistNow();
        };
        var setAsleepNow = function (v) {
          setAsleepState(v);
        };
        var toggleAsleep = function () { setAsleepNow(!asleepRef.current); };

        var scaleRef = React.useRef(scale);
        scaleRef.current = scale;
        function persistNow() {
          var s = st.current;
          writeSave({ x: Math.round(s.x), y: Math.round(s.y), scale: scaleRef.current, hidden: hiddenRef.current, asleep: asleepRef.current });
        }
        var hiddenRef = React.useRef(hidden);
        hiddenRef.current = hidden;

        // —— 菜单外部点击 / Esc 关闭 ——
        React.useEffect(function () {
          if (!menu) return undefined;
          function onDoc(e) {
            if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null);
          }
          function onKey(e) {
            if (e.key === 'Escape') setMenu(null);
          }
          document.addEventListener('pointerdown', onDoc, true);
          document.addEventListener('keydown', onKey);
          return function () {
            document.removeEventListener('pointerdown', onDoc, true);
            document.removeEventListener('keydown', onKey);
          };
        }, [menu]);

        // —— 首次问候 ——
        React.useEffect(function () {
          if (st.current.saidHello) return;
          st.current.saidHello = true;
          setTimeout(function () { bubbleSay(QUIPS.hello, 4000); }, 800);
        }, []);

        // —— 交互 ——
        function onPointerDown(e) {
          var s = st.current;
          s.lastActivity = Date.now();
          setMenu(null);
          if (e.button === 2) return; // 右键交给 contextmenu
          if (asleepRef.current) setAsleepNow(false); // 一把抓住就醒来
          try { petRef.current && petRef.current.setPointerCapture(e.pointerId); } catch (err) {}
          s.dragging = true;
          s.moved = 0;
          s.grabDX = e.clientX - s.x;
          s.grabDY = e.clientY - s.y;
          s.samples = [{ t: performance.now(), x: e.clientX, y: e.clientY }];
          setMood('drag');
        }
        function onPointerMove(e) {
          var s = st.current;
          if (!s.dragging) return;
          var box = sizeNow();
          s.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
          s.x = e.clientX - s.grabDX;
          s.y = Math.min(box.floor, e.clientY - s.grabDY);
          s.vx = 0; s.vy = 0;
          s.samples.push({ t: performance.now(), x: e.clientX, y: e.clientY });
          if (s.samples.length > 4) s.samples.shift();
        }
        function onPointerUp(e) {
          var s = st.current;
          if (!s.dragging) return;
          s.dragging = false;
          s.lastActivity = Date.now();
          try { petRef.current && petRef.current.releasePointerCapture(e.pointerId); } catch (err) {}
          var a = s.samples[0];
          var b = s.samples[s.samples.length - 1];
          var dtMs = Math.max(16, b.t - a.t);
          var vx = (b.x - a.x) / dtMs * 16;
          var vy = (b.y - a.y) / dtMs * 16;
          var speed = Math.sqrt(vx * vx + vy * vy);
          if (speed > THROW_MIN) {
            s.vx = Math.max(-13, Math.min(13, vx));
            s.vy = Math.max(-13, Math.min(13, vy));
            s.onFloor = false;
            bubbleSay(pick(QUIPS.fly), 2000);
          } else {
            s.vx = 0; s.vy = 0;
            setMood('idle');
          }
          persistNow();
        }
        function onClick(e) {
          if (st.current.moved > 6) return; // 拖拽不算点击
          setMood('happy', Date.now() + 1400);
          bubbleSay(pick(QUIPS.click));
        }
        function onDoubleClick(e) {
          var s = st.current;
          s.lastActivity = Date.now();
          setMood('happy', Date.now() + 1400);
          bubbleSay(ledgerLines(snapshotRef.current), 8000); // 覆盖当前气泡，直接显示余额+会话两行
        }
        function onContextMenu(e) {
          e.preventDefault();
          var x = Math.min(e.clientX, (window.innerWidth || 0) - 180);
          var y = Math.min(e.clientY, (window.innerHeight || 0) - 260);
          setMenu({ x: Math.max(8, x), y: Math.max(8, y) });
        }

        function sizeNow() {
          var viewW = window.innerWidth || document.documentElement.clientWidth;
          var viewH = window.innerHeight || document.documentElement.clientHeight;
          return { W: viewW - GRID * scaleRef.current, floor: viewH - GRID * scaleRef.current - 4 };
        }

        function menuItems() {
          var items = [
            { label: '💬 说句话', fn: function () { setMood('happy', Date.now() + 1400); bubbleSay(pick(QUIPS.click)); } },
            { label: '🍪 吃个 token', fn: function () { setMood('eat', Date.now() + 900); bubbleSay(pick(QUIPS.eat)); } },
            { label: '🧾 余额 / 用量', fn: function () { setMood('happy', Date.now() + 1400); bubbleSay(ledgerLines(snapshotRef.current), 8000); } },
            { label: asleepRef.current ? '😃 起床' : '😴 睡觉', fn: toggleAsleep },
            { label: '📐 大小 ×' + scaleRef.current, fn: function () { var i = SCALES.indexOf(scaleRef.current); if (i < 0) i = 3; var n = SCALES[(i + 1) % SCALES.length]; setScale(n); persistNow(); } },
            { label: '🧭 回到底部', fn: function () { var s = st.current; s.y = sizeNow().floor; s.vx = 0; s.vy = 0; setMood('idle'); persistNow(); } },
            { label: '🙈 藏起来', fn: function () { setHidden(true); persistNow(); } }
          ];
          return items;
        }

        function showRestore() {
          setHidden(false);
        }

        if (hidden) {
          return React.createElement('div', { className: 'dsc-root' },
            React.createElement('div', {
              className: 'dsc-restore',
              title: '把 Clawd 叫出来',
              onClick: showRestore
            },
            React.createElement(RestoreCanvas)));
        }

        var menuEl = null;
        if (menu) {
          menuEl = React.createElement('div', {
            className: 'dsc-menu',
            style: { left: menu.x, top: menu.y },
            ref: menuRef,
            onPointerDown: function (e) { e.stopPropagation(); }
          },
          menuItems().map(function (it, i) {
            return React.createElement('div', {
              key: i,
              className: 'dsc-menu-item',
              onClick: function () { setMenu(null); it.fn(); }
            }, it.label);
          }));
        }

        var bubbleEl = null;
        if (bubble) {
          bubbleEl = React.createElement('div', { key: bubble.id, className: 'dsc-bubble' }, bubble.text);
        }

        return React.createElement('div', {
          className: 'dsc-root',
          ref: rootRef,
          style: { pointerEvents: 'none' }
        },
        React.createElement('div', {
          className: 'dsc-pet',
          ref: petRef,
          style: { pointerEvents: 'auto', transform: 'translate(' + (st.current.x) + 'px,' + (st.current.y) + 'px)' },
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
          onPointerUp: onPointerUp,
          onClick: onClick,
          onDoubleClick: onDoubleClick,
          onContextMenu: onContextMenu
        },
        React.createElement('canvas', { ref: canvasRef, width: GRID, height: GRID }),
        React.createElement('div', { className: 'dsc-shadow', ref: shadowRef }),
        bubbleEl),
        menuEl);
      }

      // 隐藏后的召回按钮：画个星芒小头像
      function RestoreCanvas() {
        var ref = React.useRef(null);
        React.useEffect(function () {
          var canvas = ref.current;
          if (!canvas) return;
          var ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, GRID, GRID);
          var grid = FRAMES.idle.frames[0];
          ctx.save();
          ctx.translate(GRID, 0);
          ctx.scale(-1, 1);
          drawGrid(ctx, grid);
          ctx.restore();
        }, []);
        return React.createElement('canvas', { ref: ref, width: GRID, height: GRID });
      }

      function apply(ctx) {
        ctx.slots.inject('shell.overlay', function* () {
          yield ctx.slots.register({ name: 'shell.overlay', id: 'clawd', order: 1000 }, function ClawdOverlay() {
            return React.createElement(ClawdApp);
          });
        });
      }

      return {
        inject: ['slots'],
        name: 'clawd',
        apply: apply
      };
    }
  });
})();
