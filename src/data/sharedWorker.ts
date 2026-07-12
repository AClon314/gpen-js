/** 全局数据, source of truth */

export function getTabInfo() {
  const url = new URL(window.location.href);
  const created = performance.now();
  return {
    url,
    created,
  };
}
