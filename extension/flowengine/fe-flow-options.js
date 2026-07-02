/* ================================================================
 * flow-options.js — ISOLATED world content script (v1.6.3)
 *
 * sidepanel-ext.js 가 chrome.tabs.sendMessage({type:'APPLY_FLOW_OPTIONS', ...})
 * 를 호출하면 여기서 Flow 페이지의 UI 컨트롤을 찾아 클릭한다.
 *
 * Flow UI 는 React SPA 이고 DOM 구조가 변할 수 있으므로 best-effort
 * 로 동작한다. 실패 시 사이드패널 로그에 경고만 남기고 배치는 계속
 * 진행된다 (기존 동작 영향 없음).
 *
 * 지원하는 메시지:
 *   - TOOLB_PING               : 생존 확인
 *   - APPLY_FLOW_OPTIONS       : { model, ratio, count } 적용
 *
 * v1.6.3 변경 — 새 Flow UI (2026-06) tune 패널 대응.
 *   기존: 모델/비율/장수가 프롬프트 바 옆에 노출 → 텍스트 직접 매칭.
 *   변경: 전부 `tune` 아이콘 → 우측 슬라이드 패널("에이전트 설정") 안으로 이동.
 *     · 비율 = role="tab" 버튼 (아이콘 crop_16_9 / crop_landscape / crop_square /
 *               crop_portrait / crop_9_16)
 *     · 장수 = role="tab" 버튼 (텍스트 "1x"/"x2"/"x3"/"x4")
 *     · 섹션 = "이미지 생성 기본값" / "동영상 생성 기본값" 헤더 span.parent
 *     · 변경 후 "저장" 버튼 클릭해야 적용됨
 *   신규 경로 우선 시도, 실패 시 구 텍스트 매칭으로 폴백.
 *
 * v1.4.12 변경 — sentinel 토큰 가드. 2중 주입되는 경우 두 인스턴스가
 *   같은 APPLY_FLOW_OPTIONS 에 대해 UI 클릭을 2 번 수행하는 것을 막는다.
 * ================================================================ */

