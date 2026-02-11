import { useSize } from "ahooks";

/**
 * 使用 window.innerHeight 获取视口真实高度，解决 iOS Safari 中 100vh 包含地址栏的问题。
 * 通过 ahooks 的 useSize 监听 document.body 的 resize，自动触发组件重渲染以获取最新的 innerHeight。
 */
export function useWindowHeight(): number {
  // useSize 内部使用 ResizeObserver 监听 body 尺寸变化，
  // 每次 body 尺寸变动（包括 iOS 地址栏显隐导致的 viewport 变化）都会触发 re-render，
  // 此时读取 window.innerHeight 即可拿到最新的视口高度。
  useSize(document.body);
  return typeof window !== "undefined" ? window.innerHeight : 0;
}
