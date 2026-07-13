/**
 * HUD.js — 抬头显示（Canvas 内绘制）。
 * 包含：生命条、经验条、计时器、击杀数、等级、已装备武器图标。
 * 全部以屏幕坐标绘制（在摄像机变换之外）。
 */
import { formatTime, TAU } from "../utils/math.js";

export class HUD {
  render(ctx, game) {
    const { player, stats } = game;
    // 使用 CSS 像素尺寸（ctx 已按 dpr 缩放），保证在高分屏正确居中
    const W = game.viewW;
    const H = game.viewH;
    const narrow = W < 600;                          // 窄屏（移动端竖屏）
    const barW = narrow ? Math.min(W * 0.46, 220) : 260;

    ctx.save();
    ctx.textBaseline = "middle";

    // ---- 计时器 + 击杀数：宽屏居中顶部；窄屏移到右上角（为暂停按钮留出右侧空间）----
    const hx = narrow ? W - 62 : W / 2;
    ctx.textAlign = narrow ? "right" : "center";
    ctx.font = "700 30px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#fff";
    ctx.shadowBlur = 12; ctx.shadowColor = "#00f0ff";
    ctx.fillText(formatTime(stats.time), hx, 34);

    ctx.font = "600 16px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#ff5c8a";
    ctx.shadowColor = "#ff5c8a";
    ctx.fillText(`击杀 ${stats.kills}`, hx, 62);

    ctx.shadowBlur = 0;

    // ---- 左上：生命条 ----
    this._bar(ctx, 24, 28, barW, 20, player.hp / player.maxHp, "#ff2bd6", "#3a0a2a");
    ctx.font = "700 13px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.fillText(`HP ${Math.ceil(player.hp)}/${player.maxHp}`, 30, 38);

    // ---- 左上：经验条 ----
    this._bar(ctx, 24, 56, barW, 12, player.xp / player.xpToNext, "#00f0ff", "#0a2a3a");
    ctx.textAlign = "left";
    ctx.fillStyle = "#8fa9c8";
    ctx.font = "600 12px 'JetBrains Mono', monospace";
    ctx.fillText(`LV ${player.level}`, 30, 62);

    // ---- 顶部：Boss 血条（多个 Boss 并存时纵向排列，互不重叠，各带专属徽标）----
    this._bossBars(ctx, game.bosses, W);

    // ---- 左下：已装备武器 ----
    this._weapons(ctx, player, H);

    // ---- 右下：主动技能冷却盘（仅当皮肤附带主动技能时显示） ----
    if (player.activeSkill) this._activeSkill(ctx, player, W, H);

    // ---- 触摸虚拟摇杆 ----
    this._joystick(ctx, game.input);

    ctx.restore();
  }

