// drop-bridge.js — ISOLATED world (v1.4.12)
// sidepanel의 chrome.tabs.sendMessage → MAIN world(drop-handler.js)로 릴레이
//
// v1.4.12 변경 — sentinel 토큰 가드 (bridge.js 와 동일 방식):
//   2중 주입되는 경우 두 인스턴스 모두 alive 이므로 같은 TOOLB_DROP_CHAR
//   메시지를 2 번 처리해 파일이 2 번 드롭된다. 로드 시 유일 토큰을
//   window.__toolbDropBridgeToken 에 심고, 리스너 진입부에서 자기 토큰이
//   아니면 즉시 탈출한다.
//
// v1.4.4 변경 — 확장 재로딩 후 살아남은 옛 content script 의 부작용 방지.
//   자세한 배경은 bridge.js 파일 상단 주석 참고.

(function () {
  'use strict';

  /* ── v1.4.12 sentinel 토큰 ─────────────────── */
  var MY_DROP_BRIDGE_TOKEN = 'drop-bridge-v1.4.12-' +
    Math.random().toString(36).slice(2, 10) + '-' + Date.now();
  window.__toolbDropBridgeToken = MY_DROP_BRIDGE_TOKEN;

  function isStaleInstance() {
    return window.__toolbDropBridgeToken !== MY_DROP_BRIDGE_TOKEN;
  }

  function isExtensionAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    // v1.4.12: 구 인스턴스는 토큰 불일치로 즉시 탈출.
    if (isStaleInstance()) return false;

    if (message.type !== 'TOOLB_DROP_CHAR') return false;

    // MAIN world로 이미지 데이터 전달
    window.postMessage(
      {
        __toolb: 'DROP_CHAR',
        imageData: message.imageData,
        fileName: message.fileName
      },
      '*'
    );

    var settled = false;
    var timeoutId = null;

    function finish(result) {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onResult);
      if (timeoutId) clearTimeout(timeoutId);
      try { sendResponse(result); } catch (_) { /* context 이미 죽은 경우 */ }
    }

    function onResult(evt) {
      if (!evt.data || evt.data.__toolb !== 'DROP_CHAR_RESULT') return;
      // 로그는 호출자(upload-handler / video-ext)가 응답을 보고 직접 출력
      finish({
        success: evt.data.success,
        error: evt.data.error,
        method: evt.data.method
      });
    }
    window.addEventListener('message', onResult);

    // MAIN world가 응답 못하는 경우 대비: 15초 타임아웃
    timeoutId = setTimeout(function () {
      finish({ success: false, error: 'DROP_CHAR timeout (no response from MAIN world)' });
    }, 15000);

    return true; // 비동기 응답 유지
  });

  /* ── Flow 생성 진행률 릴레이 ─────────────────── */
  function onFlowProgress(evt) {
    // v1.4.12: 구 drop-bridge 가 남아있다면 자기 리스너 해제하고 탈출.
    if (isStaleInstance()) {
      window.removeEventListener('message', onFlowProgress);
      return;
    }

    if (!evt.data || evt.data.__toolb !== 'FLOW_GEN_PROGRESS') return;

    // 확장 재로딩 후 살아남은 옛 인스턴스면 자기 자신 제거
    if (!isExtensionAlive()) {
      window.removeEventListener('message', onFlowProgress);
      return;
    }

    try {
      chrome.runtime
        .sendMessage({ type: 'TOOLB_GEN_PROGRESS', value: evt.data.value })
        .catch(function () { /* noop */ });
    } catch (_) {
      window.removeEventListener('message', onFlowProgress);
    }
  }
  window.addEventListener('message', onFlowProgress);

  console.log('[ToolB drop-bridge] Loaded (v1.4.12, token: ' + MY_DROP_BRIDGE_TOKEN + ')');
})();
