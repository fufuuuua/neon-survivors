# AGENTS.md · AI 协作指南

> 面向 AI 助手 / 未来的自己：读完这一份即可上手，无需重新扫全项目。
> 项目本体面向玩家的说明在 [`README.md`](./README.md)，本文只写「代码/架构层面必要的事」。

---

## 项目一句话
纯原生 HTML5 + Canvas + ES Modules 的 roguelite 生存射击小游戏，**零第三方依赖、零美术/音频资源文件**（视觉全部 Canvas 程序绘制，音效全部 Web Audio 实时合成）。

---

## 目录速览

```
neon-survivors/
├── index.html          # 入口页, 加载 css + js/main.js
├── package.json        # dev/build 脚本, 无运行时依赖
├── build.mjs           # 自制单文件打包器 -> dist/
├── css/style.css       # 唯一样式文件, 霓虹故障风格
└── js/
    ├── main.js         # 装配 Game, 启动主循环
    ├── config.js       # 【单一数据源】所有可调数值 + GameState 枚举
    ├── utils/          # Vector2, math (rand/choice/clamp/formatTime/TAU)
    ├── core/           # 引擎层, 与玩法解耦
    │   ├── Game.js         # 中介者/状态机/主循环, 是最大的类, 请谨慎重构
    │   ├── Input.js        # 键盘 + 触摸虚拟摇杆
    │   ├── AudioFx.js      # Web Audio 程序化音效
    │   ├── Camera.js       # 跟随 + 屏震
    │   ├── Pool.js         # 通用对象池 (active 列表 + 空闲栈)
    │   ├── SpatialGrid.js  # 敌人空间网格 (每帧重建)
    │   ├── GlowCache.js    # 发光精灵缓存, 替代 shadowBlur 提高性能
    │   ├── ParticleSystem.js # 粒子 + 浮动文字 (对象池)
    │   ├── SaveData.js     # localStorage 存档 (按 userId 分区)
    │   └── Account.js      # 玩家档案 (多账号)
    ├── entities/       # Player / Enemy / Projectile / XPGem
    ├── systems/        # 玩法系统
    │   ├── SpawnSystem.js       # 生成/难度爬升/Boss
    │   ├── CollisionSystem.js   # 走 SpatialGrid
    │   ├── UpgradeSystem.js     # 局内升级三选一
    │   ├── MetaProgression.js   # 局外强化实验室 (◆ 暗物质核心)
    │   ├── Skins.js             # 机库外观 + 抽卡 + 星级 + 造型绘制 (drawShip)
    │   └── Codex.js             # 图鉴: 发现记录 + 里程碑奖励
    └── ui/
        ├── HUD.js       # Canvas 内 HUD (血条/经验/技能盘/Boss 血条)
        └── Screens.js   # DOM 覆盖界面 (菜单/商店/机库/图鉴/结算)
```

---

## 关键架构约定

1. **单一数据源**：所有平衡数值集中在 `config.js`。改敌人属性/武器数值只改这里, 不要在实体里写魔法数字。
2. **实体 / 系统解耦**：实体不直接引用彼此, 通过 `game` 中介者提供的服务方法（`spawnProjectile / damageEnemy / findNearestEnemy / spawnGem / addBeam / spawnEnemyProjectile / screenFlash / slowmo`）交互。
3. **对象池**：`enemies / projectiles / enemyBullets / gems` 都是 `Pool`。**不要 new 敌人/子弹**, 用 `game.spawnEnemy / spawnProjectile / spawnGem / spawnEnemyProjectile`。回收在 `_pool.reclaim()`（主循环末尾）。
4. **状态机**：`GameState = MENU / SHOP / HANGAR / CODEX / PLAYING / LEVELUP / PAUSED / GAMEOVER`。加新界面要顺手加状态。
5. **视图分层**：Canvas 只画高频画面（世界/HUD/粒子）；可交互按钮/卡片走 DOM (`Screens.js` + `css/style.css`)。**别把菜单画到 canvas 里**。
6. **主循环时间**：`update` 的 `dt` 已应用 `timeScale`（慢动作演出）。粒子/闪屏用 `rawDt`。UI/图鉴按钮同步等副作用放 `render` 前。

---

## 存档 (`SaveData.js`)

- key 格式：`neondrift.save.v1:${userId}`（元数据）+ `neondrift.run.v1:${userId}`（对局快照, 用于续玩）。
- 结构（顶层字段）：`cores / upgrades / best / totals / skins / codex`。
- **严格校验**：加载时对每个字段做类型 + 数值 + 长度校验, 拒绝任意 JSON。加新字段时**必须**在 `defaults()` 和 `load()` 里同时处理, 否则老存档字段会丢。
- 存档破坏性变更需要提升版本号（当前 `v1`）并写迁移。当前尚无 `v2`。

---

## 已知的 UI 坑（血泪教训, 请务必遵守）

