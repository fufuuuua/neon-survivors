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

    // ---- 顶部：Boss 血条 ----
    if (game.boss && game.boss.active) this._bossBar(ctx, game.boss, W);

    // ---- 左下：已装备武器 ----
    this._weapons(ctx, player, H);

    // ---- 触摸虚拟摇杆 ----
    this._joystick(ctx, game.input);

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

  /** 顶部醒目的 Boss 血条 */
  _bossBar(ctx, boss, W) {
    const w = Math.min(560, W * 0.6);
    const x = (W - w) / 2;
    const y = 84;
    const h = 14;
    const ratio = Math.max(0, boss.hp / boss.maxHp);
    const color = boss.color || "#ff2bd6";
    const name = (boss.def && boss.def.name) || "母核";

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "700 13px 'JetBrains Mono', monospace";
    ctx.fillStyle = color;
    ctx.shadowBlur = 8; ctx.shadowColor = color;
    ctx.fillText(`⚠ ${name}  ${Math.ceil(boss.hp)} / ${Math.round(boss.maxHp)}`, W / 2, y - 8);
    ctx.shadowBlur = 0;

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
