/**
 * Screens.js — 基于 DOM 的覆盖界面管理（主菜单 / 升级选择 / 暂停 / 结算）。
 * 与 Canvas 内的 HUD 分离：DOM 适合处理可交互按钮与卡片，Canvas 负责高频游戏渲染。
 */
import { formatTime } from "../utils/math.js";
import { UpgradeSystem } from "../systems/UpgradeSystem.js";
import { MetaProgression } from "../systems/MetaProgression.js";

export class Screens {
  constructor(root) {
    this.root = root;
    // 是否为触摸为主的设备（移动端）：用于隐藏键盘相关提示
    this.isTouch = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  }

  clear() { this.root.innerHTML = ""; }

  _make(html) {
    const div = document.createElement("div");
    div.className = "screen";
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
  showMenu(save, { onStart, onShop }) {
    this.clear();
    const b = save.best;
    const el = this._make(`
      <div class="sub">ROGUELITE · SURVIVOR · 霓虹幸存者</div>
      <h1 class="neon-title">NEON DRIFT</h1>
      <div class="cores-balance">◆ ${save.cores} <span>暗物质核心</span></div>
      <div class="best-row">
        <span>最佳存活 <b>${formatTime(b.time)}</b></span>
        <span>最高击杀 <b>${b.kills}</b></span>
        <span>最高等级 <b>${b.level}</b></span>
        <span>击败母核 <b>${b.bossKills}</b></span>
      </div>
      <div class="menu-btns">
        <button class="btn" id="btn-start">▶ 开始游戏</button>
        <button class="btn btn-2" id="btn-shop">◆ 强化实验室</button>
      </div>
      <div class="hint">移动: W A S D / 方向键 &nbsp;·&nbsp; 暂停: P / ESC &nbsp;·&nbsp; 武器自动开火</div>
    `);
    this.root.appendChild(el);
    el.querySelector("#btn-start").addEventListener("click", onStart);
    el.querySelector("#btn-shop").addEventListener("click", onShop);
  }

  /** 强化实验室：花费核心购买永久升级 */
  showShop(save, { onBuy, onBack }) {
    this.clear();
    const el = this._make(`
      <div class="sub">META LAB · 强化实验室</div>
      <h2 class="neon-title">永久强化</h2>
      <div class="cores-balance">◆ ${save.cores} <span>可用核心</span></div>
      <div class="shop-list"></div>
      <button class="btn" id="btn-back">← 返回</button>
      <div class="hint">永久加成在每局开局自动生效 · 失败也在变强</div>
    `);
    const list = el.querySelector(".shop-list");
    for (const m of MetaProgression.list()) {
      const lv = MetaProgression.levelOf(save, m.id);
      const cost = MetaProgression.costOf(save, m.id);
      const maxed = cost == null;
      const affordable = !maxed && save.cores >= cost;
      const row = document.createElement("div");
      row.className = "shop-row";
      row.style.setProperty("--accent", m.accent);
      row.innerHTML = `
        <div class="shop-icon">${m.icon}</div>
        <div class="shop-info">
          <div class="shop-name">${m.name} <span class="shop-lv">Lv.${lv}/${m.max}</span></div>
          <div class="shop-effect">${m.effect}</div>
          <div class="pips">${this._pips(lv, m.max, m.accent)}</div>
        </div>
        <button class="shop-buy ${maxed ? "maxed" : affordable ? "" : "poor"}" ${maxed || !affordable ? "disabled" : ""}>
          ${maxed ? "满级" : `◆ ${cost}`}
        </button>
      `;
      if (!maxed && affordable) {
        row.querySelector(".shop-buy").addEventListener("click", () => onBuy(m.id));
      }
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
  showPause(player, onResume) {
    this.clear();
    const el = this._make(`
      <h2 class="neon-title">已暂停</h2>
      ${this._loadoutHTML(player, "能力总览")}
      <button class="btn" id="btn-resume">继续</button>
      <div class="hint">按 P / ESC 继续</div>
    `);
    this.root.appendChild(el);
    el.querySelector("#btn-resume").addEventListener("click", onResume);
  }

  /** 结算 */
  showGameOver(stats, { reward, records, save }, { onRestart, onShop, onMenu }) {
    this.clear();
    const tag = (on) => (on ? ` <span class="rec">新纪录!</span>` : "");
    const el = this._make(`
      <div class="sub">SIGNAL LOST</div>
      <h1 class="neon-title" style="color:#ff2bd6">GAME OVER</h1>
      <div class="stat-line">存活时间 <b>${formatTime(stats.time)}</b>${tag(records.time)}</div>
      <div class="stat-line">击杀总数 <b>${stats.kills}</b>${tag(records.kills)}</div>
      <div class="stat-line">到达等级 <b>${stats.level}</b>${tag(records.level)}</div>
      <div class="stat-line">击败母核 <b>${stats.bossKills}</b>${tag(records.bossKills)}</div>
      <div class="reward-box">本局获得 <b>◆ ${reward}</b> &nbsp;·&nbsp; 余额 ◆ ${save.cores}</div>
      <div class="menu-btns">
        <button class="btn" id="btn-restart">↻ 再来一局</button>
        <button class="btn btn-2" id="btn-shop">◆ 强化实验室</button>
        <button class="btn btn-3" id="btn-menu">主菜单</button>
      </div>
    `);
    this.root.appendChild(el);
    el.querySelector("#btn-restart").addEventListener("click", onRestart);
    el.querySelector("#btn-shop").addEventListener("click", onShop);
    el.querySelector("#btn-menu").addEventListener("click", onMenu);
  }
}
