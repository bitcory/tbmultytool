/* bridge.js — ISOLATED world (v1.4.12)
 *
 * sidepanel / service-worker ↔ MAIN world page-script 간 메시지 릴레이.
 *
 * - chrome.runtime.onMessage(커맨드) → window.postMessage 로 MAIN 에 전달
 *   커맨드 타입(START_BATCH 등)인 경우 MAIN 의 RESPONSE 를 기다렸다가 sendResponse
 * - MAIN → window.postMessage(source:'flowbulk-page-tbm', type:'EVENT')
 *   chrome.runtime.sendMessage 로 서비스워커/사이드패널에 전달
 *   DOWNLOAD_IMAGE 는 응답까지 받아서 MAIN 쪽으로 _RESULT 이벤트 릴레이
 *
 * v1.4.12 변경 — ISOLATED world sentinel 가드:
 *   bridge.js 가 2중 주입된 경우(manifest 자동 주입 + SW 의 ensureContentScripts
 *   race 등) 두 인스턴스 모두 chrome.runtime 이 살아있어서 같은 메시지를
 *   두 번 처리, 결국 모든 LOG 와 DOWNLOAD_IMAGE 가 2 번씩 발화된다.
 *   (v1.4.4 의 isExtensionAlive() 체크는 *구 확장의 죽은* 인스턴스만 걸러냄.)
 *
 *   해결: MAIN world(v1.4.9) 와 동일한 토큰 sentinel 을 도입.
 *   로드마다 유일 토큰을 window.__toolbBridgeToken 에 심고, 모든 리스너
 *   진입부에서 자기 토큰이 아니면 즉시 탈출한다. 뒤에 주입된 bridge 가
 *   토큰을 덮어쓰므로 이전 bridge 는 조용히 비활성화된다.
 *
 * v1.4.4 변경 — 확장 재로딩 후 살아남은 옛 인스턴스 처리:
 *   Chrome 은 확장을 재로딩해도 페이지에 이미 실행 중이던 content script 를
 *   제거하지 않는다 (window 이벤트 리스너로 계속 살아있음). 그러나 그
 *   스크립트의 chrome.runtime.* 는 전부 죽는다 → "Extension context
 *   invalidated" 가 발생하고, 게다가 service-worker 가 새 bridge 를 주입하면
 *   옛 bridge + 새 bridge 가 동시에 postMessage 를 듣는 상태가 된다.
 *   감지되면 옛 bridge 가 자기 리스너를 해제하고 조용히 빠지도록 한다.
 */
