/* page-script.js — MAIN world (v1.6.1)
 *
 * Flow(labs.google/fx) 자동화 엔진. 난독화된 구버전을 대체.
 *
 * v1.6.1 변경 — Flow send 버튼 isTrusted 가드 우회.
 *   Flow 가 send 버튼 onClick 에서 event.isTrusted 를 검사하여 확장의 합성
 *   이벤트(el.click() / dispatchEvent)를 모두 무시하기 시작. 이미지 모드에서
 *   "Generate! 로그는 찍히는데 실제 생성 시작 안 됨" 증상의 근본 원인.
 *   → React 가 element 에 attach 한 __reactProps$xxx.onClick 핸들러를
 *      직접 호출하고, isTrusted: true 를 가진 가짜 SyntheticEvent 흉내 객체를
 *      넘김. 핸들러 안의 isTrusted 검사는 native event 가 아닌 우리 객체를
 *      보므로 통과. 비디오 모드는 isTrusted 가드가 없어 native click 으로도
 *      되던 것이 모드별 동작 차이의 원인이었음.
 *   findGenerateBtn() 도 정확도 향상 — arrow_forward 아이콘 + sr-only "만들기"
 *   span 조합으로 1순위 매칭, disabled/aria-disabled 후보 스킵.
 *
 * v1.4.10 변경 — 저장 파일명 NFC 정규화. macOS 가 NFD 로 저장하면 이후
 *   Flow 에 재첨부했을 때 자산명 매칭이 깨지는 문제 해결. sanitizeFilename
 *   을 경유하는 모든 세그먼트(memo/id/folder/prefix) 가 자동으로 NFC 가 된다.
 *   expandPrompts 에서도 parsed.id / parsed.memo 를 NFC 로 통일.
 *
 * v1.4.9 변경 — "확장 재로드 후 구버전 인스턴스 리스너 중복" 방지 가드.
 *   MAIN world 스크립트는 chrome.runtime.id 같은 extension-alive 체크를 쓸 수 없어서
 *   확장 재로딩 시 구 인스턴스의 window.addEventListener('message') 가 그대로 남는다.
 *   결과: 한 번의 START_BATCH 가 구·신 인스턴스에서 동시에 처리돼 3×/9× 중복 실행.
 *   → 로드마다 유일 토큰을 만들어 window.__toolbPageToken 에 저장하고,
 *      리스너 진입부에서 자기 토큰과 다르면 조기 return.
 *
 * 장점(from nano-banana-auto) 을 전부 수용:
 *   1) data-tile-id 단위 per-prompt 추적 (어떤 프롬프트의 어떤 배치가 실패했는지 정확)
 *   2) batch count 인식 (x1/x2/x3/x4 → 타일 N개 모두 settled 될 때까지 대기)
 *   3) 타임아웃 시 부분 저장 (이미 뜬 이미지는 살림)
 *   4) 슬롯 파이프라인 — concurrent=2 일 때 30% / 80% 체크포인트로 선행 요청
 *   5) 다운로드 간 300~600ms 랜덤 jitter (Chrome 이 동시 다운로드를 드롭하는 문제 방지)
 *   6) 파일명: nameMode 에 따라 분기 — 자동/ID 우선/메모 우선/접두사+인덱스
 *      · 배치 ≥2 이면 `_1`, `_2` suffix (≥10 은 `_01` 제로패딩)
 *      · 같은 이름 충돌 시 `_dup1`, `_dup2` 자동 부여
 *
 * 메시지 프로토콜 / 설정 스키마:
 *   settings = {
 *     prompts: string[],
 *     imageMode: 'search' | 'none',
 *     charSearchQueries?: string[],     // 레거시 단일 큐
 *     charPromptQueues?: Array<string[]|null>, // sidepanel-ext 씬 매트릭스
 *     delayMin, delayMax,               // 프롬프트 간 딜레이(초)
 *     autoDownload: boolean,
 *     filenamePrefix: string,           // 예: 'tb_scene'
 *     folderOverride?: string,          // 비어있으면 ToolB_YYYYMMDD_HHMM. '/' 로 서브폴더 허용
 *     nameMode?: 'auto'|'id'|'memo'|'prefix',  // 파일명 규칙 (기본 'auto')
 *     genTimeout?: number,              // 기본 180초
 *     concurrent?: number,              // 1|2|3 (2 이상이면 파이프라인)
 *     count?: 'x1'|'x2'|'x3'|'x4',      // Flow 배치 수 — 타일 대기 개수
 *   }
 */

