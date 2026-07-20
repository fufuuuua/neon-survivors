/**
 * Screens.js — 基于 DOM 的覆盖界面管理（主菜单 / 升级选择 / 暂停 / 结算）。
 * 与 Canvas 内的 HUD 分离：DOM 适合处理可交互按钮与卡片，Canvas 负责高频游戏渲染。
 */
import { formatTime } from "../utils/math.js";
import { UpgradeSystem } from "../systems/UpgradeSystem.js";
import { MetaProgression } from "../systems/MetaProgression.js";
import { Skins, RARITY, MAX_STAR } from "../systems/Skins.js";
import { Codex } from "../systems/Codex.js";
import { Campaign } from "../systems/Campaign.js";

/** HTML 转义：防止用户输入的昵称 / ID 破坏 DOM 结构或注入脚本 */
function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export class Screens {
  constructor(root) {
    this.root = root;
    // 是否为触摸为主的设备（移动端）：用于隐藏键盘相关提示
    this.isTouch = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  }

  clear() { this.root.innerHTML = ""; }

  _make(html, extra = "") {
    const div = document.createElement("div");
    div.className = extra ? `screen ${extra}` : "screen";
    div.innerHTML = html;
    return div;
  }

  /** 构建“当前能力总览”面板 HTML（武器 + 被动），用于升级/暂停界面 */
  _loadoutHTML(player, title = "当前装备") {
    const { weapons, passives } = UpgradeSystem.describeLoadout(player);
    const row = (it) => `
      <div class="lo-row">
        <span class="lo-icon" style="color:${it.accent}">${it.icon}</span>
        <span class="lo-name">${it.name}</span>
        <span class="lo-detail">${it.detail}</span>
      </div>`;
    const passiveHTML = passives.length
      ? `<div class="lo-sep">被动强化</div>${passives.map(row).join("")}`
      : "";
    return `
      <div class="loadout">
        <div class="lo-title">${title}</div>
        ${weapons.map(row).join("")}
        ${passiveHTML}
      </div>`;
  }

  /** 主菜单 */
  showMenu(save, user, { onStart, onResume, onCampaign, onShop, onHangar, onCodex, onCloud, onLeaderboard, onFeedback }) {
    this.clear();
    const b = save.best;
    // user 现在直接携带云端登录信息(由 Game 组装): { name, isLoggedIn }.
    // 已登录云账号时显示昵称 + "☁ 云同步 ▸"; 未登录时提示玩家去云同步注册, 点击都跳云同步页.
    const isLogged = !!(user && user.isLoggedIn);
    const userBar = user
      ? `
      <div class="user-bar user-bar-${isLogged ? "linked" : "guest"}" id="user-bar" title="${isLogged ? "查看云同步 / 切换账号" : "点击注册云账号"}">
        <span class="user-ic">${isLogged ? "☁" : "👤"}</span>
        <span class="user-name">${esc(user.name || "未登录")}</span>
        <span class="user-switch">${isLogged ? "云同步 ▸" : "去登录 ▸"}</span>
      </div>`
      : "";
    // 主行按钮:
    //  - 有续玩快照: [继续上局] + [重新开始], 两颗并列
    //  - 无续玩快照: 单独一颗 [开始游戏]
    // 次要行(第二排): 机库 / 强化实验室 / 图鉴
    // 颜色语义:
    //  · 开始游戏 -> 品红 (btn-primary, 与游戏主强调色一致)
    //  · 重新开始 -> 青 (btn-restart, 与"继续上局"区分, 视觉降级)
    //  · 继续上局 -> 品红 (与开始游戏同级, 都是主行动)
    // 有续玩存档时: 三按钮同排(继续上局=品红 / 重新开始=青 / 闯关=玫粉).
    // 无续玩时: 首行 [开始游戏 + 闯关模式] 并列, 两个都是主入口.
    const primaryRow = onResume
      ? `
        <button class="btn btn-primary" id="btn-resume">↩ 继续上局</button>
        <button class="btn btn-restart" id="btn-start">▶ 重新开始</button>
        <button class="btn btn-campaign" id="btn-campaign">◈ 闯关模式</button>
      `
      : `
        <button class="btn btn-primary" id="btn-start">▶ 开始游戏</button>
        <button class="btn btn-campaign" id="btn-campaign">◈ 闯关模式</button>
      `;
    const el = this._make(`
      ${userBar}
      <button class="feedback-fab" id="btn-feedback" title="反馈 / 留言">💬</button>
      <div class="sub">ROGUELITE · SURVIVOR · 霓虹幸存者</div>
      <h1 class="neon-title">NEON DRIFT</h1>
      <div class="cores-balance">
        <span class="cur"><span class="cur-core">◆ ${save.cores}</span> <span class="lbl">暗物质核心</span></span>
        <span class="cur-sep">·</span>
        <span class="cur"><span class="shard-amt">✦ ${save.skins.shards}</span> <span class="lbl">棱牌</span></span>
      </div>
      <div class="best-row">
        <span>最佳存活 <b>${formatTime(b.time)}</b></span>
        <span>最高击杀 <b>${b.kills}</b></span>
        <span>最高等级 <b>${b.level}</b></span>
        <span>击败母核 <b>${b.bossKills}</b></span>
      </div>
      <div class="menu-btns menu-primary">${primaryRow}</div>
      <div class="menu-btns menu-secondary">
        <button class="btn btn-3" id="btn-shop">◆ 强化实验室</button>
        <button class="btn btn-4" id="btn-hangar">✦ 机库</button>
        <button class="btn btn-codex" id="btn-codex">▤ 图鉴</button>
      </div>
      <div class="menu-btns menu-cloud">
        <button class="btn btn-rank" id="btn-rank">🏆 排行榜</button>
      </div>
      <div class="hint">${this.isTouch
        ? "拖动屏幕移动 · 点击右上角按钮暂停<br>武器自动开火"
        : "移动: W A S D / 方向键 &nbsp;·&nbsp; 暂停: P / ESC &nbsp;·&nbsp; 武器自动开火"}</div>
    `, "menu-screen");
    this.root.appendChild(el);
    el.querySelector("#btn-start").addEventListener("click", onStart);
    el.querySelector("#btn-shop").addEventListener("click", onShop);
    el.querySelector("#btn-hangar").addEventListener("click", onHangar);
    if (onCodex) el.querySelector("#btn-codex").addEventListener("click", onCodex);
    if (onCampaign) el.querySelector("#btn-campaign").addEventListener("click", onCampaign);
    if (onResume) el.querySelector("#btn-resume").addEventListener("click", onResume);
    if (onLeaderboard) el.querySelector("#btn-rank").addEventListener("click", onLeaderboard);
    if (onFeedback) el.querySelector("#btn-feedback").addEventListener("click", onFeedback);
    // 顶部 user-bar 点击直接进云同步页(注册/登录/查看). 本地多账号入口已弃用: 一台设备只有一个玩家.
    if (onCloud) {
      const bar = el.querySelector("#user-bar");
      if (bar) bar.addEventListener("click", onCloud);
    }
  }

  /** 星级点：已得实心 ★ / 未得空心 ☆，n<0 表示尚未通关 */
  _starRow(n, total = 3) {
    let s = "";
    for (let i = 0; i < total; i++) s += i < n ? "★" : "☆";
    return s;
  }

  /**
   * 闯关模式选关界面：按章节列出关卡卡片，展示解锁状态与已得星数。
   * onPlay(ci, li) 进入某关；onBack 返回主菜单。
   */
  showCampaign(save, { onPlay, onBack }) {
    this.clear();
    const chapters = Campaign.chapters();
    const total = Campaign.totalStars(save);

    const chapHTML = chapters.map((ch, ci) => {
      const unlocked = Campaign.chapterUnlocked(save, ci);
      const got = Campaign.chapterStars(save, ci);
      const max = Campaign.chapterMaxStars(ci);
      const c = ch.theme || {};
      const glow = c.glow || "#00f0ff";
      const lockHint = unlocked ? "" : `需上一章累计 ${ch.reqStars} ★ 解锁`;

      const levelCards = ch.levels.map((lv, li) => {
        const coming = Campaign.isComing(lv);
        const lvUnlocked = !coming && Campaign.levelUnlocked(save, ci, li);
        const stars = Campaign.stars(save, lv.id); // -1 未通关
        const cleared = stars >= 0;
        const isBoss = Campaign.isBoss(lv);
        let cls = "lvl-card";
        if (isBoss) cls += " lvl-boss";
        if (coming) cls += " lvl-coming";
        else if (!lvUnlocked) cls += " lvl-locked";
        else if (cleared) cls += " lvl-cleared";
        // Boss 关用「☠」徽标; 其余按状态显示
        const badge = coming ? "🚧"
          : (!lvUnlocked ? "🔒"
          : (isBoss ? "☠"
          : (cleared ? "✔" : "▶")));
        const starsHTML = coming
          ? `<span class="lvl-soon">敬请期待</span>`
          : `<span class="lvl-stars">${this._starRow(stars)}</span>`;
        return `
          <button class="${cls}" data-ci="${ci}" data-li="${li}"
            ${(coming || !lvUnlocked) ? "disabled" : ""}
            style="--glow:${isBoss ? "#ff2bd6" : glow}">
            <span class="lvl-id">${esc(lv.id)}</span>
            <span class="lvl-badge">${badge}</span>
            <span class="lvl-name">${esc(lv.name)}</span>
            ${starsHTML}
          </button>`;
      }).join("");

      return `
        <div class="chapter ${unlocked ? "" : "chapter-locked"}" style="--glow:${glow}">
          <div class="chapter-head">
            <div class="chapter-title">
              <span class="chapter-idx">CH.${ch.id}</span>
              <span class="chapter-name">${esc(ch.name)}</span>
              <span class="chapter-sub">${esc(ch.sub || "")}</span>
            </div>
            <div class="chapter-prog">${unlocked ? `★ ${got}/${max}` : `🔒 ${esc(lockHint)}`}</div>
          </div>
          <div class="chapter-intro">${esc(ch.intro || "")}</div>
          <div class="lvl-grid">${levelCards}</div>
        </div>`;
    }).join("");

    const el = this._make(`
      <div class="sub">CAMPAIGN · 闯关模式</div>
      <h2 class="neon-title">星轨试炼</h2>
      <div class="cores-balance"><span class="cur-core-amt">★ ${total}</span> <span class="lbl">累计星星</span></div>
      <div class="campaign-list">${chapHTML}</div>
      <button class="btn" id="btn-back">← 返回</button>
      <div class="hint">${this.isTouch
        ? "拖动屏幕沿通道飞向终点 · 沿途收集能量星 · 别撞出通道"
        : "移动: W A S D / 方向键 &nbsp;·&nbsp; 沿通道飞向终点 · 收集能量星 · P/ESC 退出"}</div>
    `, "campaign-screen");
    this.root.appendChild(el);

    el.querySelectorAll(".lvl-card").forEach((btn) => {
      if (btn.disabled) return;
      btn.addEventListener("click", () => {
        const ci = parseInt(btn.dataset.ci, 10);
        const li = parseInt(btn.dataset.li, 10);
        onPlay(ci, li);
      });
    });
    el.querySelector("#btn-back").addEventListener("click", onBack);
  }

  /**
   * 关卡结算界面。data: { chapter, level, result, stars, best, improved, hasNext }
   * onRetry 重试本关；onNext 进入下一关(可空)；onSelect 返回选关。
   */
  showLevelResult(data, { onRetry, onNext, onSelect }) {
    this.clear();
    const { chapter, level, result, stars, best, improved, hasNext } = data;
    const win = result === "clear";
    const titleTxt = win ? "关卡通关" : "闯关失败";
    const titleCls = win ? "res-win" : "res-fail";
    const bigStars = win
      ? `<div class="res-stars">${this._starRow(stars)}</div>`
      : `<div class="res-stars res-stars-fail">☆☆☆</div>`;
    const sub = win
      ? (improved ? `<div class="res-new">★ 新纪录!</div>` : `<div class="res-best">历史最佳 ${this._starRow(Math.max(0, best))}</div>`)
      : `<div class="res-tip">时间耗尽，未能抵达终点</div>`;

    const nextBtn = (win && hasNext && onNext)
      ? `<button class="btn btn-primary" id="btn-next">下一关 ▸</button>`
      : "";

    const el = this._make(`
      <div class="sub">${esc(chapter ? chapter.name : "")}</div>
      <div class="res-level">${esc(level ? level.id : "")} · ${esc(level ? level.name : "")}</div>
      <h2 class="neon-title ${titleCls}">${titleTxt}</h2>
      ${bigStars}
      ${sub}
      <div class="menu-btns res-btns">
        ${nextBtn}
        <button class="btn ${nextBtn ? "btn-restart" : "btn-primary"}" id="btn-retry">↺ 重试</button>
        <button class="btn btn-3" id="btn-select">☰ 选关</button>
      </div>
    `, "result-screen");
    this.root.appendChild(el);

    if (nextBtn) el.querySelector("#btn-next").addEventListener("click", onNext);
    el.querySelector("#btn-retry").addEventListener("click", onRetry);
    el.querySelector("#btn-select").addEventListener("click", onSelect);
  }

  /** 强化实验室：花费核心购买永久升级 */
  showShop(save, { onBuy, onBack }) {
    this.clear();
    const el = this._make(`
      <div class="sub">META LAB · 强化实验室</div>
      <h2 class="neon-title">永久强化</h2>
      <div class="cores-balance"><span class="cur-core">◆ <span class="cur-core-amt">${save.cores}</span></span> <span class="lbl">可用核心</span></div>
      <div class="shop-list"></div>
      <button class="btn" id="btn-back">← 返回</button>
      <div class="hint">永久加成在每局开局自动生效 · 失败也在变强</div>
    `, "shop-screen");
    const list = el.querySelector(".shop-list");
    const coreAmtEl = el.querySelector(".cur-core-amt");

    // 按钮态刷新：等级 / 花费 / 是否可购. 用于购买后仅更新受影响 DOM, 避免整页重绘闪动.
    const refreshRow = (row, m) => {
      const lv = MetaProgression.levelOf(save, m.id);
      const cost = MetaProgression.costOf(save, m.id);
      const maxed = cost == null;
      const affordable = !maxed && save.cores >= cost;
      // 等级文本
      const lvEl = row.querySelector(".shop-lv");
      if (lvEl) lvEl.textContent = `Lv.${lv}/${m.max}`;
      // 进度点
      const pipsEl = row.querySelector(".pips");
      if (pipsEl) pipsEl.innerHTML = this._pips(lv, m.max, m.accent);
      // 购买按钮: 只改 class/文本/disabled, 不换 DOM 节点 (监听器保留)
      const btn = row.querySelector(".shop-buy");
      if (btn) {
        btn.classList.toggle("maxed", maxed);
        btn.classList.toggle("poor", !maxed && !affordable);
        btn.disabled = maxed || !affordable;
        btn.textContent = maxed ? "满级" : `◆ ${cost}`;
      }
    };
    const refreshAll = () => {
      if (coreAmtEl) coreAmtEl.textContent = String(save.cores);
      for (const row of list.querySelectorAll(".shop-row")) {
        const id = row.dataset.metaId;
        const m = MetaProgression.list().find((x) => x.id === id);
        if (m) refreshRow(row, m);
      }
    };

    for (const m of MetaProgression.list()) {
      const row = document.createElement("div");
      row.className = "shop-row";
      row.dataset.metaId = m.id;
      row.style.setProperty("--accent", m.accent);
      row.innerHTML = `
        <div class="shop-icon">${m.icon}</div>
        <div class="shop-info">
          <div class="shop-name">${m.name} <span class="shop-lv"></span></div>
          <div class="shop-effect">${m.effect}</div>
          <div class="pips"></div>
        </div>
        <button class="shop-buy" type="button"></button>
      `;
      // 一次性绑定按钮点击, 内部检查是否可购; 购买后局部刷新, 不重建整页.
      row.querySelector(".shop-buy").addEventListener("click", () => {
        if (onBuy(m.id)) refreshAll();
      });
      refreshRow(row, m);
      list.appendChild(row);
    }
    this.root.appendChild(el);
    el.querySelector("#btn-back").addEventListener("click", onBack);
  }

  /**
   * 升级三选一。
   * - 桌面: 左侧「当前装备」面板 + 右侧三张卡, hint 提示 1/2/3 快捷键.
   * - 移动: 卡片纵向铺满一屏, 当前装备折叠到顶部「📊 当前能力」按钮, 点击弹窗展开.
   *   目的: 一页不需要滚动即可完整看到三张卡片(小屏可读性).
   */
  showLevelUp(player, choices, onPick) {
    this.clear();
    const el = this._make(`
      <div class="lu-head">
        <div class="sub">LEVEL UP · 等级 ${player.level}</div>
        <h2 class="neon-title">选择强化</h2>
      </div>
      <div class="levelup-body">
        ${this._loadoutHTML(player)}
        <div class="cards"></div>
      </div>
      <button class="btn lu-loadout-btn" id="btn-loadout" type="button">📊 当前能力</button>
      <div class="hint">${this.isTouch ? "点击卡片选择强化" : "按 1 / 2 / 3 快速选择"}</div>
      <div class="lu-modal" id="lu-modal" hidden>
        <div class="lu-modal-inner">
          ${this._loadoutHTML(player, "能力总览")}
          <button class="btn lu-modal-close" id="lu-modal-close" type="button">关闭</button>
        </div>
      </div>
    `, "levelup-screen");
    const cardsEl = el.querySelector(".cards");
    choices.forEach((u, i) => {
      const lv = UpgradeSystem.getLevel(player, u.id);
      const isMax = lv + 1 >= u.maxLevel && !u.unlock;
      const card = document.createElement("div");
      card.className = "card";
      card.style.setProperty("--accent", u.accent);
      card.innerHTML = `
        <div class="icon">${u.icon}</div>
        <div class="name">${u.name}</div>
        <div class="lvl">${this.isTouch ? "" : "[" + (i + 1) + "] "}${UpgradeSystem.levelLabel(player, u)}${isMax ? " · 满级" : ""}</div>
        <div class="desc">${u.desc}</div>
        <div class="pips">${this._pips(lv, u.maxLevel, u.accent)}</div>
      `;
      card.addEventListener("click", () => onPick(u));
      cardsEl.appendChild(card);
    });
    this.root.appendChild(el);

    // 「当前能力」弹窗: 打开/关闭 + 点空白遮罩关闭(内容区不响应)
    const modal = el.querySelector("#lu-modal");
    el.querySelector("#btn-loadout").addEventListener("click", () => { modal.hidden = false; });
    el.querySelector("#lu-modal-close").addEventListener("click", () => { modal.hidden = true; });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
  }

  /** 等级进度小圆点 */
  _pips(level, max, accent) {
    let s = "";
    for (let i = 0; i < max; i++) {
      const on = i < level;
      s += `<i class="pip" style="background:${on ? accent : "transparent"};border-color:${accent}"></i>`;
    }
    return s;
  }

  /** 暂停（展示当前能力总览） */
  showPause(player, onResume, onQuit) {
    this.clear();
    const el = this._make(`
      <h2 class="neon-title">已暂停</h2>
      ${this._loadoutHTML(player, "能力总览")}
      <div class="menu-btns">
        <button class="btn" id="btn-resume">继续</button>
        <button class="btn btn-quit" id="btn-quit">✕ 结束本局</button>
      </div>
      <div class="hint">${this.isTouch
        ? "主动结束本局不会有奖励结算"
        : "按 P / ESC 继续 &nbsp;·&nbsp; 主动结束本局不会有奖励结算"}</div>
    `, "pause-screen");
    this.root.appendChild(el);
    el.querySelector("#btn-resume").addEventListener("click", onResume);
    if (onQuit) el.querySelector("#btn-quit").addEventListener("click", onQuit);
  }

  /** 结算 */
  showGameOver(stats, { reward, shardReward, records, save }, { onRestart, onShop, onHangar, onMenu }) {
    this.clear();
    const tag = (on) => (on ? ` <span class="rec">新纪录!</span>` : "");
    const el = this._make(`
      <div class="sub">SIGNAL LOST</div>
      <h1 class="neon-title" style="color:#ff2bd6">GAME OVER</h1>
      <div class="stat-line">存活时间 <b>${formatTime(stats.time)}</b>${tag(records.time)}</div>
      <div class="stat-line">击杀总数 <b>${stats.kills}</b>${tag(records.kills)}</div>
      <div class="stat-line">到达等级 <b>${stats.level}</b>${tag(records.level)}</div>
      <div class="stat-line">击败母核 <b>${stats.bossKills}</b>${tag(records.bossKills)}</div>
      <div class="reward-box">本局获得 <b class="cur-core">◆ ${reward}</b> &nbsp;·&nbsp; <b class="shard-amt">✦ ${shardReward}</b></div>
      <div class="menu-btns">
        <button class="btn" id="btn-restart">↻ 再来一局</button>
        <button class="btn btn-4" id="btn-hangar">✦ 机库</button>
        <button class="btn btn-3" id="btn-shop">◆ 强化实验室</button>
        <button class="btn btn-2" id="btn-menu">主菜单</button>
      </div>
    `, "gameover-screen");
    this.root.appendChild(el);
    el.querySelector("#btn-restart").addEventListener("click", onRestart);
    el.querySelector("#btn-shop").addEventListener("click", onShop);
    el.querySelector("#btn-hangar").addEventListener("click", onHangar);
    el.querySelector("#btn-menu").addEventListener("click", onMenu);
  }

  // ---------------- 机库（外观选择 + 抽卡） ----------------

  /** 星级显示：●●●○○ */
  _stars(star, max = MAX_STAR) {
    let s = "";
    for (let i = 0; i < max; i++) s += i < star ? "★" : "☆";
    return s;
  }

  /** 渲染单个外观造型到独立 canvas（用于机库卡片预览） */
  _drawSkinPreview(canvas, skin, color) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    Skins.drawShip(ctx, skin.shape, Math.min(w, h) * 0.3, color);
    ctx.restore();
  }

  /** 机库主界面：外观网格 + 抽卡按钮 */
  showHangar(save, { onSelect, onDraw, onFreeDraw, onBack }) {
    this.clear();
    const shards = save.skins.shards;
    const selected = Skins.selected(save);
    const canFree = Skins.canFreeDraw(save);
    const singlePrice = Skins.priceSingle();
    const tenPrice = Skins.priceTen();
    const canSingle = shards >= singlePrice;
    const canTen = shards >= tenPrice;
    // 抽卡面板: "单抽"槽位与"每日免费"合并——可领取免费时显示"每日免费"入口(柠檬绿),
    // 领取后自动切换成"单抽 ✦ 100"(品红). 十连独立作为主推项.
    // 棱牌不足时对应按钮 disabled + .poor 灰阶, 与商店购买按钮观感一致.
    const singleSlotHTML = canFree
      ? `<button class="gp-draw gp-single gp-free-mode" id="btn-single" data-mode="free">
           <span class="gp-draw-title">每日免费单抽</span>
           <span class="gp-draw-cost">🎁 今日可领</span>
         </button>`
      : `<button class="gp-draw gp-single" id="btn-single" data-mode="paid"${canSingle ? "" : " disabled"}>
           <span class="gp-draw-title">单抽</span>
           <span class="gp-draw-cost">✦ ${singlePrice}</span>
         </button>`;
    const el = this._make(`
      <div class="sub">HANGAR · 机库</div>
      <h2 class="neon-title">战机外观</h2>
      <div class="gacha-panel">
        <div class="gp-balance"><span class="shard-amt">✦ ${shards}</span><span class="gp-lbl">棱牌</span></div>
        <div class="gp-actions">
          ${singleSlotHTML}
          <button class="gp-draw gp-ten" id="btn-draw10"${canTen ? "" : " disabled"}>
            <span class="gp-draw-title">十连</span>
            <span class="gp-draw-cost">✦ ${tenPrice}</span>
          </button>
        </div>
      </div>
      <div class="skin-grid"></div>
      <button class="btn btn-3" id="btn-back">← 返回</button>
      <div class="hint">每天可免费抽一次 · 重复抽取升星强化专属特性 · 满星后返还棱牌</div>
    `, "hangar-screen");
    const grid = el.querySelector(".skin-grid");
    // 装备切换 -> 只改按钮 textContent + classList, DOM 结构 0 变化.
    // (避免 innerHTML 替换在 backdrop-filter 背板上触发整屏重绘导致的闪动)
    const applyEquipState = (card, isSel) => {
      card.classList.toggle("selected", isSel);
      const btn = card.querySelector(".skin-select");
      if (!btn) return;
      btn.textContent = isSel ? "已装备" : "装备";
      btn.classList.toggle("equipped", isSel);
      btn.disabled = isSel;
    };
    const equipSkin = (skinId) => {
      const next = grid.querySelector(`.skin-card[data-skin-id="${skinId}"]`);
      if (!next || next.classList.contains("selected")) return;
      const prev = grid.querySelector(".skin-card.selected");
      if (prev) applyEquipState(prev, false);
      applyEquipState(next, true);
      onSelect(skinId);
    };
    for (const skin of Skins.list()) {
      const rar = RARITY[skin.rarity];
      const star = Skins.starOf(save, skin.id);
      const owned = star > 0;
      const isSel = owned && skin.id === selected;
      const card = document.createElement("div");
      card.className = `skin-card rar-${skin.rarity}${owned ? "" : " locked"}${isSel ? " selected" : ""}`;
      card.dataset.skinId = skin.id;
      card.style.setProperty("--accent", rar.color);
      const actionHTML = owned
        ? `<button class="skin-select${isSel ? " equipped" : ""}" type="button"${isSel ? " disabled" : ""}>${isSel ? "已装备" : "装备"}</button>`
        : `<span class="skin-lockicon">🔒</span>`;
      card.innerHTML = `
        <div class="skin-rar" style="color:${rar.color}">${rar.name}</div>
        <canvas class="skin-canvas" width="120" height="120"></canvas>
        <div class="skin-name">${owned ? skin.name : "？？？"}</div>
        <div class="skin-stars" style="color:${rar.color}">${owned ? this._stars(star) : this._stars(0)}</div>
        <div class="skin-perk">${owned ? skin.perkText(Math.max(1, star)) : "未解锁 · 抽卡获取"}</div>
        <div class="skin-action">${actionHTML}</div>
      `;
      this._drawSkinPreview(card.querySelector(".skin-canvas"), skin, owned ? skin.accent : "#3a4356");
      if (owned) {
        card.querySelector(".skin-select").addEventListener("click", () => equipSkin(skin.id));
      }
      grid.appendChild(card);
    }
    this.root.appendChild(el);

    const single = el.querySelector("#btn-single");
    const draw10 = el.querySelector("#btn-draw10");
    // paid 模式下棱牌不足: 加 .poor 灰阶(disabled 属性已在模板里设好)
    if (single.dataset.mode === "paid" && !canSingle) single.classList.add("poor");
    // 单抽槽位: data-mode 决定走哪条路径(free=每日免费, paid=消耗棱牌单抽)
    single.addEventListener("click", () => {
      if (single.disabled) return;
      if (single.dataset.mode === "free") { if (onFreeDraw) onFreeDraw(); }
      else { onDraw(1); }
    });
    // 十连: 棱牌不足时 disabled + .poor 灰阶提示
    if (!canTen) draw10.classList.add("poor");
    draw10.addEventListener("click", () => { if (!draw10.disabled) onDraw(10); });
    el.querySelector("#btn-back").addEventListener("click", onBack);
  }

  /** 抽卡结果展示 */
  showGachaResult(save, results, onClose) {
    this.clear();
    const el = this._make(`
      <div class="sub">SUMMON RESULT</div>
      <h2 class="neon-title">抽卡结果</h2>
      <div class="cores-balance"><span class="shard-amt">✦ ${save.skins.shards}</span> <span class="lbl">棱牌</span></div>
      <div class="gacha-result"></div>
      <button class="btn" id="btn-close">确定</button>
    `);
    const box = el.querySelector(".gacha-result");
    results.forEach((res, i) => {
      const skin = res.skin;
      const rar = RARITY[skin.rarity];
      const cell = document.createElement("div");
      cell.className = `gr-cell rar-${skin.rarity}`;
      cell.style.setProperty("--accent", rar.color);
      cell.style.animationDelay = `${i * 0.05}s`;
      const badge = res.isNew ? `<span class="gr-tag new">NEW</span>`
        : res.upgraded ? `<span class="gr-tag up">升星 ★${res.star}</span>`
        : `<span class="gr-tag refund">返还 ✦${res.refund}</span>`;
      cell.innerHTML = `
        <div class="gr-rar" style="color:${rar.color}">${rar.name}</div>
        <canvas class="gr-canvas" width="96" height="96"></canvas>
        <div class="gr-name">${skin.name}</div>
        ${badge}
      `;
      this._drawSkinPreview(cell.querySelector(".gr-canvas"), skin, skin.accent);
      box.appendChild(cell);
    });
    this.root.appendChild(el);
    el.querySelector("#btn-close").addEventListener("click", onClose);
  }

  // ---------------- 图鉴 ----------------

  /**
   * 图鉴界面: 四类条目网格 + 收集度进度条 + 里程碑奖励条目.
   * 未发掘条目: 黑色轮廓 + 问号占位; 已发掘: 主题色符号 + 名称.
   */
  showCodex(save, { onClaim, onBack }) {
    this.clear();
    const prog = Codex.progress(save);
    const el = this._make(`
      <div class="sub">CODEX · 图鉴</div>
      <h2 class="neon-title">情报库</h2>
      <div class="codex-prog">
        <div class="cp-bar"><div class="cp-fill" style="width:${prog.total ? (prog.owned / prog.total * 100).toFixed(1) : 0}%"></div></div>
        <div class="cp-text">收集进度 <b>${prog.owned}</b> / ${prog.total}</div>
      </div>
      <div class="codex-scroll">
        <div class="codex-body"></div>
        <div class="codex-achv-title">
          <span class="cat-tag">ACHIEVEMENTS</span>
          <span class="cat-cn">成就 · 收集里程碑</span>
        </div>
        <div class="codex-milestones"></div>
      </div>
      <button class="btn btn-3" id="btn-back">← 返回</button>
      <div class="hint">局内首次遭遇即录入图鉴 · 未发掘条目以黑色轮廓显示 · 达成里程碑可领取奖励</div>
    `, "codex-screen");

    const body = el.querySelector(".codex-body");
    for (const cat of Codex.categories()) {
      const items = cat.list();
      const meta = prog.byCategory[cat.key] || { owned: 0, total: items.length };
      const section = document.createElement("div");
      section.className = "codex-section";
      section.innerHTML = `
        <div class="cs-header">
          <div class="cs-title">${cat.title}</div>
          <div class="cs-count">${meta.owned}/${meta.total}</div>
        </div>
        <div class="cs-grid"></div>
      `;
      const grid = section.querySelector(".cs-grid");
      for (const entry of items) {
        const owned = Codex.discovered(save, cat.key, entry.id);
        const cell = document.createElement("div");
        cell.className = `codex-cell${owned ? " owned" : " locked"}`;
        cell.style.setProperty("--accent", entry.color);
        // 已发掘: 主题色符号 + 名称 + 描述; 未发掘: 黑色轮廓问号 + ??? 占位
        cell.innerHTML = `
          <div class="cc-sym">${owned ? entry.symbol : "?"}</div>
          <div class="cc-name">${owned ? entry.name : "???"}</div>
          <div class="cc-desc">${owned ? (entry.desc || "") : "尚未发掘"}</div>
        `;
        grid.appendChild(cell);
      }
      body.appendChild(section);
    }

    // 里程碑奖励条目：达成可领取 / 已领取 / 未达成.
    // 领取时只做局部 DOM 更新（不整页重建）, 避免闪动.
    const msBox = el.querySelector(".codex-milestones");
    const buildMilestoneRow = (m) => {
      const need = Codex.needOf(m);
      const reached = prog.owned >= need;
      const claimed = Codex.claimed(save, m.id);
      const row = document.createElement("div");
      row.className = `cm-row${claimed ? " claimed" : reached ? " ready" : ""}`;
      row.dataset.mid = m.id;
      const rw = m.reward || {};
      const rewardText = [
        rw.shards ? `✦ ${rw.shards}` : null,
        rw.cores ? `◆ ${rw.cores}` : null,
        rw.skin ? `皮肤「${(Skins.get(rw.skin) || {}).name || rw.skin}」` : null,
        rw.active ? "主动技能" : null,
      ].filter(Boolean).join(" · ");
      row.innerHTML = `
        <div class="cm-info">
          <div class="cm-title">${m.label} <span class="cm-need">${need} 项</span></div>
          <div class="cm-desc">${m.desc}</div>
          <div class="cm-reward">奖励: ${rewardText || "—"}</div>
        </div>
        <div class="cm-action"></div>
      `;
      const action = row.querySelector(".cm-action");
      if (claimed) {
        action.innerHTML = `<span class="cm-claimed">已领取</span>`;
      } else if (reached) {
        const btn = document.createElement("button");
        btn.className = "cm-claim";
        btn.textContent = "领取";
        btn.addEventListener("click", () => {
          const res = onClaim(m.id);
          if (!res) return;
          // 局部切换: 该行从 ready -> claimed, 按钮换为"已领取"文案
          row.classList.remove("ready");
          row.classList.add("claimed");
          action.innerHTML = `<span class="cm-claimed">已领取</span>`;
        });
        action.appendChild(btn);
      } else {
        action.innerHTML = `<span class="cm-pending">${prog.owned} / ${need}</span>`;
      }
      return row;
    };
    for (const m of Codex.milestones()) msBox.appendChild(buildMilestoneRow(m));

    this.root.appendChild(el);
    el.querySelector("#btn-back").addEventListener("click", onBack);
  }

  // ---------------- 云同步 ----------------

  /**
   * 云同步界面: 未绑定时可「开启云同步(注册)」或「用恢复码找回」; 已绑定时可查看/复制恢复码、
   * 上传本地存档到云、下载云存档覆盖本地、解绑本设备。
   *
   * 所有网络回调(onEnable/onLink/onUpload/onDownload)均返回 Promise<{ok, error?}>;
   * 会改变绑定状态的操作(开启/找回/解绑)由上层(Game)在成功后重新打开本界面, 这里不自行重建。
   * cloud-screen 已在 CSS 关闭 backdrop-filter, 局部文本更新不会触发整屏闪动。
   */
  showCloud(state, { onEnable, onLink, onUpload, onDownload, onUnlink, onBack }) {
    this.clear();
    const linked = !!state.linked;
    const notice = state.notice
      ? `<div class="cloud-notice">${esc(state.notice)}</div>`
      : "";

    // 按钮统一作为 .cloud-body 的直接子级(而非嵌在卡片内), 借 flex stretch 让所有按钮等宽对齐。
    const unlinkedHTML = `
      <div class="cloud-card">
        <div class="cc-title">开启云同步</div>
        <div class="cc-desc">首次开启会生成一个「恢复码」, 凭它可在任意设备找回你的存档与排行榜成绩。</div>
        <div class="cloud-form">
          <label>昵称(排行榜显示)</label>
          <input id="cloud-name" maxlength="16" placeholder="指挥官" autocomplete="off" value="${esc(state.name || "")}" />
        </div>
      </div>
      <button class="btn btn-primary" id="btn-enable">☁ 开启云同步</button>
      <div class="cloud-sep">— 已有恢复码？在下方找回 —</div>
      <div class="cloud-card">
        <div class="cloud-form">
          <label>恢复码</label>
          <input id="cloud-token" placeholder="粘贴你的恢复码" autocomplete="off" />
        </div>
      </div>
      <button class="btn btn-2" id="btn-link">↩ 用恢复码找回</button>`;

    const linkedHTML = `
      <div class="cloud-card">
        <div class="cc-row"><span class="cc-k">云账号</span><span class="cc-v">${esc(state.name || "指挥官")}</span></div>
        <div class="cc-row">
          <span class="cc-k">恢复码</span>
          <span class="cc-v cloud-token" id="cloud-token-val">••••••••••••••••</span>
          <button class="cc-mini" id="btn-reveal">显示</button>
          <button class="cc-mini" id="btn-copy">复制</button>
        </div>
      </div>
      <button class="btn btn-primary" id="btn-upload">⬆ 上传本地到云</button>
      <button class="btn btn-2" id="btn-download">⬇ 下载云覆盖本地</button>
      <button class="btn btn-quit" id="btn-unlink">解绑此设备</button>`;

    const el = this._make(`
      <div class="sub">CLOUD SYNC · 云端同步</div>
      <h2 class="neon-title">☁ 云存档</h2>
      ${notice}
      <div class="cloud-body">${linked ? linkedHTML : unlinkedHTML}</div>
      <div class="cloud-status" id="cloud-status"></div>
      <button class="btn btn-3" id="btn-back">← 返回</button>
      <div class="hint">恢复码是找回云存档的唯一凭证, 丢失将无法找回, 请妥善保存</div>
    `, "cloud-screen");
    this.root.appendChild(el);

    const statusEl = el.querySelector("#cloud-status");
    const setStatus = (msg, kind = "") => {
      statusEl.textContent = msg || "";
      statusEl.className = `cloud-status${kind ? " " + kind : ""}`;
    };
    // 异步操作期间禁用按钮并显示占位文案, 结束后恢复
    const withBusy = async (btn, label, fn) => {
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = label;
      try { return await fn(); }
      finally { btn.disabled = false; btn.textContent = old; }
    };

    el.querySelector("#btn-back").addEventListener("click", onBack);

    if (!linked) {
      const nameIn = el.querySelector("#cloud-name");
      const tokenIn = el.querySelector("#cloud-token");
      el.querySelector("#btn-enable").addEventListener("click", (e) => {
        withBusy(e.currentTarget, "开启中…", async () => {
          setStatus("正在开启云同步…");
          const r = await onEnable(nameIn.value);
          // 成功时上层会重建界面; 仅在失败时提示
          if (!r || !r.ok) setStatus((r && r.error) || "开启失败, 请稍后重试", "err");
        });
      });
      el.querySelector("#btn-link").addEventListener("click", (e) => {
        const token = (tokenIn.value || "").trim();
        if (!token) { setStatus("请先粘贴恢复码", "err"); return; }
        withBusy(e.currentTarget, "找回中…", async () => {
          setStatus("正在验证恢复码…");
          const r = await onLink(token);
          if (!r || !r.ok) setStatus((r && r.error) || "找回失败", "err");
        });
      });
    } else {
      const tokenEl = el.querySelector("#cloud-token-val");
      const revealBtn = el.querySelector("#btn-reveal");
      let revealed = false;
      revealBtn.addEventListener("click", () => {
        revealed = !revealed;
        tokenEl.textContent = revealed ? (state.token || "") : "••••••••••••••••";
        tokenEl.classList.toggle("shown", revealed);
        revealBtn.textContent = revealed ? "隐藏" : "显示";
      });
      el.querySelector("#btn-copy").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(state.token || "");
          setStatus("✓ 恢复码已复制到剪贴板", "ok");
        } catch (_e) {
          // 剪贴板不可用(非 https/权限): 退化为显示明文让用户手动复制
          revealed = true;
          tokenEl.textContent = state.token || "";
          tokenEl.classList.add("shown");
          revealBtn.textContent = "隐藏";
          setStatus("无法自动复制, 已显示恢复码请手动复制", "err");
        }
      });
      el.querySelector("#btn-upload").addEventListener("click", (e) => {
        withBusy(e.currentTarget, "上传中…", async () => {
          setStatus("正在上传本地存档…");
          const r = await onUpload();
          setStatus(r && r.ok ? "✓ 本地存档已上传到云" : ((r && r.error) || "上传失败"), r && r.ok ? "ok" : "err");
        });
      });
      el.querySelector("#btn-download").addEventListener("click", (e) => {
        if (!window.confirm("下载云存档会覆盖当前本地进度, 确定继续?")) return;
        withBusy(e.currentTarget, "下载中…", async () => {
          setStatus("正在下载云存档…");
          const r = await onDownload();
          setStatus(r && r.ok ? "✓ 已用云存档覆盖本地" : ((r && r.error) || "下载失败"), r && r.ok ? "ok" : "err");
        });
      });
      el.querySelector("#btn-unlink").addEventListener("click", () => {
        if (!window.confirm("解绑只会清除本设备保存的恢复码, 不会删除云端数据。确定解绑?")) return;
        onUnlink();
      });
    }
  }

  // ---------------- 排行榜 ----------------

  /**
   * 排行榜界面: 先渲染骨架与「加载中」, loadFn 异步返回后填充列表。
   * loadFn: () => Promise<{ ok, list:[{name,best_time,best_kills,best_boss,best_level}] }>
   * 昵称经 esc() 转义防 XSS。
   */
  showLeaderboard(loadFn, { onBack }) {
    this.clear();
    const el = this._make(`
      <div class="sub">GLOBAL RANKING · 全服排行</div>
      <h2 class="neon-title">🏆 排行榜</h2>
      <div class="rank-sub">按存活时间排名 · 前 100 名</div>
      <div class="rank-list" id="rank-list"><div class="rank-loading">加载中…</div></div>
      <button class="btn btn-3" id="btn-back">← 返回</button>
      <div class="hint">完成一局并开启云同步后, 你的最佳成绩会自动上榜</div>
    `, "rank-screen");
    this.root.appendChild(el);
    el.querySelector("#btn-back").addEventListener("click", onBack);

    const listEl = el.querySelector("#rank-list");
    loadFn().then((res) => {
      if (!res || !res.ok) {
        listEl.innerHTML = `<div class="rank-empty">排行榜加载失败, 请稍后重试</div>`;
        return;
      }
      const list = Array.isArray(res.list) ? res.list : [];
      if (!list.length) {
        listEl.innerHTML = `<div class="rank-empty">还没有记录, 快来抢占榜首!</div>`;
        return;
      }
      listEl.innerHTML = "";
      list.forEach((row, i) => {
        const pos = i + 1;
        const medal = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : String(pos);
        const div = document.createElement("div");
        div.className = `rank-row${pos <= 3 ? " top rank-" + pos : ""}`;
        div.innerHTML = `
          <span class="rank-pos">${medal}</span>
          <span class="rank-name">${esc(row.name || "匿名")}</span>
          <span class="rank-stat rank-time">${formatTime(Number(row.best_time) || 0)}</span>
          <span class="rank-stat">☠ ${Number(row.best_kills) || 0}</span>
          <span class="rank-stat">Lv.${Number(row.best_level) || 1}</span>
        `;
        listEl.appendChild(div);
      });
    });
  }

  /**
   * 反馈留言板: 玩家与开发者的异步对话.
   * ctx = { ownerId, name, isLocal }. loadFn() -> Promise<{ok, messages}>. sendFn(text) -> Promise<{ok, message}>.
   * onBack 返回主菜单.
   *
   * 交互特点:
   *  - 打开时拉取历史消息, 时间线自下而上追加渲染;
   *  - 玩家消息靠右(品红), 开发者回复靠左(青);
   *  - 底部输入框 + 发送按钮, 发送后本地即时追加(乐观 UI), 服务端失败时提示并保留输入;
   *  - 输入长度硬上限 500(与后端一致); 空/超长按钮禁用.
   */
  showFeedback({ ownerId, name, isLocal }, { loadFn, sendFn, onBack }) {
    this.clear();
    const identityHint = isLocal
      ? `匿名玩家（本地 id: ${esc(ownerId.replace(/^local:/, ""))}）· 开通云同步后回复更可靠`
      : `云账号 · 昵称 ${esc(name || "指挥官")}`;
    const el = this._make(`
      <div class="sub">FEEDBACK · 反馈留言板</div>
      <h2 class="neon-title">💬 bug留言区</h2>
      <div class="fb-identity">${identityHint}</div>
      <div class="fb-thread" id="fb-thread"><div class="fb-loading">加载中…</div></div>
      <div class="fb-compose">
        <textarea id="fb-input" maxlength="500" rows="2" placeholder="写下你遇到的bug或建议…(最多 500 字)"></textarea>
        <div class="fb-compose-row">
          <span class="fb-count" id="fb-count">0 / 500</span>
          <button class="btn btn-primary fb-send" id="fb-send" disabled>发送</button>
        </div>
      </div>
      <button class="btn btn-3" id="btn-back">← 返回</button>
      <div class="hint">欢迎在这里提出你遇到的bug/优化建议，光速响应</div>
    `, "feedback-screen");
    this.root.appendChild(el);

    const thread = el.querySelector("#fb-thread");
    const input = el.querySelector("#fb-input");
    const sendBtn = el.querySelector("#fb-send");
    const countEl = el.querySelector("#fb-count");

    const fmtTime = (t) => {
      if (!t) return "";
      const d = new Date(Number(t));
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const renderMessages = (msgs) => {
      if (!msgs.length) {
        thread.innerHTML = `<div class="fb-empty">还没有消息 · 说说你遇到的 Bug 或想要的功能吧！</div>`;
        return;
      }
      thread.innerHTML = "";
      for (const m of msgs) {
        const isDev = m.role === "dev";
        const row = document.createElement("div");
        row.className = `fb-msg ${isDev ? "fb-msg-dev" : "fb-msg-user"}`;
        row.innerHTML = `
          <div class="fb-msg-meta">
            <span class="fb-msg-who">${isDev ? "开发者" : esc(m.name || "指挥官")}</span>
            <span class="fb-msg-time">${fmtTime(m.created_at)}</span>
          </div>
          <div class="fb-msg-body">${esc(m.body || "")}</div>
        `;
        thread.appendChild(row);
      }
      // 自动滚到最新
      thread.scrollTop = thread.scrollHeight;
    };

    const refreshSendState = () => {
      const len = input.value.trim().length;
      countEl.textContent = `${input.value.length} / 500`;
      sendBtn.disabled = len === 0 || len > 500 || sendBtn.dataset.sending === "1";
    };
    input.addEventListener("input", refreshSendState);
    refreshSendState();

    // 初次拉取
    loadFn().then((res) => {
      if (!res || !res.ok) {
        thread.innerHTML = `<div class="fb-empty">加载失败, 请稍后重试</div>`;
        return;
      }
      renderMessages(Array.isArray(res.messages) ? res.messages : []);
    });

    sendBtn.addEventListener("click", async () => {
      const text = input.value.trim();
      if (!text || text.length > 500) return;
      sendBtn.dataset.sending = "1";
      refreshSendState();
      const res = await sendFn(text);
      sendBtn.dataset.sending = "";
      if (!res || !res.ok) {
        // 保留输入, 顶部弹出错误行
        const err = document.createElement("div");
        err.className = "fb-error";
        err.textContent = res && res.error ? res.error : "发送失败, 请检查网络";
        thread.appendChild(err);
        thread.scrollTop = thread.scrollHeight;
        refreshSendState();
        return;
      }
      // 乐观追加
      input.value = "";
      refreshSendState();
      const m = res.message || { role: "user", name, body: text, created_at: Date.now() };
      const row = document.createElement("div");
      row.className = "fb-msg fb-msg-user";
      row.innerHTML = `
        <div class="fb-msg-meta">
          <span class="fb-msg-who">${esc(m.name || name || "指挥官")}</span>
          <span class="fb-msg-time">${fmtTime(m.created_at)}</span>
        </div>
        <div class="fb-msg-body">${esc(m.body || "")}</div>
      `;
      // 若之前是"empty"占位, 先清掉
      const empty = thread.querySelector(".fb-empty");
      if (empty) empty.remove();
      thread.appendChild(row);
      thread.scrollTop = thread.scrollHeight;
    });

    el.querySelector("#btn-back").addEventListener("click", onBack);
  }
}