(function () {
  'use strict';

  /* ── v1.4.12 sentinel 토큰 ─────────────────
   * 이 인스턴스만의 고유 토큰. 뒤에 주입된 bridge 가 토큰을 덮어쓰면
   * 이전 인스턴스의 리스너들은 자기 토큰과 불일치를 감지하고 조용히 빠진다. */
  var MY_BRIDGE_TOKEN = 'bridge-v1.4.12-' +
    Math.random().toString(36).slice(2, 10) + '-' + Date.now();
  window.__toolbBridgeToken = MY_BRIDGE_TOKEN;

  function isStaleInstance() {
    return window.__toolbBridgeToken !== MY_BRIDGE_TOKEN;
  }

  var COMMAND_TYPES = [
    'START_BATCH',
    'PAUSE_BATCH',
    'RESUME_BATCH',
    'STOP_BATCH',
    'GET_STATUS',
    'PING'
  ];

  function isExtensionAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  // MV3 lifecycle 상 "정상적으로" 발생하는 일시적 오류들.
  // 이 패턴에 맞으면 조용히 삼킨다 (warning 찍지 않음).
  //   - Extension context invalidated     : 확장 재로딩
  //   - could not establish connection    : SW 부팅 중 receiver 없음
  //   - receiving end does not exist      : SW 종료 상태
  //   - message port closed ...           : 응답 채널이 먼저 닫힘
  //   - back/forward cache                : bfcache 로 페이지가 일시 비활성
  //   - no SW / service worker ...        : SW 레지스트레이션 전환
  var TRANSIENT_ERR_RE =
    /Extension context invalidated|could not establish connection|receiving end does not exist|message port closed|back\/forward cache|no SW|service worker/i;

  function isTransientSendError(err) {
    var msg = (err && err.message) || String(err || '');
    return TRANSIENT_ERR_RE.test(msg);
  }

  function isContextInvalidated(err) {
    var msg = (err && err.message) || String(err || '');
    return /Extension context invalidated/i.test(msg);
  }

  // ── chrome.runtime → MAIN ─────────────────────
  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    // v1.4.12: 구 인스턴스의 리스너는 토큰 불일치로 즉시 탈출.
    if (isStaleInstance()) return false;

    if (!msg || !msg.type) return false;

    // service-worker 의 ensureContentScripts() 가 보내는 health-check.
    // 응답하지 않으면 SW 가 "미로드" 로 판단하고 bridge 를 한 번 더 주입 →
    // 같은 이벤트가 두 번 처리되어 로그가 중복된다. 응답만 하고 끝낸다.
    if (msg.type === 'TOOLB_PING') {
      try { sendResponse({ ok: true, v: '1.4.12', token: MY_BRIDGE_TOKEN }); } catch (_) {}
      return false;
    }

    window.postMessage({ source: 'flowbulk-bridge-tbm', payload: msg }, '*');

    if (COMMAND_TYPES.indexOf(msg.type) === -1) return false;

    var handler = function (evt) {
      if (evt.source !== window) return;
      var d = evt.data;
      if (!d || d.source !== 'flowbulk-page-tbm' || d.type !== 'RESPONSE') return;
      window.removeEventListener('message', handler);
      sendResponse(d.payload);
    };
    window.addEventListener('message', handler);
    // 10초 내에 응답 없으면 리스너 정리 (sendResponse 는 자동 무효화됨)
    setTimeout(function () {
      window.removeEventListener('message', handler);
    }, 10000);
    return true; // 비동기 응답 유지
  });

  // ── MAIN EVENT → chrome.runtime ───────────────
  function postDownloadResult(payload, ok, response, errorText) {
    window.postMessage({
      source: 'flowbulk-bridge-tbm',
      payload: {
        type: 'DOWNLOAD_IMAGE_RESULT',
        success: !!ok,
        error: ok ? null : (errorText || (response && response.error) || 'unknown'),
        requestedFilename: (response && response.requestedFilename) || payload.filename,
        finalFilename: (response && response.finalFilename) || payload.filename,
        fallbackUsed: !!(response && response.fallbackUsed),
        downloadId: (response && response.downloadId) || null
      }
    }, '*');

    if (!ok && isExtensionAlive()) {
      var fn = (response && response.requestedFilename) || payload.filename || '(unknown)';
      var er = errorText || (response && response.error) || 'unknown';
      try {
        chrome.runtime
          .sendMessage({ type: 'LOG', text: '다운로드 실패: ' + fn + ' (' + er + ')', level: 'error' })
          .catch(function () {});
      } catch (_) { /* context 이미 죽은 경우 */ }
    }
  }

  // sendMessage 실패를 단일 경로로 처리:
  //   1) 컨텍스트 완전 사망: 자기 리스너 해제하고 조용히 빠짐
  //   2) 기타 transient lifecycle 오류: DOWNLOAD_IMAGE 면 결과 전달, 로그는 찍지 않음
  //   3) 알 수 없는 오류만 console.warn 남김
  function handleSendFailure(payload, err) {
    var msg = (err && err.message) || String(err || '');

    if (!isExtensionAlive() || isContextInvalidated(err)) {
      window.removeEventListener('message', onPageEvent);
      if (payload.type === 'DOWNLOAD_IMAGE') {
        postDownloadResult(payload, false, null, msg);
      }
      return;
    }

    if (!isTransientSendError(err)) {
      console.warn('[FlowBulk Bridge] sendMessage failed:', err);
    }
    // transient 든 unknown 이든, DOWNLOAD_IMAGE 는 결과를 MAIN 에 돌려줘야
    // page-script 가 실패를 인지하고 타임아웃 없이 다음으로 진행 가능.
    if (payload.type === 'DOWNLOAD_IMAGE') {
      postDownloadResult(payload, false, null, msg);
    }
  }

  function onPageEvent(evt) {
    // v1.4.12: 구 bridge 가 이 리스너에 남아있다면 즉시 해제하고 탈출.
    if (isStaleInstance()) {
      window.removeEventListener('message', onPageEvent);
      return;
    }

    if (evt.source !== window) return;
    var d = evt.data;
    if (!d || d.source !== 'flowbulk-page-tbm' || d.type !== 'EVENT') return;
    var payload = d.payload;
    if (!payload) return;

    // 확장이 재로딩되어 이 content script 의 runtime 컨텍스트가 죽었다면
    // 새로 주입된 bridge 가 동일 이벤트를 처리하므로, 여기서는 자신을
    // 해제하고 조용히 빠진다.
    if (!isExtensionAlive()) {
      window.removeEventListener('message', onPageEvent);
      return;
    }

    var pending;
    try {
      pending = chrome.runtime.sendMessage(payload);
    } catch (err) {
      handleSendFailure(payload, err);
      return;
    }

    Promise.resolve(pending)
      .then(function (response) {
        if (payload.type !== 'DOWNLOAD_IMAGE') return;
        postDownloadResult(payload, !!(response && response.success), response || null);
      })
      .catch(function (err) {
        handleSendFailure(payload, err);
      });
  }
  window.addEventListener('message', onPageEvent);

  console.log('[FlowBulk Bridge] Loaded (v1.4.12 — sentinel guard, token: ' + MY_BRIDGE_TOKEN + ')');
})();
