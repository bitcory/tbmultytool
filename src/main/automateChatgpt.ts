// ChatGPT(chatgpt.com) 이미지 생성 자동화 — chatimg 확장의 로직을 충실히 포팅.
// 우리 앱은 프롬프트 1개당 창 1개를 띄우므로, 이 스크립트는 "한 프롬프트"를 처리한다:
//   이미지모드 진입(3전략) → 비율 적용 → (I2I) 이미지 업로드 → 프롬프트 입력 → 전송
//   → 마지막 turn 의 생성 이미지(alt 기반) 회수 → __avsBridge.sendImage 로 앱에 전달.

export function chatgptGenerateScript(
  prompt: string,
  aspect = '16:9',
  referenceImages: string[] = []
): string {
  const P = JSON.stringify(prompt || '')
  const A = JSON.stringify(aspect)
  const R = JSON.stringify(referenceImages || [])
  return `(() => {
  const PROMPT = ${P};
  const ASPECT = ${A};
  const REFS = ${R};
  const log = (m) => console.log('[AVS-GEN]', m);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ── chatimg selectors / patterns ──
  const SEL = {
    promptInput: '#prompt-textarea',
    promptFallback: 'div.ProseMirror[contenteditable="true"][role="textbox"]',
    plus: '#composer-plus-btn',
    plusFallback: 'button[data-testid="composer-plus-btn"]',
    send: 'button[data-testid="send-button"]',
    stop: 'button[data-testid="stop-button"]',
    turn: '[data-testid^="conversation-turn-"]'
  };
  const PAT = {
    imageTool: ['이미지 만들기', 'Create image', 'Create an image'],
    moreSubmenu: ['더 보기', 'More'],
    genAlt: ['생성된 이미지', 'Generated image'],
    editAlt: ['편집된 이미지', 'Edited image']
  };
  // aspect → ChatGPT 사이즈 메뉴 라벨/비율
  const SIZE_MAP = {
    '1:1': { ratio: '1:1', labels: ['정사각형 1:1', 'Square 1:1'] },
    '3:4': { ratio: '3:4', labels: ['세로 3:4', 'Portrait 3:4'] },
    '4:3': { ratio: '4:3', labels: ['가로 4:3', 'Landscape 4:3'] },
    '16:9': { ratio: '16:9', labels: ['와이드스크린 16:9', 'Widescreen 16:9'] },
    '9:16': { ratio: '9:16', labels: ['스토리 9:16', 'Story 9:16'] }
  };

  const getPromptInput = () => qs(SEL.promptInput) || qs(SEL.promptFallback);
  const getPlusButton = () => qs(SEL.plus) || qs(SEL.plusFallback);
  const getSendButton = () => qs(SEL.send);
  const isStreaming = () => !!qs(SEL.stop);

  // React/Radix 호환 클릭 — pointerdown → pointerup → click
  async function clickEl(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0, pointerType: 'mouse', pointerId: 1, isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.click();
    await sleep(60);
  }
  const findByText = (sel, pats) => qsa(sel).find(e => { const t = (e.innerText || e.textContent || '').trim(); return pats.some(p => t === p || t.startsWith(p)); });

  // ── 이미지 모드 ──
  function getPlaceholder() {
    const i = getPromptInput();
    if (!i) return '';
    const inner = qs('[data-placeholder]', i);
    return (i.getAttribute('data-placeholder') || i.getAttribute('placeholder') ||
      (inner && inner.getAttribute('data-placeholder')) || '');
  }
  function isImageModeActive() {
    const ph = getPlaceholder();
    if (ph.includes('이미지 묘사 또는 편집') || ph.toLowerCase().includes('describe or edit')) return true;
    const form = qs('form');
    if (form) {
      const chip = qsa('button', form).find(b => { const a = b.getAttribute('aria-label') || ''; return a.startsWith('이미지') || a.startsWith('Image'); });
      if (chip) return true;
    }
    return false;
  }
  async function openPlusMenu() {
    const btn = getPlusButton();
    if (!btn) return false;
    if (btn.getAttribute('aria-expanded') === 'true') return true;
    await clickEl(btn);
    for (let i = 0; i < 15; i++) { await sleep(100); if (qs('[role="menu"]')) return true; }
    return !!qs('[role="menu"]');
  }
  async function activateImageTool() {
    if (isImageModeActive()) return true;
    // 전략 1: 새 채팅 홈의 "이미지 만들기" 빠른 액션
    const quick = findByText('button, [role="button"], a', PAT.imageTool);
    if (quick) {
      await clickEl(quick);
      for (let i = 0; i < 6; i++) { await sleep(250); if (isImageModeActive()) { log('이미지 모드 활성(빠른액션)'); return true; } }
    }
    // 전략 2a: + 메뉴 최상위 "이미지 만들기"
    if (await openPlusMenu()) {
      const item = qsa('[role="menuitemradio"], [role="menuitem"]').find(e => { const t = (e.innerText || '').trim(); return PAT.imageTool.some(p => t === p || t.startsWith(p)); });
      if (item) {
        await clickEl(item);
        for (let i = 0; i < 6; i++) { await sleep(250); if (isImageModeActive()) { log('이미지 모드 활성(+메뉴)'); return true; } }
      }
      // 전략 2b: "더 보기" 서브메뉴
      const more = findByText('[role="menuitem"]', PAT.moreSubmenu);
      if (more) {
        await clickEl(more);
        await sleep(400);
        const sub = qsa('[role="menuitemradio"], [role="menuitem"]').find(e => { const t = (e.innerText || '').trim(); return PAT.imageTool.some(p => t === p || t.startsWith(p)); });
        if (sub) {
          await clickEl(sub);
          for (let i = 0; i < 6; i++) { await sleep(250); if (isImageModeActive()) { log('이미지 모드 활성(더보기)'); return true; } }
        }
      }
    }
    return isImageModeActive();
  }

  // ── 비율 ──
  function findSizeBtn() {
    const form = qs('form'); if (!form) return null;
    const cands = ['자동', 'Auto', '1:1', '3:4', '4:3', '9:16', '16:9'];
    return qsa('button', form).find(b => { const t = (b.innerText || '').trim(); return cands.some(c => t === c || t.startsWith(c)); }) || null;
  }
  const isSizeMenuOpen = () => { const m = qs('[role="menu"]'); return !!m && m.querySelectorAll('[role="menuitemradio"]').length > 0; };
  async function applyImageSize() {
    const map = SIZE_MAP[ASPECT]; if (!map) return false;
    const btn = findSizeBtn(); if (!btn) { log('비율 버튼 없음'); return false; }
    if ((btn.innerText || '').trim().includes(map.ratio)) return true;
    await clickEl(btn);
    for (let i = 0; i < 15; i++) { await sleep(100); if (isSizeMenuOpen()) break; }
    if (!isSizeMenuOpen()) return false;
    const target = qsa('[role="menuitemradio"]').find(it => { const t = (it.innerText || '').trim(); return map.labels.some(l => t === l || t.includes(l)) || t.includes(map.ratio); });
    if (!target) { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return false; }
    await clickEl(target);
    for (let i = 0; i < 10; i++) { await sleep(100); const f = findSizeBtn(); if (f && (f.innerText || '').trim().includes(map.ratio)) { log('비율 ' + map.ratio + ' 적용'); return true; } }
    return false;
  }

  // ── I2I 업로드 ──
  function dataUrlToFile(d, name) { const c = d.indexOf(','); const mime = (d.slice(0, c).match(/data:([^;]+)/) || [])[1] || 'image/png'; const bin = atob(d.slice(c + 1)); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new File([a], name, { type: mime }); }
  function countThumbs() { const form = qs('form'); if (!form) return 0; return qsa('img', form).filter(im => { const s = im.src || ''; return s.startsWith('blob:') || s.startsWith('data:'); }).length; }
  async function uploadImages(urls) {
    if (!urls.length) return true;
    const fi = qsa('input[type="file"]').find(i => !i.accept || i.accept.includes('image')) || qsa('input[type="file"]')[0];
    if (!fi) { log('파일 input 없음'); return false; }
    const before = countThumbs();
    const dt = new DataTransfer();
    urls.forEach((u, i) => { const ext = u.includes('image/png') ? 'png' : u.includes('image/webp') ? 'webp' : 'jpg'; dt.items.add(dataUrlToFile(u, 'avs-i2i-' + i + '.' + ext)); });
    fi.files = dt.files;
    fi.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 80; i++) { await sleep(150); if (countThumbs() >= before + urls.length) { log('참조 ' + urls.length + '장 업로드'); return true; } }
    return false;
  }

  // ── 프롬프트 입력 ──
  function hasContent(el, text) { return (el.textContent || '').includes(text.slice(0, Math.min(20, text.length))); }
  function fireInput(el, text) {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Unidentified' }));
  }
  async function ensureSendAppears(el, text, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const b = getSendButton(); if (b && !b.disabled) return true; fireInput(el, text); await sleep(150); }
    return false;
  }
  function clearInput(el) { try { const sel = window.getSelection(); sel.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(el); sel.addRange(r); document.execCommand('delete', false); } catch (e) {} }
  async function typePrompt(text) {
    const el = getPromptInput(); if (!el) return false;
    el.focus(); await sleep(50);
    clearInput(el); await sleep(50);
    document.execCommand('insertText', false, text);
    fireInput(el, text);
    await sleep(200);
    if (hasContent(el, text) && await ensureSendAppears(el, text, 5000)) return true;
    // paste 폴백
    clearInput(el);
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    await sleep(200); fireInput(el, text);
    return await ensureSendAppears(el, text, 5000);
  }

  // ── 결과 캡처 (마지막 turn, alt 기반, blob/data 제외) ──
  function lastTurnImageUrls() {
    const turns = qsa(SEL.turn); const last = turns[turns.length - 1]; if (!last) return [];
    const out = []; const seen = new Set();
    qsa('img', last).forEach(im => {
      const alt = im.alt || '';
      const isGen = PAT.genAlt.some(p => alt.startsWith(p)) || PAT.editAlt.some(p => alt.startsWith(p));
      if (!isGen) return;
      const s = im.src || ''; if (!s || s.startsWith('blob:') || s.startsWith('data:')) return;
      const clean = s.split('#')[0]; if (seen.has(clean)) return; seen.add(clean); out.push(clean);
    });
    return out;
  }

  (async () => {
    try {
      log('ChatGPT 준비 중…');
      for (let i = 0; i < 40 && !getPromptInput(); i++) await sleep(300);
      if (!getPromptInput()) { log('실패: 입력창 없음 (로그인 확인)'); return; }

      log('이미지 모드 활성화…');
      const tool = await activateImageTool();
      if (!tool) { log('경고: 이미지 모드 활성 실패 — 일반 모드로 진행'); }

      await applyImageSize();

      if (REFS.length) { log('참조 이미지 업로드…'); await uploadImages(REFS); await sleep(1500); }

      log('프롬프트 입력 중…');
      if (!await typePrompt(PROMPT)) { log('실패: 프롬프트 입력'); return; }

      // 전송
      let send = getSendButton(), t = 0;
      while ((!send || send.disabled) && t++ < 30) { await sleep(150); send = getSendButton(); }
      if (!send || send.disabled) { log('실패: 전송 버튼 비활성'); return; }
      await clickEl(send);
      log('전송됨 · 이미지 생성 대기 중…');
      await sleep(500);

      // 응답 대기: 생성 이미지 + 스트리밍 종료 + 안정화
      let stableUrl = null, stableCount = 0;
      for (let i = 0; i < 160; i++) {
        await sleep(1500);
        if (i > 0 && i % 8 === 0) log('이미지 생성 대기 중… (' + Math.round(i * 1.5) + '초)');
        const urls = lastTurnImageUrls();
        const streaming = isStreaming();
        if (urls.length && !streaming) {
          const u = urls[urls.length - 1];
          if (u === stableUrl) { stableCount++; } else { stableUrl = u; stableCount = 0; }
          if (stableCount >= 1) break; // 두 번 연속 동일 → 안정
        } else {
          stableCount = 0;
        }
      }
      if (!stableUrl) { log('실패: 시간 초과 — 생성 이미지 없음'); return; }

      log('이미지 가져오는 중…');
      try {
        const res = await fetch(stableUrl, { credentials: 'include' });
        if (!res.ok) throw new Error('fetch ' + res.status);
        const blob = await res.blob();
        const dataUrl = await new Promise((rs, rj) => { const fr = new FileReader(); fr.onloadend = () => rs(fr.result); fr.onerror = rj; fr.readAsDataURL(blob); });
        await window.__avsBridge.sendImage({ source: 'chatgpt', dataUrl, pageUrl: location.href });
      } catch (e) {
        await window.__avsBridge.sendImage({ source: 'chatgpt', url: stableUrl, pageUrl: location.href });
      }
      log('완료');
    } catch (e) {
      log('자동화 오류: ' + ((e && e.message) || e));
    }
  })();
  return 'started';
})();`
}
