// Tauri v2 웹뷰가 심어 주는 내부 객체의 최소 대역.
//
// 데스크톱 앱의 **화면**을 브라우저 엔진으로 열어 보기 위한 것이다. 이게 없으면
// 앱은 첫 줄에서 `__TAURI_INTERNALS__.metadata` 를 읽다가 죽고 빈 화면만 남는다.
//
// invoke 는 전부 undefined 를 돌려준다 — 네이티브가 없으니 당연히 진짜 답은 없다.
// 파일·DB·창 제어처럼 네이티브 응답이 있어야 진행되는 화면은 여기서 멈춘다.
// 그런 화면을 봐야 하면 이 파일을 복사해 그 명령만 앱에 맞는 값으로 채운다.
window.__TAURI_INTERNALS__ = {
  metadata: {
    currentWindow: { label: 'main' },
    currentWebview: { windowLabel: 'main', label: 'main' },
  },
  plugins: {},
  transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window[`_${id}`] = cb; return id; },
  convertFileSrc: (p) => p,
  invoke: (cmd) => { console.log('[tauri-stub] invoke', cmd); return Promise.resolve(undefined); },
};

// 이벤트 플러그인은 내부 객체를 따로 둔다. 리스너 해제에서 또 죽는다.
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: () => {},
};
