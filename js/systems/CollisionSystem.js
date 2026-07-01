/**
 * CollisionSystem.js — 碰撞检测系统。
 * 处理：子弹↔敌人、敌人↔玩家、拾取物↔玩家。
 * 子弹↔敌人 经空间网格查询近邻，将复杂度从 O(子弹·敌人) 降到近似 O(子弹)。
 * 采用平方距离比较避免开方，性能友好。
 */
import { Vector2 } from "../utils/Vector2.js";
import { DropType } from "../entities/XPGem.js";

// 网格查询时额外扩展的半径，需覆盖最大敌人半径（Boss=52）
const MAX_ENEMY_RADIUS = 56;

export class CollisionSystem {
  constructor(game) {
    this.game = game;
  }

  update(dt) {
    this._projectilesVsEnemies();
    this._enemiesVsPlayer(dt);
    this._enemyBulletsVsPlayer();
    this._pickupsVsPlayer();
  }

  _projectilesVsEnemies() {
    const { projectiles, grid } = this.game;
    for (const p of projectiles) {
      if (!p.active) continue;
      grid.queryCircle(p.x, p.y, p.radius + MAX_ENEMY_RADIUS, (e) => {
        if (!e.active || p.hitSet.has(e)) return;
        const r = p.radius + e.radius;
        if (Vector2.distSq(p, e) <= r * r) {
          this.game.damageEnemy(e, p.damage, true, p.x, p.y);
          p.hitSet.add(e);
          if (p.pierce-- <= 0) { p.active = false; return true; } // 终止本子弹查询
        }
      });
    }
  }

  _enemiesVsPlayer(dt) {
    const { grid, player } = this.game;
    grid.queryCircle(player.x, player.y, player.radius + MAX_ENEMY_RADIUS, (e) => {
      if (!e.active) return;
      const r = e.radius + player.radius;
      if (Vector2.distSq(e, player) <= r * r) {
        player.takeDamage(e.damage, this.game); // 接触伤害（受无敌帧限制）
      }
    });
  }

  /** 敌方弹幕命中玩家 */
  _enemyBulletsVsPlayer() {
    const { enemyProjectiles, player } = this.game;
    for (const b of enemyProjectiles) {
      if (!b.active) continue;
      const r = b.radius + player.radius;
      if (Vector2.distSq(b, player) <= r * r) {
        player.takeDamage(b.damage, this.game);
        b.active = false;
      }
    }
  }

  _pickupsVsPlayer() {
    const { gems, player } = this.game;
    for (const g of gems) {
      if (!g.active) continue;
      const r = g.radius + player.radius;
      if (Vector2.distSq(g, player) <= r * r) {
        this._collect(g);
        g.active = false;
      }
    }
  }

  _collect(g) {
    const game = this.game;
    switch (g.type) {
      case DropType.XP:
        game.player.gainXp(g.value, game);
        game.audio.pickup();
        break;
      case DropType.HEAL:
        game.player.heal(25);
        game.particles.text(game.player.x, game.player.y - 30, "+25 HP", "#aaff00");
        game.audio.pickup();
        break;
      case DropType.MAGNET:
        // 吸附全场经验
        for (const x of game.gems) if (x.active && x.type === DropType.XP) x.attracted = true;
        game.particles.text(game.player.x, game.player.y - 30, "磁吸!", "#ffd23f");
        game.audio.levelup();
        break;
      case DropType.BOMB:
        // 清屏炸弹：对全场敌人造成大量伤害
        game.camera.shake(26);
        game.particles.burst(game.player.x, game.player.y, "#ff2bd6", 60, 500, 4, 0.8);
        for (const e of game.enemies) {
          if (e.active && !e.isBoss) game.damageEnemy(e, 9999, false);
          else if (e.active) game.damageEnemy(e, 300, false);
        }
        game.particles.text(game.player.x, game.player.y - 30, "湮灭!", "#ff2bd6");
        game.audio.nova();
        break;
    }
  }
}
