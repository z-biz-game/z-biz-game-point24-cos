// Service worker 注册。三条实测约束：
//   ① file:// 下整段跳过且不抛未捕获异常（Electron 直接开 index.html、以及本地双击都要走这支）。
//   ② 注册失败只降级成"不可安装"，不能把游戏本体带崩。
//   ③ 更新要可见：SW 装上后 20s 内没被接管，就在下次导航时提示刷新，而不是让用户永远吃旧包。

export function registerSW() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
  if (typeof location === 'undefined' || location.protocol === 'file:' || !/^https?:$/.test(location.protocol)) {
    return 'skipped';
  }
  if (typeof document === 'undefined' || !('addEventListener' in document)) return 'unsupported';
  const ready = (typeof window !== 'undefined' ? window : self);
  if (!ready || !ready.addEventListener) return 'unsupported';
  ready.addEventListener('load', () => {
    try {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        if (!reg) return;
        const sw = reg.waiting || (reg.installing || null);
        if (sw) sw.postMessage({ type: 'skipWaiting', from: 'point24' });
        reg.addEventListener('updatefound', () => {
          const n = reg.installing;
          if (!n) return;
          n.addEventListener('statechange', () => {
            if (n.state === 'activated' && reg.active) ready.dispatchEvent && ready.dispatchEvent({ type: 'point24:updated' });
          });
        });
      }).catch(() => { /* 不可安装而已，游戏照玩 */ });
    } catch (err) {
      /* 同上 */
    }
  });
  return 'queued';
}
