/**
 * main.js — 应用入口。
 * 负责装配依赖、获取 DOM 节点并启动主循环。
 */
import { Game } from "./core/Game.js";

function bootstrap() {
  const canvas = document.getElementById("game");
  const uiRoot = document.getElementById("ui-root");
  if (!canvas || !uiRoot) {
    console.error("[NEON DRIFT] 缺少必要的 DOM 节点。");
    return;
  }

  const game = new Game(canvas, uiRoot);
  requestAnimationFrame((t) => {
    game._lastTime = t;
    game.loop(t);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
