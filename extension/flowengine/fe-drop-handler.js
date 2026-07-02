// drop-handler.js — MAIN world (v1.4.9)
// (1) __toolbTypePrompt: [tag] → @ → 자산 다이얼로그 → 검색 → 클릭 방식
//     (v1.4.8 재작성 — NB2 Mode A 와 동일 경로. Flow 의 @ 는 인라인 멘션이
//      아니라 + 버튼과 같은 자산 다이얼로그를 연다.)
// (2) 사이드패널 "첨부" 버튼: 실제 이미지 드롭
//
// v1.4.9 변경 — 확장 재로드 후 구 인스턴스 리스너/옵저버 중복 방지 가드.
//   window.__toolbDropHandlerToken 에 로드마다 유일 토큰을 심고,
//   리스너/옵저버 콜백 진입부에서 자기 토큰과 다르면 조기 return.
//   (구 인스턴스의 MutationObserver 는 disconnect 할 수 없으므로
//    콜백 안에서 자기 자신을 비활성화한다.)

(function () {
  'use strict';

  /* ── HTMLInputElement.value setter 가 TEXTAREA에 잘못 호출되는 문제 패치 ──
   * page-script(_0x2ba2a5)가 항상 HTMLInputElement.prototype.value 의 setter 를 사용해서
   * TEXTAREA 에 호출하면 "Illegal invocation" 발생 → 비디오 모드 프롬프트(textarea)에서 실패.
   * 입력 시점에 element type 을 보고 적절한 setter 로 위임하도록 prototype 패치. */
  try {
    var inputDesc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    var textareaDesc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (inputDesc && inputDesc.set && textareaDesc && textareaDesc.set && !inputDesc.__toolbPatched) {
      var origInputSet = inputDesc.set;
      var textareaSet = textareaDesc.set;
      Object.defineProperty(window.HTMLInputElement.prototype, 'value', {
        get: inputDesc.get,
        set: function (v) {
          if (this instanceof window.HTMLTextAreaElement) {
            return textareaSet.call(this, v);
          }
          return origInputSet.call(this, v);
        },
        configurable: true,
        enumerable: inputDesc.enumerable
      });
      var newDesc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (newDesc) newDesc.__toolbPatched = true;
      console.log('[ToolB] HTMLInputElement value setter 패치 적용 (TEXTAREA 위임)');
    }
  } catch (e) {
    console.warn('[ToolB] value setter 패치 실패:', e);
  }

  /* ── v1.4.9 sentinel 가드 ────────────────────
   * 이 인스턴스만의 고유 토큰을 만들어 window 에 심는다.
   * 확장 재로드 시 새 인스턴스가 토큰을 덮어쓰면, 구 인스턴스의
   * 리스너/옵저버 콜백은 진입부 가드에서 자동 조기 return → 중복 실행 제거. */
  var MY_DROP_TOKEN = 'drop-v1.4.9-' +
    Math.random().toString(36).slice(2, 10) + '-' + Date.now();
  window.__toolbDropHandlerToken = MY_DROP_TOKEN;

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  /* ── 유니코드 정규화 (NFC) ─────────────────────
   * macOS FS 는 한글을 NFD(분해형: ㅋ+ㅐ+ㄹ+...) 로 저장한다.
   * 이 상태로 charAt(c) 루프를 돌면 자모 단위로 beforeinput 이 날아가서
   * Slate 에디터가 조합하지 못하고 "ㅋㅐㄹㅣㄱㅌㅓ" 같은 깨진 텍스트가 남는다.
   * 또한 Flow 의 자산/멘션 검색 인덱스는 NFC 기준이라 indexOf 매칭도 실패.
   * → 모든 사용자 입력 문자열은 NFC 로 정규화한 뒤 타이핑/검색에 사용. */
  function nfc(s) {
    try {
      return (s == null ? '' : String(s)).normalize('NFC');
    } catch (_) {
      return s == null ? '' : String(s);
    }
  }

  /* ── React 네이티브 입력 setter ──────────────── */
  function reactSetValue(input, value) {
    var nativeSetter =
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* ── contenteditable에 텍스트 삽입 ──────────── */
  function insertText(el, text) {
    el.focus();
    var ok = document.execCommand('insertText', false, text);
    if (!ok) {
      var nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(el, (el.value || '') + text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }

  /* ── @ 키 눌러서 피커 트리거 ─────────────────── */
  // 수동 플로우와 동일하게 실제 '@' 문자가 에디터에 들어가야 인라인 멘션 드롭다운이 뜸.
  //
  // 한 글자에 대한 풀 시퀀스: keydown → beforeinput → input → keyup.
  // - beforeinput 은 Slate 가 에디터 문서 모델에 글자를 반영하는 경로
  // - keydown/keyup 은 멘션 플러그인의 인라인 드롭다운 필터 업데이트 경로
  // 이 둘 중 하나라도 빠지면 "@" 는 찍히는데 팝업이 필터되지 않거나 반대로
  // 팝업은 뜨는데 에디터에 글자가 없는 상태가 발생한다. NB2 insertTextSlate 이식.
  function fireSlateChar(el, ch, opts) {
    opts = opts || {};
    var code = /^[a-zA-Z]$/.test(ch) ? ('Key' + ch.toUpperCase())
             : /^[0-9]$/.test(ch)    ? ('Digit' + ch)
             : (opts.code || '');
    var kc = (typeof opts.keyCode === 'number') ? opts.keyCode : ch.charCodeAt(0);
    var keyOpts = {
      key: ch, code: code, keyCode: kc, which: kc, charCode: kc,
      shiftKey: !!opts.shiftKey,
      bubbles: true, cancelable: true
    };
    el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true, cancelable: true, composed: true,
      inputType: 'insertText', data: ch
    }));
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, composed: true,
      inputType: 'insertText', data: ch
    }));
    el.dispatchEvent(new KeyboardEvent('keyup', Object.assign({}, keyOpts, { cancelable: false })));
  }

  function triggerAtKey(el) {
    el.focus();
    // 실제 키보드 "@" 은 shift + '2' → keyCode 50 (Digit2), shiftKey true
    fireSlateChar(el, '@', { code: 'Digit2', keyCode: 50, shiftKey: true });
    // 폴백: 에디터 끝에 @ 가 반영되지 않았으면 execCommand 로 강제 삽입
    if (!((el.textContent || '').endsWith('@'))) {
      try { document.execCommand('insertText', false, '@'); } catch (_) {}
    }
  }

  /* ── 프롬프트 입력창 탐색 ────────────────────── */
  function findPromptInput() {
    // contenteditable 우선
    var els = document.querySelectorAll('[contenteditable="true"]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].offsetParent !== null) return els[i];
    }
    // textarea fallback
    var textareas = document.querySelectorAll('textarea');
    for (var i = 0; i < textareas.length; i++) {
      if (textareas[i].offsetParent !== null) return textareas[i];
    }
    return null;
  }

  /* ── 피커 검색창 폴링 (최대 maxMs 대기) ────────── */
  async function waitForPickerInput(el, maxMs) {
    var selectors = [
      '[data-radix-popper-content-wrapper] input',
      '[role="dialog"][data-state="open"] input',
      '[role="listbox"] input',
      '[cmdk-input]',
      'input[placeholder*="검색"], input[placeholder*="Search"]',
    ];
    var deadline = Date.now() + (maxMs || 5000);
    while (Date.now() < deadline) {
      for (var s = 0; s < selectors.length; s++) {
        var found = document.querySelector(selectors[s]);
        if (found && found !== el && found.offsetParent !== null) {
          return found;
        }
      }
      await sleep(300);
    }
    return null;
  }

  /* ── pickerInput 일괄 setValue (이미지투이미지의 _0x474cf2 와 동일 패턴) ── */
  async function typeInPicker(pickerInput, text) {
    text = nfc(text);
    var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    pickerInput.focus();
    await sleep(80);
    if (ns) ns.call(pickerInput, text);
    else pickerInput.value = text;
    pickerInput.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, composed: true,
      inputType: 'insertText', data: text
    }));
    pickerInput.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[ToolB] pickerInput.value (bulk):', pickerInput.value);
  }

  /* ── 피커 검색 결과에 name 과 일치하는 항목이 나올 때까지 폴링 ──
   * Flow 의 피커는 Radix/cmdk 를 쓰지 않는 자체 컴포넌트라 표준 role 이 없을 수 있음.
   * pickerInput 의 컨테이너를 찾아서 그 안의 visible 리프 텍스트 요소에서 name 매칭.
   */
  function getPickerContainer(pickerInput) {
    if (!pickerInput) return null;
    return (
      pickerInput.closest('[role="dialog"]') ||
      pickerInput.closest('[data-radix-popper-content-wrapper]') ||
      pickerInput.closest('[role="listbox"]') ||
      pickerInput.closest('[cmdk-root]') ||
      pickerInput.closest('[aria-modal="true"]') ||
      // fallback: 입력창에서 2~3 단계 위 조상 (보통 모달/패널)
      pickerInput.parentElement && pickerInput.parentElement.parentElement
    ) || null;
  }

  async function waitForPickerMatch(name, pickerInput, maxMs) {
    var deadline = Date.now() + (maxMs || 6000);
    var needle = nfc(String(name || '')).trim().toLowerCase();
    if (!needle) return false;

    var container = getPickerContainer(pickerInput);

    function scan(root) {
      // 클릭 가능하거나 리스트-아이템 성격의 요소
      var candidates = root.querySelectorAll(
        '[role="option"], [cmdk-item], [data-radix-collection-item], ' +
        '[role="listitem"], li, button, [role="button"], a'
      );
      for (var i = 0; i < candidates.length; i++) {
        var it = candidates[i];
        if (it === pickerInput) continue;
        if (it.tagName === 'INPUT' || it.tagName === 'TEXTAREA') continue;
        if (it.offsetParent === null) continue;
        var text = nfc(it.textContent || '').trim();
        if (!text || text.length > 200) continue;  // 너무 큰 컨테이너는 스킵
        if (text.toLowerCase().indexOf(needle) !== -1) return it;
      }
      // 폴백: 리프 div/span 도 스캔 (Flow 가 커스텀 div 로 리스트를 그리는 경우)
      var leaves = root.querySelectorAll('div, span');
      for (var j = 0; j < leaves.length; j++) {
        var le = leaves[j];
        if (le.children.length > 0) continue;      // leaf 만
        if (le.offsetParent === null) continue;
        var ltext = nfc(le.textContent || '').trim();
        if (!ltext || ltext.length > 120) continue;
        if (ltext.toLowerCase().indexOf(needle) !== -1) return le;
      }
      return null;
    }

    while (Date.now() < deadline) {
      var root = container || document;
      var hit = scan(root);
      if (hit) {
        console.log('[ToolB] 피커 매칭 요소:', hit.tagName, '"' + (hit.textContent || '').trim().slice(0, 60) + '"');
        return hit;
      }
      // 컨테이너 내부에서 못 찾으면 document 전체로 한 번 더 (컨테이너 탐지 실패 대비)
      if (container && container !== document) {
        var hit2 = scan(document);
        if (hit2) {
          console.log('[ToolB] 피커 매칭 요소 (doc):', hit2.tagName, '"' + (hit2.textContent || '').trim().slice(0, 60) + '"');
          return hit2;
        }
      }
      await sleep(250);
    }
    return null;
  }

  // React onClick 핸들러를 안전하게 트리거 — mousedown / mouseup / click 시퀀스
  // v1.6.5: 풀 pointer+mouse 시퀀스. 새 Flow UI 의 picker / 드롭다운은
  // mousedown/mouseup 만으론 핸들러가 동작 안 하는 경우가 있음 (pointerdown 기반).
  function robustClick(el) {
    if (!el) return;
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    var c = {
      bubbles: true, cancelable: true, composed: true, view: window,
      button: 0, buttons: 1, clientX: cx, clientY: cy
    };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'mouse' }, c))); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', c)); } catch (_) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerType: 'mouse', buttons: 0 }, c))); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, c, { buttons: 0 }))); } catch (_) {}
    try { el.click(); } catch (_) {}
  }

  // 매칭된 요소에서 가장 그럴듯한 "클릭 가능" 조상을 찾음
  function findClickableAncestor(el) {
    if (!el) return el;
    // 우선순위 1: Flow 자산 타일 (최상위 클릭 영역)
    if (el.closest) {
      var tile = el.closest('[data-tile-id]');
      if (tile) return tile;
    }
    // 우선순위 2: 표준 클릭 가능 요소
    var cur = el;
    for (var i = 0; i < 8 && cur && cur !== document.body; i++) {
      var tag = cur.tagName;
      var role = cur.getAttribute && cur.getAttribute('role');
      if (tag === 'BUTTON' || tag === 'A' || tag === 'LI') return cur;
      if (role === 'option' || role === 'button' || role === 'listitem') return cur;
      if (cur.hasAttribute && cur.hasAttribute('cmdk-item')) return cur;
      if (cur.hasAttribute && cur.hasAttribute('data-radix-collection-item')) return cur;
      if (cur.onclick) return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  function closePicker(fallbackEl) {
    var ev = {
      key: 'Escape', keyCode: 27, which: 27,
      bubbles: true, cancelable: true
    };
    (fallbackEl || document).dispatchEvent(new KeyboardEvent('keydown', ev));
  }

  /* ── 인라인 멘션 팝업 (작은 부유 드롭다운) 감지 ──
   * 사용자가 에디터에 "@" + 이름 을 직접 입력하면 Flow 의 멘션 플러그인이 띄우는
   * 작은 팝업. 보통 Radix Popper / Floating UI / portal 안에 렌더링됨.
   * 항상 보이는 사이드바/모달 과 구분하기 위해 popup 셀렉터를 좁힘.
   */
  async function waitForMentionPopup(name, maxMs) {
    var deadline = Date.now() + (maxMs || 6000);
    // NFC 정규화 + 소문자화 (NFD 한글이 들어오면 매칭 실패하므로)
    var needle = nfc(String(name || '')).trim().toLowerCase();
    if (!needle) return null;

    function popupCandidates() {
      return document.querySelectorAll(
        '[data-radix-popper-content-wrapper], ' +
        '[role="listbox"], ' +
        '[cmdk-root], ' +
        '[role="dialog"][data-state="open"], ' +
        '[role="menu"], ' +
        '[role="tooltip"][data-state="open"], ' +
        '[data-floating-ui-portal]'
      );
    }

    function findMatchInPopup(popup) {
      // 우선: 표준 항목 셀렉터
      var items = popup.querySelectorAll(
        '[role="option"], [cmdk-item], [data-radix-collection-item], li, button, [role="button"]'
      );
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.offsetParent === null) continue;
        var t = nfc(it.textContent || '').trim().toLowerCase();
        if (!t || t.length > 200) continue;
        if (t.indexOf(needle) !== -1) return it;
      }
      // 폴백: 리프 div/span 스캔
      var leaves = popup.querySelectorAll('div, span');
      for (var j = 0; j < leaves.length; j++) {
        var le = leaves[j];
        if (le.children.length > 0) continue;
        if (le.offsetParent === null) continue;
        var lt = nfc(le.textContent || '').trim().toLowerCase();
        if (!lt || lt.length > 120) continue;
        if (lt.indexOf(needle) !== -1) return le;
      }
      return null;
    }

    while (Date.now() < deadline) {
      var popups = popupCandidates();
      for (var i = 0; i < popups.length; i++) {
        var p = popups[i];
        if (p.offsetParent === null) continue;
        var hit = findMatchInPopup(p);
        if (hit) {
          console.log('[ToolB] 멘션 팝업 감지:',
                      p.tagName,
                      'role=' + (p.getAttribute && p.getAttribute('role')),
                      '매칭="' + (hit.textContent || '').trim().slice(0, 40) + '"');
          return { popup: p, matchedEl: hit };
        }
      }
      await sleep(200);
    }
    return null;
  }

  /* ── [__ToolBTag::name] 형식의 토큰만 @-피커 처리, 나머지는 plain text ─────
   * 사용자 프롬프트가 일반 [...] 를 콘텐츠로 가질 수 있어 (예: [Dior] [perfume])
   * 우리 전용 prefix 로 분리해서 충돌 방지
   * 특수값 TYPE_ONLY 는 트리거용 sentinel — 스킵 */
  var TOOLB_TAG_RE = /\[__ToolBTag::([^\]]+)\]/g;

  /* ── Slate 에디터 잔여 '@' 제거 (slate-helper.js 경유) ─────── */
  function removeStraySlateAt() {
    return new Promise(function (resolve) {
      var done = false;
      function onResult(e) {
        if (done) return;
        done = true;
        document.removeEventListener('__toolb_slate_result', onResult);
        var detail = e && e.detail;
        if (detail && detail.ok) {
          if (detail.removed > 0) {
            console.log('[ToolB] Slate 잔여 @ ' + detail.removed + '개 제거 완료');
          }
        } else {
          console.warn('[ToolB] Slate @ 제거 실패:', detail && detail.error);
        }
        resolve(!!(detail && detail.ok));
      }
      document.addEventListener('__toolb_slate_result', onResult);
      document.dispatchEvent(new CustomEvent('__toolb_slate_remove_at'));
      setTimeout(function () {
        if (!done) {
          document.removeEventListener('__toolb_slate_result', onResult);
          resolve(false);
        }
      }, 3000);
    });
  }

  /* ══════════════════════════════════════════════
   * '+' 버튼 모드 (자산 다이얼로그 경유) — fallback
   * NB2 Mode B 로직을 이식. @멘션 실패 시 사용.
   * ══════════════════════════════════════════════ */

  function findAddAssetButton() {
    // Flow 의 '+ 자산 추가' 버튼: aria-haspopup="dialog" + add_2 / add 아이콘
    var targets = document.querySelectorAll('button[aria-haspopup="dialog"]');
    for (var i = 0; i < targets.length; i++) {
      var btn = targets[i];
      if (btn.offsetParent === null) continue;
      var icon = btn.querySelector('i');
      var iconText = icon ? (icon.textContent || '').trim() : '';
      if (iconText === 'add_2' || iconText === 'add' || iconText.indexOf('add') !== -1) {
        return btn;
      }
    }
    // 폴백: 모든 버튼 중 add_2 아이콘 포함
    var all = document.querySelectorAll('button');
    for (var j = 0; j < all.length; j++) {
      var b = all[j];
      if (b.offsetParent === null) continue;
      var ic = b.querySelector('i');
      if (ic && (ic.textContent || '').trim() === 'add_2') return b;
    }
    return null;
  }

  function findAssetDialog() {
    var dialogs = document.querySelectorAll('[role="dialog"]');
    for (var i = 0; i < dialogs.length; i++) {
      var d = dialogs[i];
      if (d.offsetParent === null) continue;
      var rect = d.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 100) continue;
      return d;
    }
    return null;
  }

  function findAssetSearchInput(dialog) {
    var scope = dialog || document;
    // 1) 플레이스홀더 기반
    var inputs = scope.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      if (inp.offsetParent === null) continue;
      var ph = (inp.placeholder || '').toLowerCase();
      if (ph.indexOf('애셋') !== -1 || ph.indexOf('검색') !== -1 || ph.indexOf('search') !== -1) {
        return inp;
      }
    }
    // 2) 첫 visible text input
    for (var j = 0; j < inputs.length; j++) {
      var inp2 = inputs[j];
      if (inp2.offsetParent === null) continue;
      if (inp2.type === 'text' || !inp2.type) return inp2;
    }
    return null;
  }

  async function waitForAssetDialog(maxMs) {
    var deadline = Date.now() + (maxMs || 4000);
    while (Date.now() < deadline) {
      var d = findAssetDialog();
      if (d) {
        var inp = findAssetSearchInput(d);
        if (inp) return { dialog: d, input: inp };
      }
      await sleep(250);
    }
    return null;
  }

  function findAssetCandidates(dialog) {
    var out = [];
    if (!dialog) return out;
    var seenEls = new Set();
    var divs = dialog.querySelectorAll('div');
    for (var i = 0; i < divs.length; i++) {
      var d = divs[i];
      if (d.offsetParent === null) continue;
      var img = d.querySelector('img');
      if (!img) continue;
      var rect = d.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 30 || rect.width > 500) continue;
      // v1.6.5: 새 picker UI 는 cursor:pointer 아닐 수 있으므로 그 필터 제거.
      //          자식이 너무 많으면 그룹 컨테이너 (스킵).
      if (d.children.length > 6) continue;
      if (seenEls.has(d)) continue;
      seenEls.add(d);

      // 이름 추출: leaf text
      var name = '';
      var leafs = d.querySelectorAll('div, span');
      for (var k = 0; k < leafs.length; k++) {
        var le = leafs[k];
        if (le.children.length === 0) {
          var t = (le.textContent || '').trim();
          if (t) { name = t; break; }
        }
      }
      if (!name) name = (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      // NFC 정규화: 후보 이름도 NFC 로 통일해 이후 indexOf 비교가 안정되도록
      out.push({ el: d, name: nfc(name) });
    }
    return out;
  }

  async function typeInAssetSearch(input, text) {
    text = nfc(text);
    input.focus();
    await sleep(80);
    var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (ns) ns.call(input, text);
    else input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function waitForAssetDialogClose(maxMs) {
    var deadline = Date.now() + (maxMs || 4000);
    while (Date.now() < deadline) {
      if (!findAssetDialog()) return true;
      await sleep(200);
    }
    return false;
  }

  // @-멘션 실패 시 자산을 '+' 버튼으로 첨부하는 fallback.
  // 성공 시 true 반환; 실패 시 false (호출부가 throw 처리).
  async function attachAssetViaPlusButton(assetName) {
    // NFC 정규화 (macOS NFD 한글 대응)
    assetName = nfc(assetName);
    var editorEl = findPromptInput();
    if (!editorEl) {
      console.warn('[ToolB] +버튼 fallback: 에디터 없음');
      return false;
    }

    // 에디터에 남은 "@..." 제거 (Slate helper)
    try {
      editorEl.focus();
      await sleep(50);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.selectAllChildren(editorEl);
      await sleep(40);
      document.execCommand('delete', false, null);
    } catch (_) { /* noop */ }
    await removeStraySlateAt();
    await sleep(200);

    var btn = findAddAssetButton();
    if (!btn) {
      console.warn('[ToolB] +버튼 fallback: + 버튼을 찾지 못함');
      return false;
    }
    console.log('[ToolB] +버튼 fallback: 클릭 →', assetName);
    btn.click();

    var dlg = await waitForAssetDialog(4000);
    if (!dlg) {
      console.warn('[ToolB] +버튼 fallback: 자산 다이얼로그 안 열림');
      return false;
    }

    await typeInAssetSearch(dlg.input, assetName);
    console.log('[ToolB] +버튼 fallback: "' + assetName + '" 검색');
    await sleep(1400);

    // 결과 매칭: 정확 → 부분 → 첫 결과
    var matched = null;
    for (var attempt = 0; attempt < 10 && !matched; attempt++) {
      var dialogNow = findAssetDialog();
      if (!dialogNow) break;
      var cands = findAssetCandidates(dialogNow);
      if (cands.length > 0) {
        for (var a = 0; a < cands.length; a++) {
          if (cands[a].name === assetName) { matched = cands[a]; break; }
        }
        if (!matched) {
          for (var b = 0; b < cands.length; b++) {
            if (cands[b].name.indexOf(assetName) !== -1 ||
                assetName.indexOf(cands[b].name) !== -1) {
              matched = cands[b]; break;
            }
          }
        }
        // NB2 동일: 결과 3개 이하면 첫 결과 관대 선택
        if (!matched && cands.length <= 3) {
          matched = cands[0];
          console.log('[ToolB] +버튼 fallback: 관대 매칭 (첫 결과) "' + matched.name + '"');
        }
      }
      if (!matched) await sleep(400);
    }

    if (!matched) {
      console.warn('[ToolB] +버튼 fallback: 매칭 결과 없음 — Esc');
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
      }));
      await sleep(400);
      return false;
    }

    console.log('[ToolB] +버튼 fallback: 선택 →', matched.name);
    await sleep(200);
    robustClick(matched.el);
    await sleep(500);

    // v1.6.5: 새 picker UI 는 자산 클릭 후 "프롬프트에 추가" 버튼이 따로 있다.
    // 그 버튼이 있으면 클릭 (구 UI 는 그냥 닫힘).
    var dlgNow = findAssetDialog();
    if (dlgNow) {
      var addToPromptBtn = null;
      var dbs = dlgNow.querySelectorAll('button');
      for (var ai = 0; ai < dbs.length; ai++) {
        var atxt = (dbs[ai].textContent || '').trim();
        if (atxt === '프롬프트에 추가' || atxt === 'Add to prompt' ||
            atxt.indexOf('프롬프트에 추가') !== -1) {
          addToPromptBtn = dbs[ai];
          break;
        }
      }
      if (addToPromptBtn) {
        console.log('[ToolB] +버튼 fallback: "프롬프트에 추가" 클릭');
        robustClick(addToPromptBtn);
        await sleep(500);
      }
    }

    var closed = await waitForAssetDialogClose(3500);
    if (!closed) {
      // 일부 Flow 빌드는 선택 후 수동 닫기 필요
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
      }));
      await sleep(400);
    }
    await sleep(400);
    return true;
  }

  window.__toolbTypePrompt = async function (promptText) {
    // NFC 정규화: macOS NFD 한글 → NFC 로 맞춘다 (Slate/Flow 검색 모두 NFC 기준)
    promptText = nfc(promptText);
    console.log('[ToolB] __toolbTypePrompt:', promptText);

    var el = findPromptInput();
    if (!el) throw new Error('프롬프트 입력창을 찾을 수 없습니다');

    // page-script(_0x2ba2a5)가 image-to-image에서 동작 검증된 방식 사용:
    // focus + selectAllChildren + InputEvent(beforeinput, insertText)
    el.focus();
    await sleep(30);
    try {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.selectAllChildren(el);
    } catch (e) {
      console.warn('[ToolB] selectAllChildren 실패:', e);
    }
    await sleep(50);

    // promptText 를 [__ToolBTag::name] 토큰 기준으로 split
    // result: [text, tagName, text, tagName, text, ...]
    var segments = [];
    var lastIdx = 0;
    var match;
    TOOLB_TAG_RE.lastIndex = 0;
    while ((match = TOOLB_TAG_RE.exec(promptText)) !== null) {
      if (match.index > lastIdx) {
        segments.push({ type: 'text', value: promptText.slice(lastIdx, match.index) });
      }
      segments.push({ type: 'tag', value: match[1] });
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < promptText.length) {
      segments.push({ type: 'text', value: promptText.slice(lastIdx) });
    }

    // 앞쪽이 sentinel(만)이고 그 뒤에 공백이 있으면 그 공백 트림
    for (var s = 0; s < segments.length; s++) {
      if (segments[s].type === 'text') {
        // 첫 텍스트 세그먼트가 공백으로 시작하면 trim
        if (s === 0 || segments[s - 1].type === 'tag') {
          segments[s].value = segments[s].value.replace(/^\s+/, '');
        }
        if (segments[s].value === '') {
          segments.splice(s, 1);
          s--;
        }
      }
    }

    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (seg.type === 'tag') {
        var charName = nfc(seg.value).trim();

        // sentinel 은 무시
        if (charName === 'TYPE_ONLY') {
          console.log('[ToolB] sentinel TYPE_ONLY — 스킵');
          continue;
        }

        console.log('[ToolB] @ 입력 →', charName);

        // ── NB2 Mode A 방식 (v1.4.8) ─────────────────────────────
        //
        // NB2 의 성공 로그로 확인: Flow 의 `@` 는 "인라인 멘션 드롭다운" 이
        // 아니라 + 버튼과 동일한 자산 다이얼로그를 연다.
        //
        //   [NB2 8:37:25] 🔗 @ 입력 → "검사" 검색
        //   [NB2 8:37:29] 🔍 "검사" 검색 중...    ← 다이얼로그 검색창에 타이핑
        //   [NB2 8:37:31] 📌 에셋 부분 매칭: "검사.png"
        //   [NB2 8:37:32] ✅ "검사" 선택 완료
        //   [NB2 8:37:33] 🧹 Slate 내부 @ 1개 제거 완료
        //
        // 따라서 절차는:
        //   ① 에디터에 @ 한 글자만 입력 → Flow 가 자산 다이얼로그를 연다
        //   ② waitForAssetDialog 로 다이얼로그가 열렸는지 확인
        //   ③ 다이얼로그 안의 검색창에 charName 을 직접 입력 (에디터 X)
        //   ④ 후보 타일에서 정확/부분/첫결과 순으로 매칭 → 클릭
        //   ⑤ 다이얼로그 닫힘 대기
        //   ⑥ 에디터에 잔존한 "@" 를 slate-helper 로 제거
        //   ⑦ @ 가 있던 자리에 멘션 칩이 주입되므로 @ 다음 글자들은 정상 처리
        //
        // 기존의 "인라인 피커" 루프(3회 재시도) 는 Flow UI 와 맞지 않아
        // 항상 실패했다. 완전히 제거.
        var MAX_RETRY = 2;
        var selected = false;

        for (var attempt = 1; attempt <= MAX_RETRY && !selected; attempt++) {
          // 재시도 시 에디터 정리
          if (attempt > 1) {
            try { await removeStraySlateAt(); } catch (_) {}
            await sleep(100);
          }

          // ① 에디터에 @ 한 글자 입력 → 다이얼로그 오픈 트리거
          el.focus();
          await sleep(60);
          console.log('[ToolB] (시도 ' + attempt + ') @ 키 입력 → 자산 다이얼로그 대기');
          triggerAtKey(el);
          await sleep(300);

          // ② 다이얼로그가 열렸는지 확인
          var dlg = await waitForAssetDialog(4000);
          if (!dlg) {
            console.warn('[ToolB] @ 로 다이얼로그가 안 열림 (시도 ' + attempt + ')');
            // 에디터에 남은 @ 제거
            try { await removeStraySlateAt(); } catch (_) {}
            await sleep(400);
            continue;
          }

          // ③ 다이얼로그 검색창에 charName 직접 입력
          try {
            await typeInAssetSearch(dlg.input, charName);
            console.log('[ToolB] "' + charName + '" 검색 중... (시도 ' + attempt + ')');
          } catch (tsErr) {
            console.warn('[ToolB] 검색창 입력 실패:', tsErr && tsErr.message);
          }
          await sleep(1600);

          // ④ 후보 매칭 — NB2 동일: 정확 → 부분 → 관대(첫)
          var matched = null;
          for (var pollN = 0; pollN < 10 && !matched; pollN++) {
            var dialogNow = findAssetDialog();
            if (!dialogNow) break;
            var cands = findAssetCandidates(dialogNow);
            if (cands.length > 0) {
              for (var a = 0; a < cands.length; a++) {
                if (cands[a].name === charName) { matched = cands[a]; break; }
              }
              if (!matched) {
                for (var b = 0; b < cands.length; b++) {
                  if (cands[b].name.indexOf(charName) !== -1 ||
                      charName.indexOf(cands[b].name) !== -1) {
                    console.log('[ToolB] 부분 매칭: "' + cands[b].name + '"');
                    matched = cands[b]; break;
                  }
                }
              }
              if (!matched && cands.length <= 3) {
                matched = cands[0];
                console.log('[ToolB] 관대 매칭 (첫 결과): "' + matched.name + '"');
              }
            }
            if (!matched) await sleep(400);
          }

          if (!matched) {
            console.warn('[ToolB] "' + charName + '" 매칭 결과 없음 (시도 ' + attempt + ') — Esc');
            try {
              document.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
              }));
            } catch (_) {}
            await sleep(400);
            try { await removeStraySlateAt(); } catch (_) {}
            await sleep(300);
            continue;
          }

          // ⑤ 클릭 → 다이얼로그 닫힘 대기
          console.log('[ToolB] 선택 → "' + matched.name + '"');
          await sleep(200);
          robustClick(matched.el);
          await sleep(500);

          var closed = await waitForAssetDialogClose(3500);
          if (!closed) {
            try {
              document.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
              }));
            } catch (_) {}
            await sleep(400);
          }

          selected = true;

          // ⑥ 에디터에 잔존한 @ 제거 (NB2 removeSlateLeftoverAt 동일)
          el.focus();
          el.click();
          await sleep(300);
          try { await removeStraySlateAt(); } catch (_) {}
          await sleep(500);
        }

        if (!selected) {
          // 모든 시도 실패 → + 버튼 fallback (다이얼로그 자체가 안 열리는 극단 케이스)
          console.warn('[ToolB] @ 경로 실패 → +버튼 fallback');
          try { await removeStraySlateAt(); } catch (_) {}
          var fbOk = false;
          try { fbOk = await attachAssetViaPlusButton(charName); } catch (_) {}
          if (!fbOk) {
            throw new Error(
              '에셋 "' + charName + '" 을(를) 찾지 못했습니다 ' +
              '(@ ' + MAX_RETRY + '회 + +버튼 fallback 실패).'
            );
          }
        }

        console.log('[ToolB] 자산 선택 완료:', charName);
        el.focus();
        await sleep(400);
      } else {
        // 일반 텍스트 — page-script _0x2ba2a5 와 동일한 패턴
        if (!seg.value) continue;
        el.focus();
        await sleep(30);

        // 전체 프롬프트의 첫 세그먼트일 때만 selectAll로 교체.
        // 이전에 tag(@mention)가 들어갔다면 selectAll은 멘션을 삼켜버리므로 금지.
        var isFirstText = (i === 0);

        if (isFirstText) {
          try {
            var sel2 = window.getSelection();
            sel2.removeAllRanges();
            sel2.selectAllChildren(el);
          } catch (_) {}
          await sleep(40);
        }

        // 1차: beforeinput InputEvent (Slate가 처리)
        el.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true, cancelable: true, composed: true,
          inputType: 'insertText',
          data: seg.value
        }));
        await sleep(150);

        // 검증: 텍스트가 들어갔는지 확인 (앞 20자 매칭) — 양쪽 NFC 로 비교
        var probe = seg.value.substring(0, Math.min(20, seg.value.length));
        if (nfc(el.textContent || '').indexOf(probe) === -1) {
          console.warn('[ToolB] beforeinput 미반영 — execCommand 폴백');
          el.focus();
          if (isFirstText) {
            try { document.execCommand('selectAll', false, null); } catch (_) {}
            await sleep(40);
          }
          document.execCommand('insertText', false, seg.value);
          await sleep(150);
        }

        await sleep(60);
      }
    }

    await sleep(700);
    console.log('[ToolB] 프롬프트 입력 완료');
  };

  console.log('[ToolB] __toolbTypePrompt 등록 완료');

  /* ════════════════════════════════════════════
     이하: 사이드패널 "첨부" 버튼 → 실제 이미지 드롭
     ════════════════════════════════════════════ */

  async function base64ToFile(dataUrl, fileName) {
    var res = await fetch(dataUrl);
    var blob = await res.blob();
    return new File([blob], fileName, { type: blob.type });
  }

  function findFileInput() {
    // 1) image accept 우선
    var imageInputs = document.querySelectorAll('input[type="file"]');
    for (var i = 0; i < imageInputs.length; i++) {
      var inp = imageInputs[i];
      var acc = (inp.accept || '').toLowerCase();
      if (acc.includes('image') || acc === '' || acc === '*/*') {
        return inp;
      }
    }
    // 2) 아무 file input 이라도
    if (imageInputs.length > 0) return imageInputs[0];
    return null;
  }

  function findUploadTrigger() {
    // 업로드 다이얼로그를 여는 버튼을 텍스트/클래스 매칭으로 탐색
    var keywords = ['업로드', 'upload', '이미지', 'image', '추가', 'add', '에셋', 'asset', '첨부'];
    var all = document.querySelectorAll('button, [role="button"], [aria-label]');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.offsetParent === null) continue;
      var text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
      for (var k = 0; k < keywords.length; k++) {
        if (text.indexOf(keywords[k]) !== -1) {
          // 사이드바 버튼일 확률 높음 — 너무 큰 버튼 제외
          var rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.width < 200 && rect.height < 100) {
            return el;
          }
        }
      }
    }
    return null;
  }

  function findDropZone() {
    var selectors = [
      '[class*="dropZone"]',
      '[class*="drop-zone"]',
      '[class*="DropZone"]',
      '[class*="upload-area"]',
      '[class*="uploadArea"]',
      '[class*="Dropzone"]',
      '[data-dropzone]',
      '[aria-label*="drop" i]',
      '[aria-label*="upload" i]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  async function simulateDrop(target, file) {
    var dt = new DataTransfer();
    dt.items.add(file);
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await sleep(60);
    target.dispatchEvent(new DragEvent('dragover',  { bubbles: true, cancelable: true, dataTransfer: dt }));
    await sleep(60);
    target.dispatchEvent(new DragEvent('drop',      { bubbles: true, cancelable: true, dataTransfer: dt }));
  }

  function injectIntoFileInput(fileInput, file) {
    var dt = new DataTransfer();
    dt.items.add(file);
    try {
      Object.defineProperty(fileInput, 'files', { value: dt.files, configurable: true });
    } catch (e) {
      // 이미 정의되어 있으면 직접 대입 시도
      fileInput.files = dt.files;
    }
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input',  { bubbles: true }));
  }

  // 업로드 완료 감지: Flow 라이브러리 타일 개수 증가를 폴링.
  // 타일은 [data-tile-id] 어트리뷰트로 식별됨 (Flow 내부 마커).
  async function waitForLibraryTileIncrease(baseline, maxMs) {
    var deadline = Date.now() + (maxMs || 30000);
    while (Date.now() < deadline) {
      var cur = document.querySelectorAll('[data-tile-id]').length;
      if (cur > baseline) return { ok: true, count: cur };
      await sleep(400);
    }
    return { ok: false, count: document.querySelectorAll('[data-tile-id]').length };
  }

  // 업로드 % 진행률 표시기가 사라지거나 100% 에 도달할 때까지 대기.
  // Flow 는 업로드 중 "20%", "85%" 같은 텍스트 노드를 렌더링함.
  // 표시기가 처음부터 없었으면 (빠른 업로드) 즉시 반환.
  async function waitForUploadProgressComplete(maxMs) {
    var deadline = Date.now() + (maxMs || 60000);
    var pctRe = /^\s*\d{1,3}\s*%\s*$/;
    var seenAny = false;

    function findProgressEls() {
      var out = [];
      // 텍스트가 "숫자%" 형태인 작은 요소만 검색 (div/span)
      var all = document.querySelectorAll('div, span');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.children.length > 0) continue;  // leaf 만
        if (el.offsetParent === null) continue;
        if (pctRe.test(el.textContent || '')) out.push(el);
      }
      return out;
    }

    while (Date.now() < deadline) {
      var els = findProgressEls();
      if (els.length === 0) {
        if (seenAny) return true;         // 이전에 보였다가 사라짐 = 완료
        // 처음부터 없으면 조금 더 관찰 후 종료 (빠른 업로드 케이스)
        await sleep(300);
        if (findProgressEls().length === 0) return true;
        continue;
      }
      seenAny = true;
      var allDone = true;
      for (var j = 0; j < els.length; j++) {
        var t = (els[j].textContent || '').trim();
        if (t !== '100%') { allDone = false; break; }
      }
      if (allDone) { await sleep(300); return true; }
      await sleep(400);
    }
    return false;
  }

  async function attachCharacterImage(imageData, fileName) {
    // NFC 정규화: 업로드되는 File.name 이 NFD 로 서버에 저장되면 이후 검색이 깨짐.
    fileName = nfc(fileName);
    console.log('[ToolB] attachCharacterImage 시작:', fileName);
    var file = await base64ToFile(imageData, fileName);

    // 업로드 전 타일 카운트 (라이브러리에 새 타일이 등장했는지 감지하기 위함)
    var baselineTiles = document.querySelectorAll('[data-tile-id]').length;
    console.log('[ToolB] 업로드 전 라이브러리 타일 수:', baselineTiles);

    var result = null;

    // 1) 즉시 file input 탐색
    var fileInput = findFileInput();
    if (fileInput) {
      console.log('[ToolB] file input 발견 (1차):', fileInput);
      injectIntoFileInput(fileInput, file);
      result = { method: 'file-input-direct' };
    } else {
      // 2) 업로드 트리거 버튼을 찾아 클릭해서 다이얼로그 오픈 후 재탐색
      var trigger = findUploadTrigger();
      if (trigger) {
        console.log('[ToolB] 업로드 트리거 클릭:', trigger);
        trigger.click();
        await sleep(700);
        fileInput = findFileInput();
        if (fileInput) {
          console.log('[ToolB] file input 발견 (2차):', fileInput);
          injectIntoFileInput(fileInput, file);
          result = { method: 'file-input-after-trigger' };
        }
      }

      if (!result) {
        // 3) 드롭존에 DragEvent 시뮬레이션
        var dropZone = findDropZone();
        if (dropZone) {
          console.log('[ToolB] 드롭존 발견:', dropZone);
          await simulateDrop(dropZone, file);
          result = { method: 'dropzone-simulate' };
        }
      }

      if (!result) {
        // 4) 최후 폴백 — body 에 드롭
        console.warn('[ToolB] file input / 드롭존 모두 미발견. body 폴백');
        await simulateDrop(document.body, file);
        result = { method: 'body-fallback' };
      }
    }

    // 1단계: % 진행률 표시기가 끝날 때까지 대기 (Flow 가 업로드 진행 중 "N%" 를 렌더링)
    var pctOk = await waitForUploadProgressComplete(60000);
    if (pctOk) {
      console.log('[ToolB] 업로드 진행률 완료');
    } else {
      console.warn('[ToolB] 진행률 지표 60s 타임아웃 — 계속 진행');
    }

    // 2단계: 라이브러리 타일이 등장할 때까지 대기
    var waitRes = await waitForLibraryTileIncrease(baselineTiles, 30000);
    if (waitRes.ok) {
      console.log('[ToolB] 업로드 반영 확인 — 타일 ' + baselineTiles + ' → ' + waitRes.count);
      // Flow 의 검색 인덱스 안정화 (피커가 바로 찾게). 실제 매칭은 __toolbTypePrompt 에서 재시도 루프로 보장.
      await sleep(800);
    } else {
      console.warn('[ToolB] 업로드 타일 미감지 (30s 타임아웃). 라이브러리 뷰가 없거나 업로드가 실패했을 수 있음. 진행은 계속함.');
      await sleep(800);
    }

    result.tilesBefore = baselineTiles;
    result.tilesAfter = waitRes.count;
    return result;
  }

  window.addEventListener('message', async function (evt) {
    // v1.4.9 sentinel: 재로드로 교체된 구 인스턴스라면 즉시 탈출
    if (window.__toolbDropHandlerToken !== MY_DROP_TOKEN) return;
    if (!evt.data || evt.data.__toolb !== 'DROP_CHAR') return;
    try {
      var result = await attachCharacterImage(evt.data.imageData, evt.data.fileName);
      window.postMessage({
        __toolb: 'DROP_CHAR_RESULT',
        success: true,
        method: result && result.method
      }, '*');
    } catch (err) {
      console.warn('[ToolB] 첨부 실패:', err && err.message);
      window.postMessage({
        __toolb: 'DROP_CHAR_RESULT',
        success: false,
        error: err && err.message || String(err)
      }, '*');
    }
  });

  /* ── Flow 생성 진행률 감시 ───────────────────── */
  var lastGenProgress = '';
  var genProgressObserver = new MutationObserver(function () {
    // v1.4.9 sentinel: 재로드로 교체된 구 인스턴스면 자기 observer 를 끊고 탈출
    if (window.__toolbDropHandlerToken !== MY_DROP_TOKEN) {
      try { genProgressObserver.disconnect(); } catch (_) { /* noop */ }
      return;
    }
    var el = document.querySelector('.sc-55ebc859-7.kAxcVK, .kAxcVK');
    if (el) {
      var text = el.textContent.trim();
      if (/^\d+%$/.test(text) && text !== lastGenProgress) {
        lastGenProgress = text;
        window.postMessage({ __toolb: 'FLOW_GEN_PROGRESS', value: text }, '*');
      }
    }
  });
  genProgressObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

  console.log('[ToolB] drop-handler 로드 완료 (MAIN world, v1.4.9)', MY_DROP_TOKEN);
})();