  /** 主动技能：右下角圆环冷却盘 + 图标 + 就绪时提示按键 */
  _activeSkill(ctx, player, W, H) {
    const sk = player.activeSkill;
    const cd = sk.cooldown || 1;
    const ready = sk.timer <= 0;
    const ratio = Math.max(0, Math.min(1, 1 - sk.timer / cd));
    const r = 26;
    const cx = W - 40;
    const cy = H - 52;
    const color = ready ? "#7df9ff" : "#3a4356";
    ctx.save();
    // 底盘
    ctx.fillStyle = "rgba(10,14,30,0.85)";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    // 冷却进度圆环（从顶部顺时针填充）
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowBlur = ready ? 12 : 0; ctx.shadowColor = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2, -Math.PI / 2, -Math.PI / 2 + TAU * ratio);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // 图标
    ctx.fillStyle = color;
    ctx.font = "700 22px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(sk.icon || "◎", cx, cy + 1);
    // 就绪提示 / 剩余秒数
    ctx.font = "600 10px 'JetBrains Mono', monospace";
    ctx.fillStyle = ready ? "#aaff00" : "#8fa9c8";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(ready ? "SPACE" : `${sk.timer.toFixed(1)}s`, cx, cy + r + 4);
    ctx.restore();
  }

  /** 绘制浮动虚拟摇杆（仅触摸激活时） */
  _joystick(ctx, input) {
    const j = input && input.joy;
    if (!j || !j.active) return;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "#00f0ff";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(j.cx, j.cy, 60, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#00f0ff";
    ctx.beginPath(); ctx.arc(j.kx, j.ky, 26, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /** 顶部 Boss 血条组：多个 Boss 同时存在时纵向堆叠，各占一行，互不重叠 */
  _bossBars(ctx, bosses, W) {
    if (!bosses || !bosses.length) return;
    const list = bosses.filter((b) => b && b.active);
    if (!list.length) return;

    const w = Math.min(560, W * 0.6);
    const x = (W - w) / 2;
    const rowH = 34;              // 每个 Boss 血条行的总高度（标签 + 血条 + 间距）
    let y = 84;
    for (const boss of list) {
      this._bossBar(ctx, boss, x, y, w);
      y += rowH;
    }
  }

  /** 单个 Boss 血条：左侧专属徽标 + 名称/血量标签 + 血条 */
  _bossBar(ctx, boss, x, y, w) {
    const h = 12;
    const ratio = Math.max(0, boss.hp / boss.maxHp);
    const color = boss.color || "#ff2bd6";
    const name = (boss.def && boss.def.name) || "母核";
    const kind = boss.kind || 0;

    // 徽标绘制在血条左侧，与血条中心竖直对齐
    this._bossEmblem(ctx, x - 14, y + h / 2, 8, kind, color);

    ctx.save();
    // 名称 + 血量（血条上方，左对齐至血条起点）
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 12px 'JetBrains Mono', monospace";
    ctx.fillStyle = color;
    ctx.shadowBlur = 8; ctx.shadowColor = color;
    ctx.fillText(`⚠ ${name}  ${Math.ceil(boss.hp)} / ${Math.round(boss.maxHp)}`, x, y - 4);
    ctx.shadowBlur = 0;

    // 血条底槽 + 前景
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.shadowBlur = 12; ctx.shadowColor = color;
    ctx.fillRect(x, y, w * ratio, h);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.restore();
  }

  /** Boss 专属徽标：与场景内 Boss 造型呼应（母核=八边形 / 裂能体=六角星 / 湮灭者=六边形） */
  _bossEmblem(ctx, cx, cy, r, kind, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 6; ctx.shadowColor = color;
    if (kind === 1) {
      this._emblemStar(ctx, 6, r, r * 0.5);
    } else if (kind === 2) {
      this._emblemPoly(ctx, 6, r);
      this._emblemPoly(ctx, 6, r * 0.6);
    } else {
      this._emblemPoly(ctx, 8, r);
    }
    // 亮核
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.24, 0, TAU); ctx.fill();
    ctx.restore();
  }

  _emblemPoly(ctx, sides, r) {
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * TAU - Math.PI / 2;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.28; ctx.fill();
    ctx.globalAlpha = 1; ctx.stroke();
  }

  _emblemStar(ctx, points, rOuter, rInner) {
    ctx.beginPath();
    for (let i = 0; i <= points * 2; i++) {
      const rr = i % 2 === 0 ? rOuter : rInner;
      const a = (i / (points * 2)) * TAU - Math.PI / 2;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.28; ctx.fill();
    ctx.globalAlpha = 1; ctx.stroke();
  }

  _bar(ctx, x, y, w, h, ratio, color, bg) {
    ratio = Math.max(0, Math.min(1, ratio));
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.shadowBlur = 8; ctx.shadowColor = color;
    ctx.fillRect(x, y, w * ratio, h);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }

  _weapons(ctx, player, viewH) {
    const H = viewH;
    const items = [];
    const w = player.weapons;
    // 每个条目附带一个角标值（连发数 / 球数等关键数值），强化可读性
    if (w.blaster.count > 0) items.push({ w: w.blaster, badge: `×${w.blaster.count}` });
    if (w.orbit.count > 0) items.push({ w: w.orbit, badge: `×${w.orbit.count}` });
    if (w.aura.radius > 0) items.push({ w: w.aura, badge: "" });
    if (w.nova.cooldown > 0) items.push({ w: w.nova, badge: "" });
    if (w.chain.chains > 0) items.push({ w: w.chain, badge: `×${w.chain.chains}` });

    let x = 26;
    const y = H - 52;
    for (const it of items) {
      const wp = it.w;
      ctx.save();
      ctx.fillStyle = "rgba(10,14,30,0.8)";
      ctx.strokeStyle = wp.accent;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 10; ctx.shadowColor = wp.accent;
      this._roundRect(ctx, x, y, 40, 40, 6);
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = wp.accent;
      ctx.font = "22px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(wp.icon, x + 20, y + 20);
      // 角标
      if (it.badge) {
        ctx.font = "700 12px 'JetBrains Mono', monospace";
        ctx.fillStyle = "#fff";
        ctx.textAlign = "right";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(it.badge, x + 38, y + 38);
      }
      ctx.restore();
      x += 48;
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
