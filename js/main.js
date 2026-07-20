/**
 * main.js — 应用入口。
 * 负责装配依赖、获取 DOM 节点并启动主循环。
 */
import { Game } from "./core/Game.js";

/**
 * 禁用移动端双击放大 / 双指手势缩放.
 * - viewport meta 的 user-scalable=no 在 iOS Safari 10+ 被忽略, 只能靠 CSS + JS.
 * - CSS 已给 body/screen 加了 touch-action: manipulation (禁双击缩放).
 * - 这里再阻止 gesturestart 系列 (双指) 与 dblclick (双击) 兜底.
 * - 使用 passive:false 才能 preventDefault.
 */
function disableMobileZoom() {
  const stop = (e) => e.preventDefault();
  window.addEventListener("dblclick", stop, { passive: false });
  window.addEventListener("gesturestart", stop, { passive: false });
  window.addEventListener("gesturechange", stop, { passive: false });
  window.addEventListener("gestureend", stop, { passive: false });
  // 兜底: 双指 touchmove (Android/一些 WebView 上双指仍会缩放)
  window.addEventListener("touchmove", (e) => {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });
}

function bootstrap() {
  const canvas = document.getElementById("game");
  const uiRoot = document.getElementById("ui-root");
  if (!canvas || !uiRoot) {
    console.error("[NEON DRIFT] 缺少必要的 DOM 节点。");
    return;
  }

  disableMobileZoom();

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