1. **`.screen` 有 `backdrop-filter: blur(2px)`**：在这上面做子元素结构变动（`innerHTML` 替换、`display` 切换、DOM 增删）会让浏览器**重算整块背板模糊**, 视觉上就是"整屏闪一下"。
   - 装备切换 / 图鉴领取 / 商店购买这类**局部状态更新**, 必须走"改按钮 `textContent` + `classList.toggle`, 不动 DOM 结构"的路子。
   - 需要更彻底解决时, 对当前 screen 加 `backdrop-filter: none;`（已应用于 `.hangar-screen` 和 `.codex-screen`）。
2. **禁止在局部交互里整页 `this.clear() + showXxx` 重建**（除非确实要换 screen）。
3. **CSS 缓存**：改 `css/style.css` 后浏览器可能缓存, 用 `Cmd+Shift+R` 硬刷新, 不然会看到旧样式导致的诡异现象。

---

## Game.js 中的关键"埋点位置"（新增/改动时对号入座）

| 事件 | 位置 |
|------|------|
| 首次遭遇敌人/Boss | `spawnEnemy()` -> `Codex.discover(save, "enemies"|"bosses", type)` |
| 拾取到某类道具 (HEAL/BOMB/MAGNET) | `spawnGem()` -> `Codex.discover(save, "items", type)` |
| 武器解锁 (unlock_xxx 升级项) | `_applyUpgrade()` -> `Codex.discover(save, "weapons", id.slice(7))` |
| 玩家默认武器 (blaster) | `start()` -> `Codex.discover(save, "weapons", "blaster")` |
| 主动技能触发 | 按键 `" "` -> `player.releaseActiveSkill(this)` |
| 按暂停 | 按键 `p` / `escape` 或屏上 `.pause-fab` |

## 主动技能通道

- 只有装备了 `activeSkill` 字段被 `perk` 注入的皮肤才有主动技能（目前只有图鉴 100% 奖励的 `omniscient`）。
- 皮肤 `perk` 里写：`p.activeSkill = { id, name, icon, cooldown, timer: 0 }`。
- 效果实现全部写在 `Player.releaseActiveSkill(game)`, **不要**把效果写在 Skins 表里。冷却按 `player.cooldownMul` 缩放。
- HUD 右下角有冷却圆盘（`HUD._activeSkill`）; 触摸设备额外有 `.skill-fab` 按钮（`Game._createSkillButton / _syncSkillBtn`）。
- 续玩恢复：`_resumeRun` 里用 probe 对象跑一遍当前皮肤 `perk`, 只挑出 `activeSkill` 恢复, 不重复注入数值加成。

---

## 常见扩展任务

- **加新敌人**：`config.enemies` 加条目 → `Enemy._poly` / `_boss` 里加造型分支 → `SpawnSystem` 权重表纳入。
- **加新武器**：`config.weapons` 加配置 → `Player._updateWeapons` 加触发逻辑 → `UpgradeSystem.UPGRADES` 加解锁+进阶项 → 顺手让 `UpgradeSystem.describeLoadout` 认识它。
- **加新皮肤**：`Skins.SKINS` 加条目（`shape / rarity / perk / perkText`）→ `Skins.drawShip` 补 `shape` 分支。如果不希望进抽卡池, 加 `hidden: true`。
- **加新界面**：`Screens.showXxx` 方法 + `Game._openXxx` + `GameState.XXX` 枚举。菜单入口在 `Screens.showMenu` 的按钮组。**图鉴/机库这种局部有交互切换的**, 在 CSS 里给该 screen 关掉 `backdrop-filter`。
- **加新里程碑/图鉴条目**：`Codex.MILESTONES` 加档次；分类由 `CONFIG.enemies / CONFIG.weapons` 自动派生, 一般不用手动维护条目表。

---

## 命令

```bash
npm run dev         # 起本地 http server (127.0.0.1:8000), Ctrl+C 会杀干净
npm run build       # 生成 dist/neon-drift.html (单文件) + dist/index.html (分离版)
npm run serve:dist  # 8000 端口预览 dist/
```

`dev` 脚本用了 `trap 'kill 0' EXIT INT TERM`, 一般不会残留孤儿 python。若真占用了 8000：
```bash
lsof -ti:8000 | xargs kill
```

---

## 代码风格

- ES Modules, 不引任何第三方库。
- 类方法首选箭头函数 / 直接方法, 少用 `bind`。
- 私有方法 `_underscorePrefix`。常量 `SCREAMING_SNAKE`。
- 注释用中文, 避免解释显而易见的语句, 优先解释"为什么"、"平衡性考量"、"性能/兼容坑"。
- **谨记**：Chinese punctuation 保持原样（"" 「」 、 ·），不要转半角。

---

## 安全

- 存档全部本地 localStorage, 无网络请求。加载时不信任任何字段, 逐一校验。
- 若加账号/云同步, `Account.js` 用户 id 已规范为 `[A-Za-z0-9_-]`, 可直接拼 KV key。
- 前端注入的 HTML 若来自用户输入（如昵称）**必须**过 `Screens.esc()`。