(function () {
  'use strict';

  // labs.google 이 아닌 곳엔 아무것도 하지 않음 (SPA 내 iframe 등)
  if (!location.hostname.includes('labs.google')) return;

  /* ── v1.4.9 sentinel 가드 ────────────────────
   * 이 인스턴스만의 고유 토큰을 만들어 window 에 심는다.
   * 확장 재로드 시 새 인스턴스가 토큰을 덮어쓰면, 구 인스턴스의
   * 리스너는 진입부 가드에서 자동 조기 return → 중복 실행 제거. */
  var MY_PAGE_TOKEN = 'page-v1.4.9-' +
    Math.random().toString(36).slice(2, 10) + '-' + Date.now();
  window.__toolbPageToken = MY_PAGE_TOKEN;

  /* ════════════════════════════════════════════
   * 상태
   * ════════════════════════════════════════════ */
  var state = {
    sessionId: 0,        // 배치 세션 ID (cancel-after-restart 방지)
    running: false,
    paused: false,
    settings: null,
    prompts: [],
    currentIndex: 0,
    successCount: 0,
    failedIndexes: []    // 실패한 프롬프트 인덱스(0-based)
  };

  var MAX_SLOTS = 2;
  var knownTileIds = new Set();
  var activeGens = [];
  var watcherRunning = false;
  var downloadedSrcs = new Set();

  var folderName = '';
  var filenamePrefix = 'tb_scene';
  var autoDownload = true;
  var nameMode = 'auto';           // 'auto' | 'id' | 'memo' | 'prefix'
  var assetMode = 'plus';          // 'plus' (+ 버튼) | 'mention' (@ 인라인)
  var usedFilenames = new Set();   // 세션 내 파일명 충돌 회피

  // 이미지가 "완성" 으로 감지된 뒤 src 가 프리뷰→최종으로 swap 할 시간을 주기 위한 대기 (ms)
  // NB2 는 0 (즉시 다운로드) 이지만, Flow 가 간혹 src 를 바꾸는 케이스 대응용으로 기본 2000 ms.
  var DOWNLOAD_STABILIZATION_MS = 2000;

  // v1.4.18: 타일 수 grace period.
  // 사이드패널 장수(batchCount) 와 Flow UI 실제 생성 장수가 불일치하는 상황
  // (예: 사이드패널 x2, Flow 는 1장만 주는 경우) 에서 180초 하드 타임아웃 대신
  // "첫 타일 settled 이후 N 초 내 추가 타일 없으면 조기 완료" 로 처리.
  // Flow 가 실제로 batchCount 전부 줄 경우 영향 없음 (즉시 allSettled).
  var TILE_GRACE_MS = 15000;

  // Windows 예약 파일명 (확장자 무관 금지)
  var WIN_RESERVED_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

  /* ════════════════════════════════════════════
   * 유틸
   * ════════════════════════════════════════════ */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function randSleep(minMs, maxMs) {
    return sleep(minMs + Math.random() * (maxMs - minMs));
  }
  function p2(n) { return String(n).padStart(2, '0'); }

  // 폴더 경로 sanitize:
  //   - `/` 서브폴더 허용 (예: "MyProject/batch1")
  //   - 절대경로(앞의 `/`, `\`, `C:`) 및 `..` 탈출 차단
  //   - 각 세그먼트에 대해 sanitizeFilename 적용
  //   - 빈 입력 → 기본 ToolB_YYYYMMDD_HHMM
  function sanitizeFolderPath(raw) {
    var s = String(raw == null ? '' : raw).replace(/\\/g, '/').trim();
    // 선행 슬래시/드라이브 제거
    s = s.replace(/^\/+/, '').replace(/^[a-zA-Z]:\/?/, '');
    var parts = s.split('/').map(function (seg) {
      var t = String(seg || '').trim();
      if (!t || t === '.' || t === '..') return '';
      return sanitizeFilename(t);
    }).filter(Boolean);
    return parts.join('/');
  }

  function defaultFolderName() {
    var d = new Date();
    return 'ToolB_' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) +
           '_' + p2(d.getHours()) + p2(d.getMinutes());
  }

  function makeFolderName(override) {
    var cleaned = sanitizeFolderPath(override);
    return cleaned || defaultFolderName();
  }

  function nfc(s) {
    try { return (s == null ? '' : String(s)).normalize('NFC'); }
    catch (_) { return s == null ? '' : String(s); }
  }

  /* ════════════════════════════════════════════
   * NB2 포맷 파서 (nano-banana-auto 스타일)
   *   "id | memo | prompt"  |  "id | prompt"  |  plain
   * 프롬프트 안의 @[이름] 토큰은 자산 참조로 추출.
   * ════════════════════════════════════════════ */
  var NB2_LINE_RE = /^\s*\S+\s*\|/;

  function parseNB2Line(line) {
    var parts = line.split('|');
    if (parts.length < 2) return null;
    if (parts.length === 2) {
      return { id: parts[0].trim(), memo: '', text: parts[1].trim() };
    }
    return {
      id: parts[0].trim(),
      memo: parts[1].trim(),
      text: parts.slice(2).join('|').trim()
    };
  }

  function extractAssetNames(text) {
    var out = [];
    var re = /@\[([^\]]+)\]/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var n = nfc(m[1]).trim();
      if (n && out.indexOf(n) === -1) out.push(n);
    }
    return out;
  }

  // Mode B 에서 사용: @[이름] 토큰을 본문에서 제거하고 인접 공백/쉼표 정리.
  //   - "@[검사] walks"         → "walks"
  //   - "walks with @[검사]."  → "walks with ."
  //   - "@[A], @[B] and @[C]" → ", and" → "and"
  //   - 맨 앞/뒤 공백도 trim
  function stripAtTokens(text) {
    var s = String(text == null ? '' : text);
    // 토큰과 인접한 공백 한 묶음까지 같이 제거
    s = s.replace(/\s*@\[[^\]]+\]\s*/g, ' ');
    // 토큰 제거로 생긴 연속 쉼표/공백 정리: ", ," → ",", " ," → ","
    s = s.replace(/\s*,\s*,\s*/g, ', ');
    s = s.replace(/^\s*,\s*|\s*,\s*$/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  // 파일명 sanitize (한 세그먼트용):
  //   - v1.4.10: NFC 정규화를 가장 먼저 — macOS 가 NFD 로 저장하면
  //     이후 Flow 재첨부 시 자산명 매칭이 깨짐. 업로드 측(drop-handler) 이
  //     이미 NFC 변환하므로 저장 측도 NFC 로 맞춰야 일관된다.
  //   - Windows/macOS 에서 허용 안 되는 문자 → '_'
  //   - 연속 공백 → 단일 공백
  //   - 앞뒤 공백/점(.) 제거 (Windows 는 끝점 파일을 저장 시 잘라냄)
  //   - Windows 예약명(CON, PRN, …) → 앞에 '_' 추가
  //   - 최대 80자
  //   - 빈 결과 → 'file'
  function sanitizeFilename(s) {
    var raw = String(s == null ? '' : s);
    try { raw = raw.normalize('NFC'); } catch (_) { /* 구 브라우저 폴백 */ }
    var cleaned = raw
      .replace(/[\\/:*?"<>|\x00-\x1f\r\n\t]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 80);
    if (!cleaned) return 'file';
    if (WIN_RESERVED_RE.test(cleaned)) cleaned = '_' + cleaned;
    return cleaned;
  }

  // 세션 내 파일명 충돌 회피 — 같은 파일명이 이미 있으면 _dup1, _dup2 ...
  function uniquifyFilename(fullPath) {
    if (!usedFilenames.has(fullPath)) {
      usedFilenames.add(fullPath);
      return fullPath;
    }
    var dot = fullPath.lastIndexOf('.');
    var stem = dot > 0 ? fullPath.slice(0, dot) : fullPath;
    var ext = dot > 0 ? fullPath.slice(dot) : '';
    for (var i = 1; i < 9999; i++) {
      var cand = stem + '_dup' + i + ext;
      if (!usedFilenames.has(cand)) {
        usedFilenames.add(cand);
        return cand;
      }
    }
    // 사실상 도달 불가
    usedFilenames.add(fullPath);
    return fullPath;
  }

  // 빈 줄(\n\n)로 나뉘어 온 raw 를 한 번 더 펼침: 라인들이 모두 NB2 포맷이면 각각 개별 프롬프트로.
  function expandPrompts(rawList) {
    var out = [];
    rawList.forEach(function (raw) {
      var rawStr = String(raw || '');
      var lines = rawStr.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);

      var allNB2 = lines.length > 0 && lines.every(function (l) {
        return NB2_LINE_RE.test(l) && l.split('|').length >= 2;
      });

      if (allNB2) {
        lines.forEach(function (l) {
          var parsed = parseNB2Line(l);
          if (parsed && parsed.text) {
            out.push({
              // v1.4.10: id/memo 도 NFC 정규화 — 저장 파일명에 쓰이는 값이라
              // 맥 NFD 입력이 그대로 흘러들어가지 않도록 차단
              id: nfc(parsed.id),
              memo: nfc(parsed.memo),
              text: nfc(parsed.text),
              assetNames: extractAssetNames(parsed.text),
              isNB2: true
            });
          }
        });
      } else {
        out.push({
          id: null,
          memo: null,
          text: nfc(rawStr),
          assetNames: extractAssetNames(rawStr),
          isNB2: false
        });
      }
    });
    return out;
  }

  /* 파일명 규칙 (nameMode 별):
   *
   *   common: batchTotal ≥ 2 이면 `_1`, `_2` suffix 부여 (10 이상이면 `_01` 제로패딩).
   *           동일 파일명 충돌 시 `_dup1`, `_dup2` 로 회피.
   *
   *   - 'auto'   : memo 가 짧고 공백 없으면 memo → id → prefix+promptIdx (기본/현행 유지)
   *   - 'id'     : NB2 id 무조건 우선, 없으면 prefix fallback
   *   - 'memo'   : NB2 memo 무조건 우선, 없으면 id → prefix fallback
   *   - 'prefix' : 무조건 `{prefix}{promptIdx+1}` (NB2 id/memo 무시 — 순번 기반)
   */
  function buildBatchSuffix(batchIdx, batchTotal) {
    var bi = (batchIdx == null ? 0 : batchIdx) + 1;
    if ((batchTotal || 1) <= 1) return '';
    return batchTotal >= 10 ? '_' + p2(bi) : '_' + bi;
  }

  // Flow CDN 이 실제로는 JPEG 을 돌려주는 케이스가 많다. 우리가 ".png" 로 요청하면
  // Chrome/다른 확장이 Content-Type 에 맞춰 ".jpeg" 로 보정하여 파일명 불일치
  // 경고가 뜬다. URL 에서 확장자를 직접 추정해서 그에 맞춘다 (기본값은 .jpeg).
  function extFromUrl(url) {
    try {
      var u = new URL(url, location.href);
      var pathname = u.pathname || '';
      var m = pathname.match(/\.([a-zA-Z0-9]{2,4})$/);
      if (m) {
        var ext = m[1].toLowerCase();
        // Flow 에서 관측되는 이미지 확장자만 허용
        if (['jpg', 'jpeg', 'png', 'webp', 'gif'].indexOf(ext) !== -1) {
          return ext === 'jpg' ? 'jpeg' : ext;
        }
      }
    } catch (_) { /* URL 파싱 실패 시 기본값 */ }
    return 'jpeg'; // Flow 의 일반적인 기본값
  }

  function joinAndUnique(base, batchIdx, batchTotal, ext) {
    var e = ext || 'png';
    var path = folderName + '/' + base + buildBatchSuffix(batchIdx, batchTotal) + '.' + e;
    return uniquifyFilename(path);
  }

  function pickMemo(parsed) {
    if (!parsed || !parsed.isNB2 || !parsed.memo) return '';
    var m = sanitizeFilename(parsed.memo);
    return m === 'file' ? '' : m;
  }

  function pickId(parsed) {
    if (!parsed || !parsed.isNB2 || !parsed.id) return '';
    var id = sanitizeFilename(parsed.id);
    return id === 'file' ? '' : id;
  }

  function pickPrefixBase(fallbackIdx) {
    var idx = (fallbackIdx == null ? 0 : fallbackIdx) + 1;
    var pfx = sanitizeFilename(filenamePrefix || 'tb_scene');
    return pfx + idx;
  }

  function buildFilename(parsed, batchIdx, fallbackIdx, batchTotal, ext) {
    var mode = nameMode || 'auto';
    var memo = pickMemo(parsed);
    var id   = pickId(parsed);
    var base;

    if (mode === 'id') {
      base = id || pickPrefixBase(fallbackIdx);
    } else if (mode === 'memo') {
      base = memo || id || pickPrefixBase(fallbackIdx);
    } else if (mode === 'prefix') {
      base = pickPrefixBase(fallbackIdx);
    } else {
      // 'auto' — 기존 휴리스틱 유지: memo 가 짧은 자산명스러울 때만 우선
      var memoLooksAsset = memo && memo.length <= 30 && !/\s/.test(memo);
      base = memoLooksAsset ? memo : (id || pickPrefixBase(fallbackIdx));
    }

    return joinAndUnique(base, batchIdx, batchTotal, ext);
  }

  function sendEvent(payload) {
    try {
      window.postMessage({ source: 'flowbulk-page-tbm', type: 'EVENT', payload: payload }, '*');
    } catch (_) { /* noop */ }
  }
  function sendResponse(payload) {
    try {
      window.postMessage({ source: 'flowbulk-page-tbm', type: 'RESPONSE', payload: payload }, '*');
    } catch (_) { /* noop */ }
  }
  function log(text, level) {
    sendEvent({ type: 'LOG', text: text, level: level || 'info' });
    console.log('[FlowBulk] ' + text);
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent === null) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.disabled;
  }

  /* ════════════════════════════════════════════
   * 에디터 / 버튼 / 타일
   * ════════════════════════════════════════════ */
  var PROMPT_INPUT_SELECTORS = [
    '[role="textbox"][contenteditable="true"]',
    '[data-slate-editor="true"][contenteditable="true"]',
    '[role="textbox"]',
    'textarea'
  ];

  function findEditor() {
    for (var i = 0; i < PROMPT_INPUT_SELECTORS.length; i++) {
      var el = document.querySelector(PROMPT_INPUT_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  /* ════════════════════════════════════════════
   * v1.6.6 — 에이전트 모드 강제 OFF
   *
   * 2026-06 Flow UI 는 기본적으로 "에이전트" 모드로 켜져 있어, send 가 모두 에이전트
   * 채팅 세션으로 들어간다. 그 경우:
   *   - 결과 이미지가 메인 그리드(data-tile-id)가 아닌 우측 에이전트 응답 안에 표시 →
   *     워처가 완료 감지 못 함
   *   - 한 번에 한 턴씩만 처리돼 빠른 연속 send 가 막힘
   *   - 자산 칩이 send 후 자동 제거되는 등 흐름 가정 깨짐
   * 해결: 배치 시작 직전에 "에이전트" 버튼(aria-pressed="true")을 React onClick 으로
   *       토글해서 OFF. OFF 상태에서는 입력란 옆에 🍌 Nano Banana / 1x 같은 모델/장수
   *       칩이 노출되는 클래식 직접 생성 UI 로 복귀.
   * 콘텐츠가 있는 프로젝트는 진입 시 우측 에이전트 사이드패널이 열려있을 수도 있어
   * 그것도 X(close) 버튼으로 자동 닫음. (사이드패널이 닫혀있는 상태에선 no-op)
   * ════════════════════════════════════════════ */
  async function closeAgentSidePanel() {
    // 우측 사이드 패널의 "제목 없는 세션" / 닫기(X) 버튼 찾기.
    // 패널 자체는 우측에 위치한 비교적 좁은 영역. 그 안의 close 아이콘 버튼 = X.
    var W = window.innerWidth;
    var closeBtn = null;
    document.querySelectorAll('button').forEach(function (b) {
      var i = b.querySelector('i');
      if (!i) return;
      if ((i.textContent || '').trim() !== 'close') return;
      if (!isVisible(b)) return;
      var r = b.getBoundingClientRect();
      // 우측 패널 상단 (x > W*0.65, y < 200) 에 있는 close 만
      if (r.x < W * 0.65) return;
      if (r.y > 200) return;
      closeBtn = b;
    });
    if (!closeBtn) return false;
    dispatchRealClick(closeBtn);
    await sleep(300);
    return true;
  }

  async function ensureAgentModeOff() {
    // "에이전트" / "Agent" 텍스트를 가진 토글 버튼 탐색.
    // v1.6.8: UI 가 막 로드된 직후엔 칩이 아직 안 떴을 수 있어 최대 2초 폴링.
    //   매칭은 정확 + 부분 매칭 둘 다 시도. aria-pressed 속성 가진 버튼 우선.
    function findToggle() {
      var btns = document.querySelectorAll('button');
      // 1순위: 텍스트 정확 매칭 + aria-pressed 속성 보유
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (!isVisible(b)) continue;
        var t = (b.textContent || '').replace(/\s+/g, ' ').trim();
        if ((t === '에이전트' || t === 'Agent' || t === 'Agentic') &&
            b.hasAttribute('aria-pressed')) return b;
      }
      // 2순위: 부분 매칭 + aria-pressed
      for (var j = 0; j < btns.length; j++) {
        var b2 = btns[j];
        if (!isVisible(b2)) continue;
        var t2 = (b2.textContent || '').replace(/\s+/g, ' ').trim();
        if (t2.length > 20) continue;
        if ((t2.indexOf('에이전트') !== -1 || t2.toLowerCase().indexOf('agent') !== -1) &&
            b2.hasAttribute('aria-pressed')) return b2;
      }
      return null;
    }

    var btn = null;
    var findDl = Date.now() + 2000;
    while (Date.now() < findDl) {
      btn = findToggle();
      if (btn) break;
      await sleep(150);
    }
    if (!btn) return { ok: false, reason: 'no-toggle' };
    var pressed = btn.getAttribute('aria-pressed');
    var btnLabel = (btn.textContent || '').trim();
    if (pressed !== 'true') return { ok: true, alreadyOff: true, label: btnLabel };
    dispatchRealClick(btn);
    // 토글 반영 대기 (최대 1.5s)
    var dl = Date.now() + 1500;
    while (Date.now() < dl) {
      await sleep(80);
      if (btn.getAttribute('aria-pressed') !== 'true') return { ok: true, toggled: true, label: btnLabel };
    }
    return { ok: false, reason: 'toggle-failed', label: btnLabel };
  }

  // Flow send 버튼 후보 찾기
  //   1순위: arrow_forward 아이콘 + sr-only "만들기" 텍스트 (정확 매칭)
  //   2순위: arrow_forward 아이콘 단독 (DOM 후순위 우선 — 진짜 send 는 보통 하단)
  //   3순위: aria-label / 텍스트 키워드
  // disabled / 비가시 후보는 모두 스킵.
  function findGenerateBtn() {
    var btns = document.querySelectorAll('button');
    var arrowMatches = [];
    var labelMatches = [];
    var keys = ['send', 'submit', 'generate', '만들기', '전송', '보내기'];

    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.disabled) continue;
      if (b.getAttribute('aria-disabled') === 'true') continue;
      if (!isVisible(b)) continue;

      var icon = b.querySelector('i');
      var iconText = icon ? (icon.textContent || '').trim() : '';
      var btnText = (b.textContent || '').trim();
      var label = ((b.getAttribute('aria-label') || '') + ' ' + btnText).toLowerCase();

      // 1순위: arrow_forward + 만들기 (sr-only span 포함)
      if (iconText === 'arrow_forward' && btnText.indexOf('만들기') !== -1) {
        return b;
      }
      if (iconText === 'arrow_forward') {
        arrowMatches.push(b);
        continue;
      }
      for (var k = 0; k < keys.length; k++) {
        if (label.indexOf(keys[k]) !== -1) { labelMatches.push(b); break; }
      }
    }

    // 2순위: arrow_forward 단독 — 진짜 send 는 보통 DOM 하단이라 마지막 후보 우선
    if (arrowMatches.length > 0) return arrowMatches[arrowMatches.length - 1];
    if (labelMatches.length > 0) return labelMatches[labelMatches.length - 1];
    return null;
  }

  // Flow 의 send 버튼은 onClick 핸들러에서 event.isTrusted 를 검사해서
  // 합성 이벤트(el.click() / dispatchEvent)는 무시한다.
  //   → 우회: React 가 element 에 attach 한 props.onClick 을 직접 호출.
  //   → React 의 SyntheticEvent 흉내 객체를 넘기면 onClick 안에서 isTrusted
  //     검사 시 우리가 넣은 true 가 보임 (실제 native event 객체가 아니므로).
  // React props 가 없거나 onClick 이 없는 경우엔 풀 pointer/mouse 시퀀스로 폴백.
  // (자산 picker 의 자산 div / "프롬프트에 추가" 버튼 같은 케이스는 React onClick 이
  //  부모에 있어 직접 못 잡고, native click 만으론 안 먹어서 풀 시퀀스 필요)
  function dispatchRealClick(el) {
    if (!el) return;
    var rk = null;
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf('__reactProps') === 0) { rk = keys[i]; break; }
    }
    if (rk) {
      var props = el[rk];
      if (props && typeof props.onClick === 'function') {
        var fakeEvent = {
          type: 'click',
          target: el,
          currentTarget: el,
          bubbles: true,
          cancelable: true,
          isTrusted: true,
          defaultPrevented: false,
          preventDefault: function () { this.defaultPrevented = true; },
          stopPropagation: function () {},
          stopImmediatePropagation: function () {},
          nativeEvent: { isTrusted: true, type: 'click' },
          button: 0,
          buttons: 0
        };
        try {
          props.onClick(fakeEvent);
          return;
        } catch (_) {
          // React 핸들러 실패 시 풀 시퀀스 폴백
        }
      }
    }
    // 풀 pointer + mouse 시퀀스
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    var common = {
      bubbles: true, cancelable: true, composed: true, view: window,
      button: 0, buttons: 1, clientX: cx, clientY: cy
    };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'mouse' }, common))); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', common)); } catch (_) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerType: 'mouse', buttons: 0 }, common))); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, common, { buttons: 0 }))); } catch (_) {}
    try { el.click(); } catch (_) {}
  }

  async function clickGenerate() {
    // 활성 send 버튼 대기 — 새 Flow UI 는 한 generation 당 30~60s 걸리고
    // 그 동안 send 가 stop 으로 바뀌므로 사이클 사이에 복귀까지 충분히 기다린다.
    // 자산 첨부 직후 잠깐 disabled 되는 케이스도 같은 폴링으로 흡수.
    var btn = null;
    var deadline = Date.now() + 90000; // 90s
    var lastLog = 0;
    while (Date.now() < deadline) {
      if (!state.running) throw new Error('중지됨');
      btn = findGenerateBtn();
      if (btn) break;
      // 10초마다 진행 로그
      if (Date.now() - lastLog > 10000) {
        log('Generate 버튼 대기 중 (이전 생성 처리 중 가능)...', 'info');
        lastLog = Date.now();
      }
      await sleep(300);
    }
    if (!btn) throw new Error('Generate 버튼을 찾을 수 없습니다 (90s 대기 후)');

    // v1.6.7: 첫 클릭 후 검증 + 필요 시 재클릭.
    //   새 Flow UI 는 직전 generation 종료 후 짧은 cool-down 동안 send 클릭을
    //   조용히 무시함. waitSendReady 통과 → 즉시 첫 click → 무시되는 케이스가
    //   2번째 사이클부터 자주 발생.
    //   감지: 5초 안에 stop 아이콘 등장 OR 메인 그리드 tile 증가.
    //   변화 없으면 한 번 더 클릭 (이중 send 방지를 위해 변화 확인 후 종료).
    var beforeTiles = getCurrentTileIds().size;
    dispatchRealClick(btn);

    var verifyDeadline = Date.now() + 5000;
    var accepted = false;
    while (Date.now() < verifyDeadline) {
      await sleep(250);
      // stop 아이콘 등장 = generation 시작됨
      var stopBtn = null;
      var btns = document.querySelectorAll('button');
      for (var k = 0; k < btns.length; k++) {
        var ic = btns[k].querySelector('i');
        if (ic && (ic.textContent || '').trim() === 'stop' && isVisible(btns[k])) {
          stopBtn = btns[k];
          break;
        }
      }
      if (stopBtn) { accepted = true; break; }
      // 새 타일 등장 — 1장짜리 generation 빠른 경우
      if (getCurrentTileIds().size > beforeTiles) { accepted = true; break; }
    }

    if (!accepted) {
      // 첫 클릭이 cool-down 으로 무시된 것으로 판단 → 재클릭
      log('Generate 클릭 미수용 (5s 무반응) → 재클릭', 'info');
      var btn2 = findGenerateBtn();
      if (btn2) dispatchRealClick(btn2);
    }
    return true;
  }

  function getCurrentTileIds() {
    var ids = new Set();
    document.querySelectorAll('div[data-tile-id]').forEach(function (d) {
      ids.add(d.dataset.tileId);
    });
    return ids;
  }

  function getTileInfo(tileId) {
    var divs = document.querySelectorAll('div[data-tile-id="' + tileId + '"]');
    // 자식이 <=1 인 leaf 타일을 우선 (Flow 가 타일을 여러겹 래핑할 수 있음)
    for (var i = 0; i < divs.length; i++) {
      var d = divs[i];
      if (d.children.length <= 1) {
        var img = d.querySelector('img');
        var m = (d.textContent || '').match(/(\d{1,3})%/);
        var hasImg = !!(img && img.src && img.src.indexOf('labs.google') !== -1);
        return {
          found: true,
          hasImg: hasImg,
          imgSrc: hasImg ? img.src : null,
          pct: m ? parseInt(m[1], 10) : -1
        };
      }
    }
    // 폴백: 첫 번째
    if (divs.length > 0) {
      var d0 = divs[0];
      var img0 = d0.querySelector('img');
      var m0 = (d0.textContent || '').match(/(\d{1,3})%/);
      var hasImg0 = !!(img0 && img0.src && img0.src.indexOf('labs.google') !== -1);
      return {
        found: true,
        hasImg: hasImg0,
        imgSrc: hasImg0 ? img0.src : null,
        pct: m0 ? parseInt(m0[1], 10) : -1
      };
    }
    return { found: false };
  }

  function findNewTileIds() {
    var current = getCurrentTileIds();
    var assigned = new Set();
    activeGens.forEach(function (g) {
      g.tileIds.forEach(function (t) { assigned.add(t); });
    });
    var out = [];
    current.forEach(function (id) {
      if (!knownTileIds.has(id) && !assigned.has(id)) out.push(id);
    });
    return out;
  }

  /* ════════════════════════════════════════════
   * 프롬프트 입력 — NB2 (nano-banana-auto) 와 동일한 방식
   *
   * 1) clearEditor()    : Ctrl+A + Backspace 로 에디터 초기화
   * 2) typeSlateChars() : 한 글자씩 keydown + beforeinput + input + keyup 디스패치
   *                       각 글자 사이 10~25ms 랜덤 jitter (사람 타이핑 모방)
   *
   * [tag] (예: [캐릭터]) 가 있는 레거시 프롬프트는 drop-handler 의
   * __toolbTypePromptTBM 를 쓴다 (인라인 @멘션 경로).
   * @[이름] 이 있는 NB2 포맷은 여기서 자산 첨부 후 원문 그대로 타이핑.
   * ════════════════════════════════════════════ */

  // Ctrl+A 후 Backspace 로 에디터 전체 삭제. 사이드패널의 자산 칩은 영향 받지 않음
  // (Flow 는 자산 칩을 에디터 밖에 렌더링).
  async function clearEditor() {
    var el = findEditor();
    if (!el) return false;
    el.focus();
    try { el.click(); } catch (_) {}
    await randSleep(200, 400);

    // Ctrl+A
    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'a', code: 'KeyA', keyCode: 65, which: 65,
      ctrlKey: true, bubbles: true, cancelable: true
    }));
    await sleep(150);
    el.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'a', code: 'KeyA', keyCode: 65, which: 65,
      ctrlKey: true, bubbles: true
    }));
    await randSleep(100, 250);

    // Backspace
    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8,
      bubbles: true, cancelable: true
    }));
    await sleep(150);
    el.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8,
      bubbles: true
    }));
    await randSleep(200, 400);

    // 폴백: 아직 내용이 남아있으면 selectAllChildren + delete execCommand
    var remaining = (el.textContent || '').trim();
    if (remaining.length > 0) {
      try {
        el.focus();
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.selectAllChildren(el);
        await sleep(40);
        document.execCommand('delete', false, null);
        await sleep(100);
      } catch (_) {}
    }
    return true;
  }

  // NB2 insertTextSlate 이식 — 한 글자씩 타이핑
  //
  // v1.4.19: 타이핑 속도 분기(t2i fast / i2i slow) 시도했다가 되돌림.
  //   사용자 방향: "둘 다 텍스트투이미지처럼 빠르게" — 즉 모드 관계없이
  //   기존 검증된 10~25ms/char 유지. i2i 실패의 원인은 타이핑 속도가 아니라
  //   서버 측 누적 abuse score / 모드별 필터일 가능성이 더 크다.
  //   `slow` 파라미터는 남겨두지만 호출부에서 현재 쓰지 않음 (미래 확장 대비).
  async function typeSlateChars(el, text, slow) {
    el.focus();
    try { el.click(); } catch (_) {}
    await randSleep(150, 300);

    for (var i = 0; i < text.length; i++) {
      if (!state.running) return false;
      var ch = text.charAt(i);
      var keyCode = ch.charCodeAt(0);
      // ASCII 영문일 때만 code 를 제대로 설정 (한글/기호는 빈 code 여도 Slate 가 beforeinput 데이터로 처리)
      var code = /^[a-zA-Z]$/.test(ch) ? ('Key' + ch.toUpperCase())
               : /^[0-9]$/.test(ch)    ? ('Digit' + ch)
               : '';

      el.dispatchEvent(new KeyboardEvent('keydown', {
        key: ch, code: code, keyCode: keyCode, which: keyCode,
        bubbles: true, cancelable: true
      }));
      el.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertText', data: ch,
        bubbles: true, cancelable: true, composed: true
      }));
      el.dispatchEvent(new InputEvent('input', {
        inputType: 'insertText', data: ch,
        bubbles: true, composed: true
      }));
      el.dispatchEvent(new KeyboardEvent('keyup', {
        key: ch, code: code, keyCode: keyCode, which: keyCode,
        bubbles: true
      }));
      // 사람 타이핑 jitter (NB2 검증값)
      await sleep(10 + Math.random() * 15);
    }

    await randSleep(200, 500);
    return true;
  }

  async function setPromptText(text, slow) {
    var el = findEditor();
    if (!el) throw new Error('프롬프트 입력 요소를 찾을 수 없습니다');

    // <input>/<textarea> — native 값 setter (동영상 모드 등 일부 경로)
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      var proto = el.tagName === 'INPUT'
        ? window.HTMLInputElement.prototype
        : window.HTMLTextAreaElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    // contenteditable (Slate) — NB2 식 char-by-char
    await typeSlateChars(el, text, slow);

    // 검증: 앞 20자가 실제로 들어갔는지 확인, 실패 시 벌크 폴백
    var probe = text.substring(0, Math.min(20, text.length));
    var current = nfc(el.textContent || '');
    if (current.indexOf(probe) === -1) {
      console.warn('[FlowBulk] char-by-char 미반영 → beforeinput 벌크 폴백');
      try {
        el.focus();
        var sel2 = window.getSelection();
        sel2.removeAllRanges();
        sel2.selectAllChildren(el);
        await sleep(40);
      } catch (_) {}
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, composed: true,
        inputType: 'insertText', data: text
      }));
      await sleep(120);
      // 그래도 안 되면 execCommand
      var current2 = nfc(el.textContent || '');
      if (current2.indexOf(probe) === -1) {
        el.focus();
        try { document.execCommand('selectAll', false, null); } catch (_) {}
        await sleep(30);
        try { document.execCommand('insertText', false, text); } catch (_) {}
        await sleep(100);
      }
    }
    return true;
  }

  /* ════════════════════════════════════════════
   * 캐릭터(에셋) 첨부 — '+' 버튼 → 자산 다이얼로그
   * drop-handler 에 window.__toolbAttachChar 가 정의돼 있으면 위임.
   * ════════════════════════════════════════════ */
  async function attachCharacterViaPlus(name) {
    // 1) + 버튼 탐색
    var addBtn = null;
    var dialogButtons = document.querySelectorAll('button[aria-haspopup="dialog"]');
    for (var i = 0; i < dialogButtons.length; i++) {
      var b = dialogButtons[i];
      if (!isVisible(b)) continue;
      var ic = b.querySelector('i');
      var txt = ic ? (ic.textContent || '').trim() : '';
      if (txt === 'add_2' || txt === 'add' || txt.indexOf('add') !== -1) { addBtn = b; break; }
    }
    if (!addBtn) {
      var all = document.querySelectorAll('button');
      for (var j = 0; j < all.length; j++) {
        if (!isVisible(all[j])) continue;
        var ic2 = all[j].querySelector('i');
        if (ic2 && (ic2.textContent || '').trim() === 'add_2') { addBtn = all[j]; break; }
      }
    }
    if (!addBtn) throw new Error('"+" 버튼을 찾을 수 없습니다');

    addBtn.click();
    await sleep(700);

    // 2) 다이얼로그 + 검색 입력
    var dlg = document.querySelector('[role="dialog"]');
    if (!dlg) throw new Error('애셋 다이얼로그가 열리지 않았습니다');

    var searchInput =
      dlg.querySelector('input[placeholder*="애셋"]') ||
      dlg.querySelector('input[placeholder*="검색"]') ||
      dlg.querySelector('input[type="text"]') ||
      dlg.querySelector('input');
    if (!searchInput) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      throw new Error('애셋 검색 입력을 찾을 수 없습니다');
    }

    searchInput.focus();
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(searchInput, name);
    else searchInput.value = name;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(1200);

    // 3) 결과 선택 (정확 매칭 우선, 부분 매칭, 첫 결과 순)
    //
    // v1.6.5: 새 picker UI 는 cursor:pointer 가 아닐 수 있어 그 필터 제거.
    //          썸네일 img 가 있고 너비 100~500 사이 div 를 후보로 본다.
    var candidates = [];
    dlg.querySelectorAll('div').forEach(function (d) {
      if (!d.querySelector('img')) return;
      var r = d.getBoundingClientRect();
      if (r.width < 100 || r.height < 30 || r.width > 500) return;
      // 자식이 너무 많으면 그룹 컨테이너 — 스킵
      if (d.children.length > 6) return;
      var nm = '';
      var leaves = d.querySelectorAll('div, span');
      for (var k = 0; k < leaves.length; k++) {
        var le = leaves[k];
        if (le.children.length === 0) {
          var t = (le.textContent || '').trim();
          if (t) { nm = t; break; }
        }
      }
      if (!nm) nm = (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      try { nm = nm.normalize('NFC'); } catch (_) {}
      candidates.push({ el: d, name: nm });
    });

    var needle = name;
    try { needle = name.normalize('NFC'); } catch (_) {}

    var chosen = null;
    for (var a = 0; a < candidates.length; a++) {
      if (candidates[a].name === needle) { chosen = candidates[a]; break; }
    }
    if (!chosen) {
      for (var c = 0; c < candidates.length; c++) {
        if (candidates[c].name.indexOf(needle) !== -1 ||
            needle.indexOf(candidates[c].name) !== -1) { chosen = candidates[c]; break; }
      }
    }
    if (!chosen && candidates.length > 0 && candidates.length <= 3) {
      chosen = candidates[0]; // 관대 매칭
    }

    if (!chosen) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(300);
      throw new Error('검색 결과 없음: ' + name);
    }

    // v1.6.5: 새 picker 는 자산 클릭만으론 부착 안 되고 "프롬프트에 추가" 버튼이 필요.
    //          dispatchRealClick (풀 pointer/mouse 시퀀스) 로 isTrusted 가드 우회.
    dispatchRealClick(chosen.el);
    await sleep(500);

    // 다이얼로그 내에 "프롬프트에 추가" 버튼이 있으면 클릭 (새 UI 경로)
    var addToPromptBtn = null;
    var stillDlg = document.querySelector('[role="dialog"]');
    if (stillDlg) {
      var btns = stillDlg.querySelectorAll('button');
      for (var bi = 0; bi < btns.length; bi++) {
        var btxt = (btns[bi].textContent || '').trim();
        if (!isVisible(btns[bi])) continue;
        if (btxt === '프롬프트에 추가' || btxt === 'Add to prompt' ||
            btxt.indexOf('프롬프트에 추가') !== -1) {
          addToPromptBtn = btns[bi];
          break;
        }
      }
    }
    if (addToPromptBtn) {
      dispatchRealClick(addToPromptBtn);
      // 다이얼로그 닫힘 대기
      var addDeadline = Date.now() + 2000;
      while (Date.now() < addDeadline) {
        await sleep(100);
        if (!document.querySelector('[role="dialog"]')) break;
      }
    } else {
      // 구 UI — 썸네일 클릭만으로 부착됐을 수 있음. 그래도 다이얼로그 열려있으면 Esc.
      await sleep(300);
      if (document.querySelector('[role="dialog"]')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(300);
      }
    }
    return true;
  }

  async function attachCharacter(name) {
    if (typeof window.__toolbAttachChar === 'function') {
      return await window.__toolbAttachChar(name);
    }
    return await attachCharacterViaPlus(name);
  }

  /* ════════════════════════════════════════════
   * 다운로드 (jitter + 중복 방지)
   * ════════════════════════════════════════════ */
  async function downloadImage(imgSrc, parsedPrompt, batchIdx, fallbackIdx, batchTotal) {
    if (!imgSrc) return;
    if (downloadedSrcs.has(imgSrc)) return;
    downloadedSrcs.add(imgSrc);
    if (!autoDownload) return;

    // URL 에서 확장자 추정 (.png → .jpeg 보정 경고 방지)
    var ext = extFromUrl(imgSrc);
    var filename = buildFilename(parsedPrompt, batchIdx, fallbackIdx, batchTotal, ext);
    log('💾 다운로드 요청: ' + filename, 'info');
    sendEvent({ type: 'DOWNLOAD_IMAGE', url: imgSrc, filename: filename });

    // NB2 스타일 jitter — Chrome 이 연속 다운로드를 드롭하는 문제 방지
    await randSleep(300, 600);
  }

  /* ════════════════════════════════════════════
   * 생성 객체(슬롯)
   * ════════════════════════════════════════════ */
  function createGen(prompt, index, batchCount) {
    return {
      prompt: prompt,
      index: index,
      batchCount: batchCount,
      tileIds: [],
      tileStates: {}, // tileId → { hadPct, settled, success, imgSrc }
      requestTime: Date.now(),
      resolved: false,
      firstSettledAt: 0, // v1.4.18: 첫 타일 settled 시각 — grace period 기준
      graceLogged: false, // grace 조기 완료 로그 1회만
      _lastLog: 0
    };
  }

  /* ════════════════════════════════════════════
   * 완료 감시 워커 (NB2 이식)
   * ════════════════════════════════════════════ */
  async function startWatcher(genTimeoutSec) {
    if (watcherRunning) return;
    watcherRunning = true;
    log('이미지 감시 워커 시작', 'info');

    while (watcherRunning) {
      if (!state.running) break;

      for (var i = activeGens.length - 1; i >= 0; i--) {
        var gen = activeGens[i];
        if (gen.resolved) continue;

        // (1) 새 tile 을 슬롯에 할당
        if (gen.tileIds.length < gen.batchCount) {
          var news = findNewTileIds();
          for (var n = 0; n < news.length; n++) {
            if (gen.tileIds.length >= gen.batchCount) break;
            gen.tileIds.push(news[n]);
            gen.tileStates[news[n]] = {
              hadPct: false,
              settled: false,
              success: false,
              imgSrc: null,
              firstCompleteAt: 0  // "hasImg & no pct" 가 처음 관찰된 시각 (안정화 시작점)
            };
          }
        }

        var elapsedSec = (Date.now() - gen.requestTime) / 1000;

        // (2) 타일이 아직 안 잡혔는데 타임아웃이면 실패
        if (gen.tileIds.length === 0) {
          if (elapsedSec > genTimeoutSec) {
            log('#' + (gen.index + 1) + ' 타일 미감지 타임아웃 → 실패', 'error');
            gen.resolved = true;
            state.failedIndexes.push(gen.index);
            activeGens.splice(i, 1);
          }
          continue;
        }

        // (3) 각 타일 상태 폴링
        var allSettled = true;
        for (var t = 0; t < gen.tileIds.length; t++) {
          var tid = gen.tileIds[t];
          var ts = gen.tileStates[tid];
          if (ts.settled) continue;

          var info = getTileInfo(tid);
          if (!info.found) { allSettled = false; continue; }

          if (info.pct >= 0) {
            ts.hadPct = true;
            // 퍼센트가 다시 등장했다 = 재생성/재시작 → 안정화 카운트 리셋
            if (ts.firstCompleteAt) {
              ts.firstCompleteAt = 0;
              ts.imgSrc = null;
            }
          }

          if (info.hasImg && info.pct < 0) {
            // 처음 감지 → 타임스탬프만 기록하고 안정화 대기
            if (!ts.firstCompleteAt) {
              ts.firstCompleteAt = Date.now();
              ts.imgSrc = info.imgSrc;
              allSettled = false;
              continue;
            }
            // 대기 중 — src 가 바뀔 수 있으니 최신 값으로 갱신
            ts.imgSrc = info.imgSrc;
            var waited = Date.now() - ts.firstCompleteAt;
            if (waited < DOWNLOAD_STABILIZATION_MS) {
              allSettled = false;
              continue;
            }
            // 안정화 완료 — 최종 src 확정
            ts.settled = true;
            ts.success = true;
            continue;
          }
          if (ts.hadPct && info.pct < 0 && !info.hasImg) {
            ts.settled = true;
            ts.success = false;
            continue;
          }
          allSettled = false;
        }

        // v1.4.18: batchCount 미달 시 동작 변경 —
        //   기존: 무조건 allSettled=false → 180초 하드 타임아웃까지 대기
        //   신규: 이미 settled 된 타일이 있으면 grace period (기본 15초) 후 조기 완료.
        //         Flow 가 추가 타일을 안 주는 상황에서 불필요한 대기 제거.
        //         Flow 가 batchCount 만큼 주는 정상 상황에선 영향 없음 (즉시 allSettled).
        if (gen.tileIds.length < gen.batchCount) {
          // 현재 모인 타일 중 하나라도 settled 됐는지 확인
          var anySettled = false;
          for (var sT = 0; sT < gen.tileIds.length; sT++) {
            if (gen.tileStates[gen.tileIds[sT]].settled) { anySettled = true; break; }
          }
          if (anySettled && !gen.firstSettledAt) {
            gen.firstSettledAt = Date.now();
          }
          if (!gen.firstSettledAt) {
            // 아직 어떤 타일도 settled 안 됨 → 정상 대기
            allSettled = false;
          } else if (Date.now() - gen.firstSettledAt < TILE_GRACE_MS) {
            // grace 기간 내 → 추가 타일 기대하며 대기
            allSettled = false;
          } else {
            // grace 초과 — allSettled 는 기존 루프 결과 유지.
            //   모인 타일이 모두 settled 면 true 로 남아 조기 완료 트리거.
            if (!gen.graceLogged) {
              log('#' + (gen.index + 1) +
                  ' 타일 ' + gen.tileIds.length + '/' + gen.batchCount +
                  ' 수신 · ' + Math.round(TILE_GRACE_MS / 1000) + '초 내 추가 없음 → 조기 완료',
                  'info');
              gen.graceLogged = true;
            }
          }
        }

        var timedOut = elapsedSec > genTimeoutSec;

        // (4) 완료 또는 타임아웃 → 저장 + 슬롯 해제
        if (allSettled || timedOut) {
          var salvaged = [];
          for (var k = 0; k < gen.tileIds.length; k++) {
            var tid2 = gen.tileIds[k];
            var ts2 = gen.tileStates[tid2];
            if (ts2.success && ts2.imgSrc) {
              salvaged.push(ts2.imgSrc);
            } else if (timedOut && !ts2.settled) {
              // 부분 저장: 타임아웃 시점에 이미지가 있으면 살림
              var cur = getTileInfo(tid2);
              if (cur.hasImg && cur.imgSrc) salvaged.push(cur.imgSrc);
            }
            knownTileIds.add(tid2);
          }

          if (salvaged.length > 0) {
            var parsedForDl = state.prompts[gen.index] || null;
            // v1.4.21: 파일명 suffix 는 "실제 저장될 장수"(salvaged.length) 기준.
            //   기존: gen.batchCount(설정값) 사용 → x2 설정인데 1장만 와도 "_1" 붙음
            //   변경: 실제 1장이면 suffix 없음, 2장 이상이면 "_1, _2, ..." 부여.
            var actualTotal = salvaged.length;
            for (var s = 0; s < salvaged.length; s++) {
              await downloadImage(salvaged[s], parsedForDl, s, gen.index, actualTotal);
            }
            var full = (salvaged.length === gen.batchCount);
            log(
              '#' + (gen.index + 1) + (full ? ' 완료' : ' 부분 완료') +
              ' (' + salvaged.length + '/' + gen.batchCount + '장' +
              (timedOut ? ', 타임아웃' : '') + ')',
              full ? 'success' : 'info'
            );
            state.successCount++;
          } else {
            log('#' + (gen.index + 1) + ' 실패', 'error');
            state.failedIndexes.push(gen.index);
          }

          gen.resolved = true;
          activeGens.splice(i, 1);
          continue;
        }

        // (5) 주기적 진행률 로그 (5초 간격)
        if (!gen._lastLog || Date.now() - gen._lastLog > 5000) {
          var minPct = 999;
          for (var q = 0; q < gen.tileIds.length; q++) {
            var inf = getTileInfo(gen.tileIds[q]);
            if (inf.pct >= 0 && inf.pct < minPct) minPct = inf.pct;
          }
          if (minPct < 999) {
            log('#' + (gen.index + 1) + ' ' + minPct + '% (타일 ' + gen.tileIds.length + '/' + gen.batchCount + ')', 'info');
          }
          gen._lastLog = Date.now();
        }
      }

      await sleep(1000);
    }

    watcherRunning = false;
  }

  async function waitForGenProgress(gen, targetPct, timeoutSec) {
    var start = Date.now();
    while (Date.now() - start < timeoutSec * 1000) {
      if (!state.running) return 'stopped';
      if (gen.resolved) return 'finished';
      var minPct = -1;
      for (var i = 0; i < gen.tileIds.length; i++) {
        var info = getTileInfo(gen.tileIds[i]);
        if (!info.found) continue;
        if (info.hasImg && info.pct < 0) continue;
        if (info.pct >= 0 && (minPct < 0 || info.pct < minPct)) minPct = info.pct;
      }
      if (minPct >= targetPct) return 'reached';
      await sleep(500);
    }
    return 'timeout';
  }

  /* ════════════════════════════════════════════
   * 메인 루프
   * ════════════════════════════════════════════ */
  async function runBatch(settings) {
    state.sessionId++;
    var sid = state.sessionId;

    state.running = true;
    state.paused = false;
    state.settings = settings;
    // NB2 포맷(id|memo|prompt) 파싱 + @[이름] 참조 추출. 항목은 객체 배열.
    state.prompts = expandPrompts(Array.isArray(settings.prompts) ? settings.prompts : []);
    state.currentIndex = 0;
    state.successCount = 0;
    state.failedIndexes = [];
    activeGens = [];
    downloadedSrcs = new Set();
    usedFilenames = new Set();

    folderName = makeFolderName(settings.folderOverride);
    filenamePrefix = sanitizeFilename(settings.filenamePrefix || 'tb_scene');
    if (filenamePrefix === 'file') filenamePrefix = 'tb_scene';
    autoDownload = settings.autoDownload !== false;
    nameMode = (settings.nameMode === 'id' || settings.nameMode === 'memo' ||
                settings.nameMode === 'prefix') ? settings.nameMode : 'auto';
    assetMode = (settings.assetMode === 'mention') ? 'mention' : 'plus';
    log('📁 저장 폴더: ' + folderName +
        ' · 파일명 규칙: ' + nameMode +
        ' · 에셋 삽입: ' + (assetMode === 'mention' ? '@ 인라인' : '+ 버튼'), 'info');

    var genTimeout = Math.max(30, parseInt(settings.genTimeout, 10) || 180);

    var batchCount = 1;
    if (settings.count) {
      var m = String(settings.count).match(/\d+/);
      if (m) batchCount = Math.max(1, parseInt(m[0], 10));
    }

    var concurrent = Math.max(1, Math.min(MAX_SLOTS, parseInt(settings.concurrent, 10) || 1));

    // v1.4.20: 30%/80% 파이프라인을 텍스트투이미지 + 이미지투이미지 모두에서 강제로 켠다.
    //   기존엔 t2i 만 자동 승격 (i2i 자산 첨부 UI 충돌 우려). 실사용 검증에서
    //   i2i 도 안정적으로 동작 확인되어 동일하게 처리.
    //   → 다음 프롬프트가 현재 생성의 30% 시점에 타이핑 시작, 80% 시점에 Generate 클릭.
    //   → 타이핑 15초가 현재 생성 시간 뒤에 숨겨져 체감 속도 크게 상승.
    var isTextToImage = settings.imageMode === 'none';
    var isImageToImage = settings.imageMode === 'search';
    if ((isTextToImage || isImageToImage) && concurrent < 2) {
      concurrent = Math.min(MAX_SLOTS, 2);
    }

    var delayMin = Math.max(0, parseInt(settings.delayMin, 10) || 5);
    var delayMax = Math.max(delayMin, parseInt(settings.delayMax, 10) || 10);

    knownTileIds = getCurrentTileIds();

    // v1.6.6+: 배치 시작 전에 에이전트 모드 강제 OFF (새 Flow UI 대응).
    //   콘텐츠 있는 프로젝트의 우측 사이드 패널도 함께 닫음.
    try {
      var closedPanel = await closeAgentSidePanel();
      if (closedPanel) log('에이전트 사이드패널 닫음', 'info');
      var agentRes = await ensureAgentModeOff();
      if (agentRes.toggled) log('에이전트 모드 OFF 토글 (' + (agentRes.label || '') + ')', 'info');
      else if (agentRes.alreadyOff) log('에이전트 모드 이미 OFF (' + (agentRes.label || '') + ')', 'info');
      else if (agentRes.reason === 'no-toggle') log('에이전트 토글 버튼 미발견 — 구 UI 로 추정 (계속 진행)', 'info');
      else log('에이전트 모드 토글 실패 (' + (agentRes.reason || '') + ') (계속 진행)', 'info');
    } catch (e) {
      log('에이전트 모드 처리 중 오류 (계속 진행): ' + (e && e.message || e), 'info');
    }

    log('배치 시작: ' + state.prompts.length + '개 / 배치 x' + batchCount +
        ' / 동시 ' + concurrent +
        (isTextToImage ? ' (텍스트투이미지 파이프라인)' :
         isImageToImage ? ' (이미지투이미지 파이프라인)' : ''), 'info');
    log('📁 저장 폴더: ' + folderName + '  /  접두사: ' + filenamePrefix +
        '  /  안정화 대기: ' + DOWNLOAD_STABILIZATION_MS + 'ms', 'info');
    if (!autoDownload) log('자동 다운로드 OFF — 이미지는 저장되지 않습니다', 'info');

    // 감시 워커 시작 (비동기)
    startWatcher(genTimeout);

    var prompts = state.prompts;
    for (var pi = 0; pi < prompts.length; pi++) {
      if (!state.running || state.sessionId !== sid) break;
      while (state.paused) {
        if (!state.running || state.sessionId !== sid) break;
        await sleep(500);
      }
      if (!state.running || state.sessionId !== sid) break;

      state.currentIndex = pi;
      var parsed = prompts[pi];        // {id, memo, text, assetNames, isNB2}
      var promptText = parsed.text;
      var label = (parsed.id ? parsed.id : '#' + (pi + 1));

      sendEvent({
        type: 'PROGRESS_UPDATE',
        current: pi + 1,
        total: prompts.length,
        currentPrompt: (parsed.memo ? (parsed.memo + ' | ') : '') + promptText
      });

      // (1) 슬롯이 꽉 찼으면 빠질 때까지 대기
      if (activeGens.length >= concurrent) {
        var slotDeadline = Date.now() + (genTimeout + 10) * 1000;
        while (activeGens.length >= concurrent && state.running) {
          if (Date.now() > slotDeadline) {
            log('슬롯 대기 타임아웃 — 가장 오래된 슬롯 강제 해제', 'error');
            var oldest = activeGens.shift();
            if (oldest && !oldest.resolved) {
              oldest.resolved = true;
              state.failedIndexes.push(oldest.index);
              oldest.tileIds.forEach(function (t) { knownTileIds.add(t); });
            }
            break;
          }
          await sleep(500);
        }
      }

      // (2) 파이프라인 체크포인트 1 — 30% 에서 다음 프롬프트 준비 시작
      if (concurrent > 1 && activeGens.length > 0) {
        var lastA = activeGens[activeGens.length - 1];
        if (!lastA.resolved) {
          await waitForGenProgress(lastA, 30, genTimeout);
        }
      }
      if (!state.running || state.sessionId !== sid) break;

      try {
        // (3) NB2 식 — 에디터를 먼저 Ctrl+A + Backspace 로 비운다.
        //     (이전 프롬프트 텍스트가 남아있으면 새 입력과 섞이기 때문)
        //     자산 칩은 에디터 밖에 렌더링되므로 삭제되지 않음.
        await clearEditor();
        await randSleep(200, 400);

        // (4) 첨부할 자산 목록 결정.
        //     (a) scene matrix / 레거시 charSearchQueries — 항상 + 버튼으로 첨부
        //         (이미지투이미지 업로드된 파일이라 반드시 에디터 밖 자산 영역에 필요)
        //     (b) 프롬프트의 @[이름] 토큰 — assetMode 에 따라 분기:
        //         - 'plus'   : + 버튼으로 첨부 후 본문은 @[...] 제거한 clean text 로 타이핑
        //         - 'mention': + 버튼 사용 안 함. 본문을 토큰 단위로 쪼개서
        //                      @ 인라인 피커로 삽입 (__toolbTypePromptTBM 재활용).
        var nbRefs = (parsed.assetNames || []).slice();
        var hasNBRef = nbRefs.length > 0;

        var plusAssets = [];
        var cpq = settings.charPromptQueues;
        var hasPerPrompt = cpq && cpq[pi] != null;
        var charQueries = hasPerPrompt ? cpq[pi] : (settings.charSearchQueries || []);
        if (settings.imageMode === 'search' && charQueries && charQueries.length > 0) {
          charQueries.forEach(function (q) {
            var qn = nfc(q);
            if (qn && plusAssets.indexOf(qn) === -1) plusAssets.push(qn);
          });
        }
        // assetMode 가 'plus' 일 때만 NB2 참조를 + 버튼 큐에 합친다.
        if (assetMode === 'plus') {
          nbRefs.forEach(function (n) {
            if (n && plusAssets.indexOf(n) === -1) plusAssets.push(n);
          });
        }

        if (plusAssets.length > 0) {
          log(label + ' 자산 첨부(+버튼): ' + plusAssets.join(', '), 'info');
          for (var ci = 0; ci < plusAssets.length; ci++) {
            if (!state.running) break;
            try {
              await attachCharacter(plusAssets[ci]);
              await sleep(600);
            } catch (aErr) {
              log(label + ' "' + plusAssets[ci] + '" 첨부 실패 (계속 진행): ' + (aErr.message || ''), 'error');
            }
          }
        }

        // (5) 프롬프트 입력 경로 선택:
        //     - hasNBRef + assetMode='plus'    : 본문에서 @[...] 토큰 제거 후 평문 타이핑
        //                                        (NB2 Mode B 와 같되, 찌꺼기 문자열까지 정리)
        //     - hasNBRef + assetMode='mention' : @[이름] → [__ToolBTag::이름] 변환 후
        //                                        __toolbTypePromptTBM 로 인라인 @ 피커 경로 (NB2 Mode A)
        //     - [태그] (@ 없음)                 : __toolbTypePromptTBM 로 레거시 인라인 멘션
        //     - 아무 태그도 없음                : 평문 타이핑
        var textWithoutAt = promptText.replace(/@\[[^\]]+\]/g, '');
        var hasLegacyTag = /\[[^\]]+\]/.test(textWithoutAt);

        if (hasNBRef && assetMode === 'mention' &&
            typeof window.__toolbTypePromptTBM === 'function') {
          // NB2 Mode A 경로. @[검사] → [__ToolBTag::검사] 로 바꿔서
          // drop-handler 의 기존 @ 피커 파이프라인을 재활용.
          var mentionScript = promptText.replace(
            /@\[([^\]]+)\]/g, '[__ToolBTag::$1]'
          );
          log(label + ' @ 인라인 모드로 입력', 'info');
          try {
            await window.__toolbTypePromptTBM(mentionScript);
          } catch (mErr) {
            // 인라인 실패 시 Mode B 로 폴백: + 버튼으로 에셋 첨부하고
            // 본문은 @[...] 제거한 텍스트로 타이핑.
            log(label + ' @ 인라인 실패 → + 버튼 폴백: ' + (mErr.message || ''), 'error');
            for (var fi = 0; fi < nbRefs.length; fi++) {
              if (!state.running) break;
              try { await attachCharacter(nbRefs[fi]); await sleep(400); }
              catch (_) {}
            }
            await setPromptText(stripAtTokens(promptText));
          }
        } else if (hasNBRef) {
          // NB2 Mode B (+버튼) — @[...] 토큰은 이미 + 버튼으로 첨부됐으므로
          // 본문에서 제거한 clean text 만 타이핑.
          await setPromptText(stripAtTokens(promptText));
        } else if (hasLegacyTag && typeof window.__toolbTypePromptTBM === 'function') {
          await window.__toolbTypePromptTBM(promptText);
        } else {
          await setPromptText(promptText);
        }

        // (6) 파이프라인 체크포인트 2 — 80% 에서 Generate 클릭
        if (concurrent > 1 && activeGens.length > 0) {
          var lastB = activeGens[activeGens.length - 1];
          if (!lastB.resolved) {
            await waitForGenProgress(lastB, 80, genTimeout);
          }
        }
        if (!state.running || state.sessionId !== sid) break;

        await randSleep(300, 700);
        await clickGenerate();

        var gen = createGen(promptText, pi, batchCount);
        activeGens.push(gen);
        log(label + ' (' + (pi + 1) + '/' + prompts.length + ') Generate! (슬롯 ' + activeGens.length + '/' + concurrent + ')', 'info');

      } catch (err) {
        log(label + ' 에러: ' + (err && err.message ? err.message : String(err)), 'error');
        state.failedIndexes.push(pi);
        sendEvent({ type: 'GENERATION_FAILED', index: pi + 1, error: err && err.message || String(err) });
      }

      // (7) 프롬프트 간 딜레이
      if (pi < prompts.length - 1 && state.running) {
        await randSleep(delayMin * 1000, delayMax * 1000);
      }
    }

    if (state.sessionId !== sid) return;

    // (7) Drain — 남은 슬롯 완료 대기
    if (state.running && activeGens.length > 0) {
      log('남은 ' + activeGens.length + '개 생성 완료 대기...', 'info');
      var drainDeadline = Date.now() + (genTimeout + 10) * 1000;
      while (state.running && state.sessionId === sid && activeGens.length > 0) {
        if (Date.now() > drainDeadline) break;
        await sleep(2000);
      }
    }

    // (8) 잔여는 실패로 마킹
    activeGens.forEach(function (g) {
      if (!g.resolved) {
        g.resolved = true;
        state.failedIndexes.push(g.index);
        g.tileIds.forEach(function (t) { knownTileIds.add(t); });
      }
    });
    activeGens = [];
    watcherRunning = false;

    // (9) 리포트 — 실패 항목은 NB2 id 있으면 id 로, 없으면 #인덱스 로 표시
    var failedList = state.failedIndexes
      .slice()
      .sort(function (a, b) { return a - b; })
      .map(function (i) {
        var p = state.prompts[i];
        return (p && p.id) ? p.id : '#' + (i + 1);
      })
      .join(', ');
    var summary = '배치 종료 — 성공 ' + state.successCount + '/' + state.prompts.length +
                  (state.failedIndexes.length ? ' / 실패 ' + failedList : '');
    log(summary, state.failedIndexes.length ? 'error' : 'success');

    sendEvent({
      type: 'BATCH_COMPLETE',
      successCount: state.successCount,
      totalCount: state.prompts.length,
      failedIndexes: state.failedIndexes.slice()
    });
    sendEvent({
      type: 'PROGRESS_UPDATE',
      current: state.prompts.length,
      total: state.prompts.length,
      currentPrompt: '완료'
    });

    state.running = false;
  }

  /* ════════════════════════════════════════════
   * 메시지 수신
   * ════════════════════════════════════════════ */
  window.addEventListener('message', function (evt) {
    // v1.4.9 sentinel: 재로드로 교체된 구 인스턴스라면 즉시 탈출
    if (window.__toolbPageToken !== MY_PAGE_TOKEN) return;
    if (evt.source !== window) return;
    var d = evt.data;
    if (!d || d.source !== 'flowbulk-bridge-tbm') return;
    var msg = d.payload;
    if (!msg || !msg.type) return;

    var reply = null;
    switch (msg.type) {
      case 'START_BATCH':
        if (state.running) {
          reply = { success: false, error: '이미 실행 중입니다' };
        } else {
          runBatch(msg.settings || {});
          reply = { success: true };
        }
        break;
      case 'PAUSE_BATCH':
        state.paused = true;
        reply = { success: true };
        break;
      case 'RESUME_BATCH':
        state.paused = false;
        reply = { success: true };
        break;
      case 'STOP_BATCH':
        state.running = false;
        state.paused = false;
        watcherRunning = false;
        activeGens = [];
        reply = { success: true };
        break;
      case 'GET_STATUS':
        reply = {
          success: true,
          running: state.running,
          paused: state.paused,
          currentIndex: state.currentIndex,
          total: state.prompts.length
        };
        break;
      case 'PING':
        reply = { success: true, status: 'alive' };
        break;
      // DOWNLOAD_IMAGE_RESULT 는 bridge 가 보내는 릴레이. 필요 시 처리.
    }

    if (reply) sendResponse(reply);
  });

  sendEvent({ type: 'STATUS_UPDATE', connected: true });
  console.log('[FlowBulk] page-script loaded (v1.6.8, MAIN world) —', location.href, MY_PAGE_TOKEN);
})();