(function () {
  'use strict';

  /* ── v1.4.12 sentinel 토큰 ─────────────────── */
  var MY_FLOW_OPTIONS_TOKEN = 'flow-options-v1.4.12-' +
    Math.random().toString(36).slice(2, 10) + '-' + Date.now();
  window.__toolbFlowOptionsToken = MY_FLOW_OPTIONS_TOKEN;

  function isStaleInstance() {
    return window.__toolbFlowOptionsToken !== MY_FLOW_OPTIONS_TOKEN;
  }

  /* ── 공용 유틸 ──────────────────────────────── */
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent === null) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /** 텍스트가 일치하는 클릭 가능한 요소를 찾는다. */
  function findClickableByText(texts, root) {
    root = root || document;
    var candidates = root.querySelectorAll(
      'button, [role="button"], [role="option"], [role="menuitem"], [role="menuitemradio"], [role="tab"], label, a'
    );
    var normTargets = texts.map(function (t) { return String(t).toLowerCase().trim(); });

    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!isVisible(el)) continue;
      var txt = (el.textContent || '').toLowerCase().trim();
      // 정확 일치 또는 포함 (첫 번째 매칭 우선)
      for (var j = 0; j < normTargets.length; j++) {
        if (txt === normTargets[j]) return el;
      }
    }
    // 정확 매칭 실패 시 포함 매칭
    for (var k = 0; k < candidates.length; k++) {
      var el2 = candidates[k];
      if (!isVisible(el2)) continue;
      var txt2 = (el2.textContent || '').toLowerCase().trim();
      for (var m = 0; m < normTargets.length; m++) {
        if (txt2.indexOf(normTargets[m]) !== -1) return el2;
      }
    }
    return null;
  }

  /** 라벨 텍스트 근처의 버튼/select 를 찾는다. */
  function findControlByLabel(labelTexts) {
    var nodes = document.querySelectorAll('label, span, div, p');
    var targets = labelTexts.map(function (t) { return String(t).toLowerCase().trim(); });
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!isVisible(n)) continue;
      var txt = (n.textContent || '').toLowerCase().trim();
      if (targets.indexOf(txt) === -1) continue;

      // 같은 부모나 형제에서 클릭 가능한 요소 탐색
      var host = n.closest('label, [role="group"], fieldset, section, div') || n.parentElement;
      if (!host) continue;
      var ctrl = host.querySelector('button, [role="button"], select, [role="combobox"]');
      if (ctrl && isVisible(ctrl)) return ctrl;
    }
    return null;
  }

  function reportLog(text, level) {
    try {
      chrome.runtime.sendMessage({ type: 'LOG', text: text, level: level || 'info' }).catch(function () {});
    } catch (_) { /* noop */ }
  }

  /* ════════════════════════════════════════════
   * v1.6.3 — 신규 tune 패널 헬퍼
   * ════════════════════════════════════════════ */

  // ratio 문자열 → 머터리얼 아이콘 이름
  var RATIO_ICON = {
    '16:9': 'crop_16_9',
    '4:3':  'crop_landscape',
    '1:1':  'crop_square',
    '3:4':  'crop_portrait',
    '9:16': 'crop_9_16'
  };

  // count 입력값 정규화 ('x2', 'X2', '2', '2개', 2 → 'x2', 단 x1 은 '1x' 로 표시됨)
  function normalizeCountLabel(v) {
    var num = String(v).replace(/[^0-9]/g, '');
    if (!num) return null;
    return num === '1' ? '1x' : ('x' + num);
  }

  // v1.6.4: 합성 클릭 풀 시퀀스. tune 패널 안 모델 드롭다운/메뉴 옵션은
  // native click 만으론 안 열리는 경우가 있어 pointerdown→mousedown→pointerup→
  // mouseup→click 순으로 디스패치. (page-script.js 의 React onClick 우회와는
  // 다른 path — flow-options.js 는 ISOLATED world 라 React props 접근 불가)
  function dispatchRealClick(el) {
    if (!el) return;
    var r = el.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    var common = {
      bubbles: true, cancelable: true, composed: true, view: window,
      button: 0, buttons: 1, clientX: cx, clientY: cy
    };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'mouse' }, common))); } catch (_) {}
    el.dispatchEvent(new MouseEvent('mousedown', common));
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerType: 'mouse', buttons: 0 }, common))); } catch (_) {}
    el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, common, { buttons: 0 })));
    if (typeof el.click === 'function') el.click();
  }

  function findTuneButton() {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (!isVisible(b)) continue;
      var icon = b.querySelector('i');
      if (icon && (icon.textContent || '').trim() === 'tune') return b;
    }
    return null;
  }

  // 패널 헤더("에이전트 설정" 또는 섹션 헤더) 존재 여부
  function isPanelOpen() {
    var spans = document.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      var t = (spans[i].textContent || '').trim();
      if (t === '에이전트 설정' || t === '이미지 생성 기본값' || t === '동영상 생성 기본값') {
        if (isVisible(spans[i])) return true;
      }
    }
    return false;
  }

  async function openTunePanel() {
    if (isPanelOpen()) return true;
    var btn = findTuneButton();
    if (!btn) return false;
    btn.click();
    // 패널 슬라이드 인 대기 (최대 1.5s)
    var deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      await sleep(80);
      if (isPanelOpen()) return true;
    }
    return false;
  }

  // 헤더 텍스트로 섹션 컨테이너 찾기 (헤더 span 의 부모 div = 9개 탭 묶음)
  function findSection(headerText) {
    var spans = document.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if ((spans[i].textContent || '').trim() !== headerText) continue;
      if (!isVisible(spans[i])) continue;
      // 헤더 span 의 부모(div) 가 비율+장수 탭을 포함한 섹션 컨테이너
      var parent = spans[i].parentElement;
      if (parent && parent.querySelectorAll('button[role="tab"]').length > 0) return parent;
    }
    return null;
  }

  // 섹션 내에서 아이콘 이름이 일치하는 role="tab" 버튼 클릭
  function clickTabByIcon(section, iconName) {
    var tabs = section.querySelectorAll('button[role="tab"]');
    for (var i = 0; i < tabs.length; i++) {
      var ic = tabs[i].querySelector('i');
      if (ic && (ic.textContent || '').trim() === iconName) {
        if (tabs[i].getAttribute('aria-selected') === 'true') return { ok: true, alreadySelected: true };
        tabs[i].click();
        return { ok: true };
      }
    }
    return { ok: false, reason: 'no-tab-icon:' + iconName };
  }

  // 섹션 내에서 텍스트가 일치하는 role="tab" 버튼 클릭 (count 용)
  function clickTabByText(section, labelText) {
    var tabs = section.querySelectorAll('button[role="tab"]');
    var target = String(labelText).trim().toLowerCase();
    for (var i = 0; i < tabs.length; i++) {
      var t = (tabs[i].textContent || '').trim().toLowerCase();
      if (t === target) {
        if (tabs[i].getAttribute('aria-selected') === 'true') return { ok: true, alreadySelected: true };
        tabs[i].click();
        return { ok: true };
      }
    }
    return { ok: false, reason: 'no-tab-text:' + labelText };
  }

  // 섹션 내 모델 드롭다운 (button[aria-haspopup="menu"]) 클릭 → 메뉴 옵션 선택
  async function applyModelInSection(section, modelName) {
    if (!modelName) return { ok: true, skipped: true };

    var dd = null;
    section.querySelectorAll('button').forEach(function (b) {
      if (b.getAttribute('aria-haspopup') === 'menu' && isVisible(b)) dd = b;
    });
    if (!dd) return { ok: false, reason: 'no-model-dropdown' };

    // 이미 같은 모델이면 스킵
    var ddText = (dd.textContent || '').replace(/\s+/g, ' ').trim();
    var needle = String(modelName).trim().toLowerCase();
    if (ddText.toLowerCase().indexOf(needle) !== -1) {
      return { ok: true, alreadySelected: true };
    }

    // 드롭다운은 native click 으론 안 열림 → 풀 시퀀스 디스패치
    dispatchRealClick(dd);
    // 메뉴 열림 대기 (최대 1.5s)
    var menu = null;
    var deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      await sleep(80);
      menu = document.querySelector('[role="menu"]');
      if (menu && isVisible(menu)) break;
    }
    if (!menu) return { ok: false, reason: 'menu-not-open' };

    // 메뉴 안에서 모델명 매칭 — 리프 노드 텍스트, 그 후 클릭 가능한 상위(BUTTON/DIV[role])로 이동
    var target = null;
    var menuLeaves = menu.querySelectorAll('*');
    for (var i = 0; i < menuLeaves.length; i++) {
      var el = menuLeaves[i];
      if (el.children.length !== 0) continue;
      var t = (el.textContent || '').trim();
      if (!t) continue;
      if (t.toLowerCase().indexOf(needle) !== -1) { target = el; break; }
    }
    if (!target) {
      // 메뉴 닫고 종료
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { ok: false, reason: 'no-option:' + modelName };
    }

    // 텍스트 노드에서 클릭 핸들러 가진 상위 (보통 BUTTON) 까지 올라감
    var clickable = target;
    for (var j = 0; j < 4; j++) {
      if (!clickable.parentElement || clickable.parentElement === menu) break;
      clickable = clickable.parentElement;
      if (clickable.tagName === 'BUTTON' || clickable.getAttribute('role') === 'menuitem') break;
    }
    dispatchRealClick(clickable);
    await sleep(300);
    return { ok: true };
  }

  // 저장 버튼 클릭 — 패널 안 또는 모달의 "저장" 텍스트 버튼
  async function clickSaveButton() {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (!isVisible(b)) continue;
      var t = (b.textContent || '').trim();
      if (t === '저장' || t === 'Save') {
        b.click();
        await sleep(300);
        return true;
      }
    }
    return false;
  }

  // 신규 패널 경로로 옵션 적용. 성공 여부 + 미적용 옵션 정보 반환.
  async function applyOptionsViaPanel(opts) {
    var isVideoSection = opts.mode === 'video';
    var sectionLabel = isVideoSection ? '동영상 생성 기본값' : '이미지 생성 기본값';

    var hasRatio = !!(opts.ratio && RATIO_ICON[opts.ratio]);
    var hasCount = !!(opts.count && normalizeCountLabel(opts.count));
    var hasModel = !!opts.model;
    if (!hasRatio && !hasCount && !hasModel) return { ok: true, skipped: true };

    var opened = await openTunePanel();
    if (!opened) return { ok: false, reason: 'panel-not-open' };
    await sleep(200);

    var section = findSection(sectionLabel);
    if (!section) return { ok: false, reason: 'no-section:' + sectionLabel };

    var results = {};
    var anyApplied = false;

    if (hasRatio) {
      results.ratio = clickTabByIcon(section, RATIO_ICON[opts.ratio]);
      if (results.ratio.ok && !results.ratio.alreadySelected) anyApplied = true;
    }
    if (hasCount) {
      results.count = clickTabByText(section, normalizeCountLabel(opts.count));
      if (results.count.ok && !results.count.alreadySelected) anyApplied = true;
    }
    if (hasModel) {
      results.model = await applyModelInSection(section, opts.model);
      if (results.model.ok && !results.model.alreadySelected) anyApplied = true;
    }

    // 변경이 있으면 저장 클릭, 아니면 그냥 닫음 (Esc 로 닫힘 시도)
    if (anyApplied) {
      var saved = await clickSaveButton();
      if (!saved) {
        // 저장 못 찾으면 Esc 로 닫기
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await sleep(150);
      }
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await sleep(150);
    }

    return { ok: true, results: results, applied: anyApplied };
  }

  /* ── 모델 적용 ─────────────────────────────── */
  async function applyModel(modelName) {
    if (!modelName) return { ok: true, skipped: true };

    // 1) 모델 선택 드롭다운 오픈 시도
    var trigger = findControlByLabel(['모델', 'model']);
    if (!trigger) {
      // 텍스트에서 기존 모델명이 찾아지는 버튼
      var currentModelBtn = findClickableByText(
        ['nano banana pro', 'nano banana 2', 'imagen 4', 'imagen', 'veo'],
        document
      );
      if (currentModelBtn) trigger = currentModelBtn;
    }

    if (!trigger) {
      reportLog('[Flow 옵션] 모델 컨트롤을 찾지 못했습니다 (best-effort)', 'info');
      return { ok: false, reason: 'no-model-control' };
    }

    trigger.click();
    await sleep(300);

    // 2) 메뉴 옵션 중 원하는 모델 클릭
    var opt = findClickableByText([modelName], document);
    if (!opt) {
      // 메뉴가 안 열렸거나 이름이 다를 수 있음 — 메뉴 닫고 종료
      document.body.click();
      reportLog('[Flow 옵션] 모델 옵션을 찾지 못했습니다: ' + modelName, 'error');
      return { ok: false, reason: 'no-model-option' };
    }
    opt.click();
    await sleep(150);
    return { ok: true };
  }

  /* ── 비율 적용 ─────────────────────────────── */
  async function applyRatio(ratio) {
    if (!ratio) return { ok: true, skipped: true };

    // 비율 자체가 버튼 텍스트인 경우가 일반적
    var btn = findClickableByText([ratio], document);
    if (!btn) {
      // 라벨 기반 탐색
      var trigger = findControlByLabel(['비율', 'aspect ratio', 'ratio', '비율선택']);
      if (trigger) {
        trigger.click();
        await sleep(200);
        btn = findClickableByText([ratio], document);
      }
    }
    if (!btn) {
      reportLog('[Flow 옵션] 비율 버튼을 찾지 못했습니다: ' + ratio, 'info');
      return { ok: false, reason: 'no-ratio-btn' };
    }
    btn.click();
    await sleep(100);
    return { ok: true };
  }

  /* ── 장수 적용 ─────────────────────────────── */
  async function applyCount(count) {
    if (!count) return { ok: true, skipped: true };

    // Flow UI 는 x1/x2/x3/x4 또는 "1개/2개/3개/4개" 표기 가능
    var num = String(count).replace(/[^0-9]/g, '');
    var variants = [count, 'x' + num, num + '개', num];

    var btn = findClickableByText(variants, document);
    if (!btn) {
      var trigger = findControlByLabel(['장수', 'count', 'number of outputs', '생성 수']);
      if (trigger) {
        trigger.click();
        await sleep(200);
        btn = findClickableByText(variants, document);
      }
    }
    if (!btn) {
      reportLog('[Flow 옵션] 장수 버튼을 찾지 못했습니다: ' + count, 'info');
      return { ok: false, reason: 'no-count-btn' };
    }
    btn.click();
    await sleep(100);
    return { ok: true };
  }

  /* ── 장수 읽기 (Flow UI 현재 선택값 탐지) ───── */
  function readActiveCount() {
    var valMap = {
      'x1': 'x1', 'x2': 'x2', 'x3': 'x3', 'x4': 'x4',
      '1': 'x1', '2': 'x2', '3': 'x3', '4': 'x4',
      '1개': 'x1', '2개': 'x2', '3개': 'x3', '4개': 'x4'
    };
    var btns = document.querySelectorAll(
      'button, [role="button"], [role="option"], [role="menuitemradio"], [role="radio"]'
    );
    var matches = [];
    for (var i = 0; i < btns.length; i++) {
      var el = btns[i];
      if (!isVisible(el)) continue;
      var txt = (el.textContent || '').trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(valMap, txt)) {
        matches.push({ el: el, val: valMap[txt] });
      }
    }
    // 활성 버튼 탐지 (aria-pressed / data-state / class 기반, best-effort)
    for (var k = 0; k < matches.length; k++) {
      var m = matches[k];
      var ariaPressed = m.el.getAttribute('aria-pressed');
      var ariaChecked = m.el.getAttribute('aria-checked');
      var ariaSelected = m.el.getAttribute('aria-selected');
      var dataState = m.el.getAttribute('data-state');
      var classes = m.el.className || '';
      if (typeof classes !== 'string') classes = String(classes);
      if (ariaPressed === 'true' || ariaChecked === 'true' || ariaSelected === 'true' ||
          dataState === 'active' || dataState === 'on' || dataState === 'selected' || dataState === 'checked' ||
          /\b(active|selected|checked|is-on|is-active)\b/.test(classes)) {
        return m.val;
      }
    }
    return null; // 탐지 실패 — 사이드패널은 기존 값 유지
  }

  /* ── 메인 핸들러 ───────────────────────────── */
  async function applyOptions(opts) {
    var results = {};

    // v1.6.3+: 신규 tune 패널 경로 우선 시도 (model/ratio/count 모두 한 번에 처리, 저장 클릭 포함)
    if (opts.ratio || opts.count || opts.model) {
      var panelRes = await applyOptionsViaPanel({
        mode: opts.mode || 'image',
        ratio: opts.ratio,
        count: opts.count,
        model: opts.model
      });
      if (panelRes && panelRes.ok) {
        results.panel = panelRes;
        if (panelRes.results && panelRes.results.ratio) results.ratio = panelRes.results.ratio;
        if (panelRes.results && panelRes.results.count) results.count = panelRes.results.count;
        if (panelRes.results && panelRes.results.model) results.model = panelRes.results.model;
      } else {
        reportLog('[Flow 옵션] 신규 패널 경로 실패 (' +
          (panelRes && panelRes.reason || 'unknown') + ') → 구 경로 폴백', 'info');
        // 폴백 — 구 텍스트 매칭
        if (opts.model) results.model = await applyModel(opts.model);
        if (opts.ratio) results.ratio = await applyRatio(opts.ratio);
        if (opts.count) results.count = await applyCount(opts.count);
      }
    }

    return results;
  }

  /* ══════════════════════════════════════════════
   * VIDEO MODE 자동화 (best-effort)
   * ══════════════════════════════════════════════ */

  async function applyVideoMode() {
    // MODE: Video 토글 클릭
    var videoBtn = findClickableByText(['video', '비디오'], document);
    if (videoBtn) {
      // 이미 활성이면 스킵 (aria-pressed / active class)
      var pressed = (videoBtn.getAttribute('aria-pressed') || '') === 'true'
                 || videoBtn.classList.contains('active')
                 || videoBtn.classList.contains('selected');
      if (!pressed) {
        videoBtn.click();
        await sleep(400);
      }
      return { ok: true };
    }
    reportLog('[Video] MODE: Video 버튼 미발견', 'info');
    return { ok: false, reason: 'no-video-mode-btn' };
  }

  async function applyVideoModel(model) {
    if (!model) return { ok: true, skipped: true };

    var trigger = findControlByLabel(['video model', '비디오 모델']);
    if (!trigger) {
      // 현재 선택된 모델명으로 직접 탐색
      trigger = findClickableByText(['veo 3 — lite', 'veo 3.1 — fast', 'veo 3.1 — quality', 'veo 3 - lite', 'veo 3.1 - fast', 'veo 3.1 - quality', 'veo'], document);
    }
    if (!trigger) {
      reportLog('[Video] 모델 컨트롤 미발견', 'info');
      return { ok: false, reason: 'no-video-model' };
    }
    trigger.click();
    await sleep(400);

    var opt = findClickableByText([model, model.replace(' — ', ' - '), model.replace(' - ', ' — ')], document);
    if (!opt) {
      document.body.click();
      reportLog('[Video] 모델 옵션 미발견: ' + model, 'error');
      return { ok: false, reason: 'no-video-model-opt' };
    }
    opt.click();
    await sleep(200);
    return { ok: true };
  }

  async function applyAspectRatio(ratio) {
    if (!ratio) return { ok: true, skipped: true };
    var label = ratio === 'landscape' ? ['landscape', '가로'] : ['portrait', '세로'];
    var btn = findClickableByText(label, document);
    if (!btn) {
      reportLog('[Video] Aspect Ratio 버튼 미발견: ' + ratio, 'info');
      return { ok: false, reason: 'no-aspect-btn' };
    }
    btn.click();
    await sleep(200);
    return { ok: true };
  }

  async function applyVideoSubMode(subMode) {
    if (!subMode) return { ok: true, skipped: true };
    var labels = {
      text:  ['text'],
      start: ['start'],
      se:    ['s+e', 's + e', 'start + end'],
      ref:   ['ref', 'reference', 'references']
    };
    var targets = labels[subMode] || [subMode];
    var btn = findClickableByText(targets, document);
    if (!btn) {
      reportLog('[Video] Video Mode 버튼 미발견: ' + subMode, 'info');
      return { ok: false, reason: 'no-video-submode' };
    }
    btn.click();
    await sleep(200);
    return { ok: true };
  }

  async function applyVideoOptions(opts) {
    var results = {};
    results.mode        = await applyVideoMode();
    results.model       = await applyVideoModel(opts.model);
    results.aspectRatio = await applyAspectRatio(opts.aspectRatio);
    if (opts.count)     results.count = await applyCount(opts.count);
    if (opts.subMode)   results.subMode = await applyVideoSubMode(opts.subMode);
    return results;
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    // v1.4.12: 구 인스턴스는 토큰 불일치로 즉시 탈출.
    if (isStaleInstance()) return false;

    if (!message || !message.type) return false;

    if (message.type === 'TOOLB_PING') {
      sendResponse({ ok: true, url: location.href, t: Date.now(), token: MY_FLOW_OPTIONS_TOKEN });
      return false;
    }

    if (message.type === 'READ_FLOW_OPTIONS') {
      try {
        var count = readActiveCount();
        sendResponse({ ok: true, count: count });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message || e) });
      }
      return false;
    }

    if (message.type === 'APPLY_FLOW_OPTIONS') {
      applyOptions({
        model: message.model,
        ratio: message.ratio,
        count: message.count
      }).then(function (result) {
        sendResponse({ ok: true, result: result });
      }).catch(function (err) {
        sendResponse({ ok: false, error: String(err && err.message || err) });
      });
      return true; // 비동기 응답 유지
    }

    if (message.type === 'APPLY_VIDEO_OPTIONS') {
      applyVideoOptions(message.options || {}).then(function (result) {
        sendResponse({ ok: true, result: result });
      }).catch(function (err) {
        sendResponse({ ok: false, error: String(err && err.message || err) });
      });
      return true;
    }

    return false;
  });

  console.log('[ToolB flow-options] Loaded (ISOLATED, v1.4.12, token: ' + MY_FLOW_OPTIONS_TOKEN + ')');
})();
