/**
 * Screens.js — 基于 DOM 的覆盖界面管理（主菜单 / 升级选择 / 暂停 / 结算）。
 * 与 Canvas 内的 HUD 分离：DOM 适合处理可交互按钮与卡片，Canvas 负责高频游戏渲染。
 */
import { formatTime } from "../utils/math.js";
import { UpgradeSystem } from "../systems/UpgradeSystem.js";
import { MetaProgression } from "../systems/MetaProgression.js";
import { Skins, RARITY, MAX_STAR } from "../systems/Skins.js";
import { Codex } from "../systems/Codex.js";
import { Account } from "../core/Account.js";

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
  showMenu(save, user, { onStart, onResume, onShop, onHangar, onCodex, onAccount, onCloud, onLeaderboard }) {
    this.clear();
    const b = save.best;
    const userBar = user
      ? `
      <div class="user-bar" id="user-bar" title="点击切换或管理玩家">
        <span class="user-ic">👤</span>
        <span class="user-name">${esc(user.name)}</span>
        <span class="user-switch">切换 ▸</span>
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
    const primaryRow = onResume
      ? `
        <button class="btn btn-primary" id="btn-resume">↩ 继续上局</button>
        <button class="btn btn-restart" id="btn-start">▶ 重新开始</button>
      `
      : `<button class="btn btn-primary" id="btn-start">▶ 开始游戏</button>`;
    const el = this._make(`
      ${userBar}
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
        <button class="btn btn-sync" id="btn-cloud">☁ 云同步</button>
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
    if (onResume) el.querySelector("#btn-resume").addEventListener("click", onResume);
    if (onCloud) el.querySelector("#btn-cloud").addEventListener("click", onCloud);
    if (onLeaderboard) el.querySelector("#btn-rank").addEventListener("click", onLeaderboard);
    if (onAccount) {
      const bar = el.querySelector("#user-bar");
      if (bar) bar.addEventListener("click", onAccount);
    }
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

  /** 升级三选一（左侧展示当前能力，右侧三张强化卡） */
  showLevelUp(player, choices, onPick) {
    this.clear();
    const el = this._make(`
      <div class="sub">LEVEL UP · 等级 ${player.level}</div>
      <h2 class="neon-title">选择强化</h2>
      <div class="levelup-body">
        ${this._loadoutHTML(player)}
        <div class="cards"></div>
      </div>
      <div class="hint">${this.isTouch ? "点击卡片选择强化" : "按 1 / 2 / 3 快速选择"}</div>
    `);
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
    `);
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
    const freeBtn = canFree
      ? `<button class="btn free-draw" id="btn-free">🎁 每日免费抽卡</button>`
      : `<button class="btn free-draw claimed" id="btn-free" disabled>✓ 今日已领取</button>`;
    const el = this._make(`
      <div class="sub">HANGAR · 机库</div>
      <h2 class="neon-title">战机外观</h2>
      <div class="cores-balance"><span class="shard-amt">✦ ${shards}</span> <span class="lbl">棱牌</span></div>
      <div class="gacha-bar">
        ${freeBtn}
        <button class="btn gacha-btn" id="btn-draw1">单抽 · ✦ ${Skins.priceSingle()}</button>
        <button class="btn btn-2 gacha-btn" id="btn-draw10">十连 · ✦ ${Skins.priceTen()}</button>
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

    const draw1 = el.querySelector("#btn-draw1");
    const draw10 = el.querySelector("#btn-draw10");
    if (shards < Skins.priceSingle()) { draw1.disabled = true; draw1.classList.add("poor"); }
    if (shards < Skins.priceTen()) { draw10.disabled = true; draw10.classList.add("poor"); }
    draw1.addEventListener("click", () => onDraw(1));
    draw10.addEventListener("click", () => onDraw(10));
    if (canFree && onFreeDraw) el.querySelector("#btn-free").addEventListener("click", onFreeDraw);
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
      <div class="codex-body"></div>
      <div class="codex-achv-title">
        <span class="cat-tag">ACHIEVEMENTS</span>
        <span class="cat-cn">成就 · 收集里程碑</span>
      </div>
      <div class="codex-milestones"></div>
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

  // ---------------- 账号管理 ----------------

  /**
   * 用户管理界面：切换 / 创建 / 重命名 / 删除。
   * 所有变更通过回调回传给上层（Game）落盘。
   */
  showAccount(currentId, { onSwitch, onCreate, onRename, onDelete, onBack }) {
    this.clear();
    const el = this._make(`
      <div class="sub">PILOT REGISTRY · 玩家档案</div>
      <h2 class="neon-title">选择玩家</h2>
      <div class="hint">同一浏览器可保存多份进度; ID 由系统自动分配, 也是未来云端存档 / 排行榜的账号标识</div>

      <div class="user-list"></div>

      <div class="user-create">
        <div class="uc-title">＋ 创建新玩家</div>
        <div class="uc-row">
          <label>昵称</label>
          <input id="in-name" maxlength="${Account.NAME_MAX}" placeholder="例如：星穹指挥官" autocomplete="off" />
        </div>
        <div class="uc-error" id="uc-error"></div>
        <button class="btn" id="btn-create">✦ 创建并使用</button>
      </div>

      <button class="btn btn-3" id="btn-back">← 返回</button>
    `, "account-screen");

    const list = el.querySelector(".user-list");
    const users = Account.list();
    if (users.length === 0) {
      list.innerHTML = `<div class="hint">尚无玩家档案</div>`;
    } else {
      for (const u of users) {
        const isCur = u.id === currentId;
        const row = document.createElement("div");
        row.className = `user-row${isCur ? " current" : ""}`;
        row.innerHTML = `
          <div class="ur-info">
            <div class="ur-name">${esc(u.name)}${isCur ? ' <span class="ur-tag">当前</span>' : ""}</div>
            <div class="ur-id">#${esc(u.id)}</div>
          </div>
          <div class="ur-actions">
            ${isCur ? "" : `<button class="ur-btn ur-use">使用</button>`}
            <button class="ur-btn ur-rename">重命名</button>
            <button class="ur-btn ur-del">删除</button>
          </div>
        `;
        const useBtn = row.querySelector(".ur-use");
        if (useBtn) useBtn.addEventListener("click", () => onSwitch(u.id));

        row.querySelector(".ur-rename").addEventListener("click", () => {
          // 使用 prompt 保持零依赖；输入会经过 Account.rename 内部清洗
          const next = window.prompt("新昵称", u.name);
          if (next != null) {
            const err = onRename(u.id, next);
            if (err) window.alert(err);
          }
        });
        row.querySelector(".ur-del").addEventListener("click", () => {
          // 二次确认，避免误删除
          if (window.confirm(`确定删除玩家「${u.name}」? 该玩家的存档、进度、外观都会被清除, 无法恢复。`)) {
            onDelete(u.id);
          }
        });
        list.appendChild(row);
      }
    }

    const nameIn = el.querySelector("#in-name");
    const errBox = el.querySelector("#uc-error");
    const showErr = (msg) => { errBox.textContent = msg || ""; };
    el.querySelector("#btn-create").addEventListener("click", () => {
      showErr("");
      const err = onCreate({ name: nameIn.value });
      if (err) showErr(err);
    });
    // 回车触发创建, 提升键盘用户体验
    nameIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); el.querySelector("#btn-create").click(); }
    });

    el.querySelector("#btn-back").addEventListener("click", onBack);
    this.root.appendChild(el);
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

    const unlinkedHTML = `
      <div class="cloud-card">
        <div class="cc-title">开启云同步</div>
        <div class="cc-desc">首次开启会生成一个「恢复码」, 凭它可在任意设备找回你的存档与排行榜成绩。</div>
        <div class="cloud-form">
          <label>昵称(排行榜显示)</label>
          <input id="cloud-name" maxlength="16" placeholder="指挥官" autocomplete="off" value="${esc(state.name || "")}" />
        </div>
        <button class="btn btn-primary" id="btn-enable">☁ 开启云同步</button>
      </div>
      <div class="cloud-sep">— 已有恢复码？在下方找回 —</div>
      <div class="cloud-card">
        <div class="cloud-form">
          <label>恢复码</label>
          <input id="cloud-token" placeholder="粘贴你的恢复码" autocomplete="off" />
        </div>
        <button class="btn btn-2" id="btn-link">↩ 用恢复码找回</button>
      </div>`;

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
      <div class="cloud-actions">
        <button class="btn btn-primary" id="btn-upload">⬆ 上传本地到云</button>
        <button class="btn btn-2" id="btn-download">⬇ 下载云覆盖本地</button>
      </div>
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
}
