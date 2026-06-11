// TB MTOOL — Google Flow 자동화 (MAIN world).
// Flow 의 생성 버튼은 합성클릭(isTrusted)을 막아 React onClick 직접 호출이 필요한데,
// 그건 MAIN world 에서만 페이지 React props 에 접근 가능하다. 그래서 DOM 자동화는 여기서,
// chrome.runtime(앱 통신)은 ISOLATED 의 flow.js 가 맡고 window.postMessage 로 다리를 놓는다.
// (자동화 로직은 사용자의 별도 확장 TOOLB FLOW(page-script.js)의 검증된 방식을 참조해 이식.)
;(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a))
  const qs = (s, r = document) => r.querySelector(s)
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s))

  const PROMPT_SELECTORS = [
    '[role="textbox"][contenteditable="true"]',
    '[data-slate-editor="true"][contenteditable="true"]',
    '[role="textbox"]',
    'textarea'
  ]
  function findEditor() {
    for (const s of PROMPT_SELECTORS) { const el = qs(s); if (el) return el }
    return null
  }
  function isVisible(el) {
    if (!el) return false
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') return false
    return !el.disabled // offsetParent 는 position:fixed 요소에서 null 이라 판단에 쓰지 않음
  }

  // Flow 생성(send) 버튼: arrow_forward 아이콘 + "만들기" 우선, 없으면 arrow_forward 단독(하단 우선).
  function findGenerateBtn() {
    const btns = qsa('button')
    const arrows = []
    for (const b of btns) {
      if (b.disabled || b.getAttribute('aria-disabled') === 'true' || !isVisible(b)) continue
      const icon = b.querySelector('i')
      const iconText = icon ? (icon.textContent || '').trim() : ''
      const btnText = (b.textContent || '').trim()
      if (iconText === 'arrow_forward' && btnText.indexOf('만들기') !== -1) return b
      if (iconText === 'arrow_forward') arrows.push(b)
    }
    return arrows.length ? arrows[arrows.length - 1] : null
  }

  // Flow 는 isTrusted 검사로 합성클릭을 무시 → React props.onClick 을 직접 호출(우회).
  function dispatchRealClick(el) {
    if (!el) return
    let rk = null
    for (const k of Object.keys(el)) { if (k.indexOf('__reactProps') === 0) { rk = k; break } }
    if (rk) {
      const props = el[rk]
      if (props && typeof props.onClick === 'function') {
        const fake = {
          type: 'click', target: el, currentTarget: el, bubbles: true, cancelable: true,
          isTrusted: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true },
          stopPropagation() {}, stopImmediatePropagation() {},
          nativeEvent: { isTrusted: true, type: 'click' }, button: 0, buttons: 0
        }
        try { props.onClick(fake); return } catch (_) {}
      }
    }
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const common = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, clientX: cx, clientY: cy }
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'mouse' }, common))) } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', common)) } catch (_) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerType: 'mouse', buttons: 0 }, common))) } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, common, { buttons: 0 }))) } catch (_) {}
    try { el.click() } catch (_) {}
  }

  async function clearEditor() {
    const el = findEditor()
    if (!el) return false
    el.focus(); try { el.click() } catch (_) {}
    await sleep(rand(200, 400))
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, ctrlKey: true, bubbles: true, cancelable: true }))
    await sleep(150)
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, ctrlKey: true, bubbles: true }))
    await sleep(rand(100, 250))
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true }))
    await sleep(150)
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true }))
    await sleep(rand(200, 400))
    if ((el.textContent || '').trim().length > 0) {
      try { el.focus(); const sel = window.getSelection(); sel.removeAllRanges(); sel.selectAllChildren(el); await sleep(40); document.execCommand('delete', false, null); await sleep(100) } catch (_) {}
    }
    return true
  }

  async function typeSlateChars(el, text) {
    el.focus(); try { el.click() } catch (_) {}
    await sleep(rand(150, 300))
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i)
      const kc = ch.charCodeAt(0)
      const code = /^[a-zA-Z]$/.test(ch) ? 'Key' + ch.toUpperCase() : /^[0-9]$/.test(ch) ? 'Digit' + ch : ''
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, code, keyCode: kc, which: kc, bubbles: true, cancelable: true }))
      el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ch, bubbles: true, cancelable: true, composed: true }))
      el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ch, bubbles: true, composed: true }))
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, code, keyCode: kc, which: kc, bubbles: true }))
      await sleep(10 + Math.floor(Math.random() * 15))
    }
    await sleep(rand(200, 500))
  }

  async function setPromptText(text) {
    const el = findEditor()
    if (!el) throw new Error('프롬프트 입력칸을 찾을 수 없습니다')
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const proto = el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set
      if (setter) setter.call(el, text); else el.value = text
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    await typeSlateChars(el, text)
    const probe = text.substring(0, Math.min(20, text.length))
    if ((el.textContent || '').indexOf(probe) === -1) {
      try { el.focus(); const sel = window.getSelection(); sel.removeAllRanges(); sel.selectAllChildren(el); await sleep(40) } catch (_) {}
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: text }))
      await sleep(120)
      if ((el.textContent || '').indexOf(probe) === -1) {
        el.focus()
        try { document.execCommand('selectAll', false, null) } catch (_) {}
        await sleep(30)
        try { document.execCommand('insertText', false, text) } catch (_) {}
        await sleep(100)
      }
    }
    return true
  }

  async function clickGenerate(isCanceled) {
    const deadline = Date.now() + 90000
    let btn = null
    while (Date.now() < deadline) {
      if (isCanceled()) throw new Error('취소됨')
      btn = findGenerateBtn()
      if (btn) break
      await sleep(300)
    }
    if (!btn) throw new Error('생성 버튼을 찾을 수 없습니다 (90초 대기)')
    dispatchRealClick(btn)
    return true
  }

  // ── 타일(생성 결과) 추적 ───────────────────────────────────────────────
  function getCurrentTileIds() {
    const ids = new Set()
    qsa('div[data-tile-id]').forEach((d) => ids.add(d.dataset.tileId))
    return ids
  }
  function getTileInfo(tileId) {
    const divs = qsa('div[data-tile-id="' + tileId + '"]')
    const pick = (d) => {
      const img = d.querySelector('img')
      const m = (d.textContent || '').match(/(\d{1,3})%/)
      const hasImg = !!(img && img.src && img.src.indexOf('labs.google') !== -1)
      return { found: true, hasImg, imgSrc: hasImg ? img.src : null, pct: m ? parseInt(m[1], 10) : -1 }
    }
    for (const d of divs) { if (d.children.length <= 1) return pick(d) }
    if (divs.length) return pick(divs[0])
    return { found: false }
  }
  // 새 타일이 이미지로 완료(퍼센트 사라지고 img 존재)되어 ~2초 안정되면 그 src 반환.
  async function waitForNewImage(knownIds, isCanceled, report) {
    const deadline = Date.now() + 180000
    let stableSrc = null, stableSince = 0, lastLog = 0
    while (Date.now() < deadline) {
      if (isCanceled()) throw new Error('취소됨')
      let candidate = null
      getCurrentTileIds().forEach((id) => {
        if (knownIds.has(id)) return
        const info = getTileInfo(id)
        if (info.found && info.hasImg && info.pct < 0) candidate = info.imgSrc
      })
      if (candidate) {
        if (candidate === stableSrc) { if (Date.now() - stableSince >= 2000) return candidate }
        else { stableSrc = candidate; stableSince = Date.now() }
      } else { stableSrc = null; stableSince = 0 }
      if (Date.now() - lastLog > 8000) { report('이미지 생성 대기 중…'); lastLog = Date.now() }
      await sleep(800)
    }
    throw new Error('시간 초과 — 생성 이미지 없음')
  }

  // ── 프로젝트 진입 + 에이전트 모드 OFF ──────────────────────────────────
  // "새 프로젝트" 요소(버튼/링크/타일 오버레이 포함) — 텍스트 기준으로 폭넓게 찾고 클릭 대상으로 상승.
  function findNewProjectEl() {
    const cands = qsa('button,a,[role="button"],div,span,p').filter((e) => {
      const t = (e.textContent || '').replace(/\s+/g, ' ').trim()
      return t.indexOf('새 프로젝트') !== -1 && t.length < 16 && isVisible(e)
    })
    if (!cands.length) return null
    return cands[0].closest('button,a,[role="button"]') || cands[0]
  }
  // 프로젝트 진입 여부는 URL 로 판정 (랜딩의 엉뚱한 textbox 를 에디터로 오인하는 문제 회피).
  function inFlowProject() { return location.href.indexOf('/project/') !== -1 }
  function findAgentToggle() {
    // span 뿐 아니라 button/role/div 도 본다. 텍스트가 정확히 "에이전트"인 말단 요소 우선.
    const cands = qsa('button,[role="button"],[role="switch"],span,div,p').filter((e) => (e.textContent || '').trim() === '에이전트' && isVisible(e))
    if (!cands.length) return null
    cands.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)
    const label = cands[0]
    let el = label
    for (let i = 0; i < 6 && el; i++) {
      if (el.tagName === 'BUTTON' || (el.getAttribute && (el.getAttribute('role') === 'button' || el.getAttribute('role') === 'switch' || el.hasAttribute('aria-checked') || el.hasAttribute('aria-pressed') || el.hasAttribute('data-state')))) return { el, label }
      el = el.parentElement
    }
    return { el: label.parentElement || label, label }
  }
  function agentIsOn(t) {
    if (!t || !t.el) return null
    const el = t.el
    const ac = el.getAttribute && el.getAttribute('aria-checked'); if (ac != null) return ac === 'true'
    const ap = el.getAttribute && el.getAttribute('aria-pressed'); if (ap != null) return ap === 'true'
    const ds = el.getAttribute && el.getAttribute('data-state'); if (ds != null) return ds === 'checked' || ds === 'on' || ds === 'active' || ds === 'selected'
    return null
  }
  function fullPointerSeq(el) {
    const r = el.getBoundingClientRect()
    const o = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
    const ev = (Ctor, type, extra) => { try { el.dispatchEvent(new Ctor(type, Object.assign({}, o, extra))) } catch (_) {} }
    ev(PointerEvent, 'pointerover', { pointerType: 'mouse' }); ev(MouseEvent, 'mouseover')
    ev(PointerEvent, 'pointerdown', { pointerType: 'mouse' }); ev(MouseEvent, 'mousedown')
    ev(PointerEvent, 'pointerup', { pointerType: 'mouse', buttons: 0 }); ev(MouseEvent, 'mouseup', { buttons: 0 })
    ev(MouseEvent, 'click', { buttons: 0 })
  }
  // 새 프로젝트 진입: 여러 클릭 방식을 순차 시도하고 URL 이 /project/ 로 바뀌는지 확인.
  async function clickNewProject(isCanceled) {
    const tryStrat = async (fn) => {
      const el = findNewProjectEl()
      if (!el) { await sleep(500); return false }
      try { fn(el) } catch (_) {}
      const dl = Date.now() + 4000
      while (Date.now() < dl && !inFlowProject()) { if (isCanceled()) throw new Error('취소됨'); await sleep(300) }
      return inFlowProject()
    }
    if (await tryStrat((el) => el.click())) return true
    if (await tryStrat((el) => fullPointerSeq(el))) return true
    if (await tryStrat((el) => { const ov = el.querySelector('[data-type="button-overlay"]') || el; ov.click(); fullPointerSeq(ov) })) return true
    if (await tryStrat((el) => dispatchRealClick(el))) return true
    return inFlowProject()
  }

  async function prepareProject(isCanceled, report) {
    let enteredNew = false
    if (!inFlowProject()) {
      report('새 프로젝트 진입…')
      enteredNew = await clickNewProject(isCanceled)
      if (!enteredNew) report('경고: 새 프로젝트 진입 실패 — Flow 화면에서 프로젝트를 직접 열어주세요')
      const dl2 = Date.now() + 12000
      while (Date.now() < dl2 && !findEditor()) { if (isCanceled()) throw new Error('취소됨'); await sleep(300) }
      await sleep(800)
    }
    // 에이전트 모드 OFF — 상태 판별 가능하면 켜진 경우만, 새 프로젝트 직후면 기본 ON 가정해 1회.
    // 에이전트 모드 OFF — 새 프로젝트는 기본 ON. 토글이 렌더될 때까지 잠시 대기(타이밍) 후 클릭.
    let t = null
    for (let i = 0; i < 16 && !t; i++) { t = findAgentToggle(); if (!t) await sleep(500) }
    if (t) {
      const on = agentIsOn(t)
      if (on === false) { report('에이전트 모드 이미 꺼짐') }
      else {
        report('에이전트 모드 끄기…')
        dispatchRealClick(t.el) // 한 번만(토글이므로 더블클릭 금지)
        await sleep(700)
      }
    } else {
      report('에이전트 토글 못 찾음 — 수동으로 꺼주세요')
    }
  }

  // ── 화면비율/장수 설정 + 참조이미지(i2i) 첨부 ─────────────────────────
  // (앱의 기존 automateFlow.ts CDP 로직을 MAIN world dispatchRealClick 로 이식)
  const ASPECT_ICON = { '16:9': 'crop_16_9', '9:16': 'crop_9_16', '1:1': 'crop_square', '4:3': 'crop_landscape', '3:4': 'crop_portrait' }
  function findBtnByIcon(iconText) {
    return qsa('button').find((b) => { const i = b.querySelector('i'); return i && (i.textContent || '').trim() === iconText && isVisible(b) }) || null
  }
  function findBtnByText(text, exact) {
    return qsa('button').find((b) => { const t = (b.textContent || '').trim(); return isVisible(b) && (exact === false ? t.indexOf(text) === 0 : t === text) }) || null
  }
  const nfc = (s) => { try { return s.normalize('NFC') } catch (_) { return s } }
  async function base64ToFile(dataUrl, fileName) {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    return new File([blob], fileName, { type: blob.type })
  }
  function findFileInput() {
    const inputs = qsa('input[type="file"]')
    for (const inp of inputs) { const acc = (inp.accept || '').toLowerCase(); if (acc.includes('image') || acc === '' || acc === '*/*') return inp }
    return inputs[0] || null
  }
  function findUploadTrigger() {
    const keywords = ['업로드', 'upload', '이미지', 'image', '추가', 'add', '에셋', 'asset', '첨부']
    for (const el of qsa('button, [role="button"], [aria-label]')) {
      if (el.offsetParent === null) continue
      const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase()
      if (keywords.some((k) => text.indexOf(k) !== -1)) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.width < 200 && r.height < 100) return el
      }
    }
    return null
  }
  function findDropZone() {
    const sels = ['[class*="dropZone"]', '[class*="drop-zone"]', '[class*="DropZone"]', '[class*="upload-area"]', '[class*="uploadArea"]', '[class*="Dropzone"]', '[data-dropzone]', '[aria-label*="drop" i]', '[aria-label*="upload" i]']
    for (const s of sels) { const el = qs(s); if (el && el.offsetParent !== null) return el }
    return null
  }
  async function simulateDrop(target, file) {
    const dt = new DataTransfer(); dt.items.add(file)
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt })); await sleep(60)
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); await sleep(60)
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  }
  function injectIntoFileInput(fileInput, file) {
    const dt = new DataTransfer(); dt.items.add(file)
    try { Object.defineProperty(fileInput, 'files', { value: dt.files, configurable: true }) } catch (e) { fileInput.files = dt.files }
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    fileInput.dispatchEvent(new Event('input', { bubbles: true }))
  }
  async function waitForLibraryTileIncrease(baseline, maxMs) {
    const deadline = Date.now() + (maxMs || 30000)
    while (Date.now() < deadline) { const cur = qsa('[data-tile-id]').length; if (cur > baseline) return { ok: true, count: cur }; await sleep(400) }
    return { ok: false, count: qsa('[data-tile-id]').length }
  }
  async function waitForUploadProgressComplete(maxMs) {
    const deadline = Date.now() + (maxMs || 60000)
    const pctRe = /^\s*\d{1,3}\s*%\s*$/
    let seenAny = false
    const findPct = () => qsa('div, span').filter((el) => el.children.length === 0 && el.offsetParent !== null && pctRe.test(el.textContent || ''))
    while (Date.now() < deadline) {
      const els = findPct()
      if (els.length === 0) { if (seenAny) return true; await sleep(300); if (findPct().length === 0) return true; continue }
      seenAny = true
      if (els.every((e) => (e.textContent || '').trim() === '100%')) { await sleep(300); return true }
      await sleep(400)
    }
    return false
  }
  // dataURL → Flow 소재 라이브러리 업로드 (진행률·타일 증가 폴링).
  async function uploadImageToLibrary(dataUrl, name) {
    const file = await base64ToFile(dataUrl, nfc(name))
    const baseline = qsa('[data-tile-id]').length
    let fi = findFileInput()
    if (fi) injectIntoFileInput(fi, file)
    else {
      const trigger = findUploadTrigger()
      if (trigger) { trigger.click(); await sleep(700); fi = findFileInput(); if (fi) injectIntoFileInput(fi, file) }
      if (!fi) { const dz = findDropZone(); if (dz) await simulateDrop(dz, file); else await simulateDrop(document.body, file) }
    }
    await waitForUploadProgressComplete(60000)
    await waitForLibraryTileIncrease(baseline, 30000)
    await sleep(800)
  }
  // 이름으로 소재 피커에서 골라 프롬프트에 첨부 ("프롬프트에 추가" 버튼 = v1.6.x 새 UI 필수).
  async function attachByName(name) {
    let addBtn = null
    for (const b of qsa('button[aria-haspopup="dialog"]')) {
      if (!isVisible(b)) continue
      const ic = b.querySelector('i'); const t = ic ? (ic.textContent || '').trim() : ''
      if (t === 'add_2' || t === 'add' || t.indexOf('add') !== -1) { addBtn = b; break }
    }
    if (!addBtn) throw new Error('"+" 버튼 없음')
    addBtn.click(); await sleep(700)
    const dlg = qs('[role="dialog"]')
    if (!dlg) throw new Error('애셋 다이얼로그 안 열림')
    const search = dlg.querySelector('input[placeholder*="애셋"]') || dlg.querySelector('input[placeholder*="검색"]') || dlg.querySelector('input[type="text"]') || dlg.querySelector('input')
    if (!search) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); throw new Error('검색창 없음') }
    search.focus()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') && Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    if (setter) setter.call(search, name); else search.value = name
    search.dispatchEvent(new Event('input', { bubbles: true }))
    search.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(1200)
    const candidates = []
    dlg.querySelectorAll('div').forEach((d) => {
      if (!d.querySelector('img')) return
      const r = d.getBoundingClientRect()
      if (r.width < 100 || r.height < 30 || r.width > 500) return
      if (d.children.length > 6) return
      let nm = ''
      for (const le of d.querySelectorAll('div, span')) { if (le.children.length === 0) { const t = (le.textContent || '').trim(); if (t) { nm = t; break } } }
      if (!nm) nm = (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
      candidates.push({ el: d, name: nfc(nm) })
    })
    const needle = nfc(name)
    let chosen = candidates.find((c) => c.name === needle) || candidates.find((c) => c.name.indexOf(needle) !== -1 || needle.indexOf(c.name) !== -1)
    if (!chosen && candidates.length && candidates.length <= 3) chosen = candidates[0]
    if (!chosen) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300); throw new Error('검색 결과 없음: ' + name) }
    dispatchRealClick(chosen.el); await sleep(500)
    let addToPrompt = null
    const stillDlg = qs('[role="dialog"]')
    if (stillDlg) {
      for (const b of stillDlg.querySelectorAll('button')) {
        if (!isVisible(b)) continue
        const t = (b.textContent || '').trim()
        if (t === '프롬프트에 추가' || t === 'Add to prompt' || t.indexOf('프롬프트에 추가') !== -1) { addToPrompt = b; break }
      }
    }
    if (addToPrompt) {
      dispatchRealClick(addToPrompt)
      const dl = Date.now() + 2000
      while (Date.now() < dl) { await sleep(100); if (!qs('[role="dialog"]')) break }
    } else {
      await sleep(300)
      if (qs('[role="dialog"]')) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300) }
    }
    return true
  }

  // tune 패널 → (매번확인 off) → 비율 → 1장 → 저장. 패널/버튼 없으면 조용히 스킵(best-effort).
  async function setAspectAndCount(aspect, report) {
    const tunes = qsa('button').filter((b) => { const i = b.querySelector('i'); return i && (i.textContent || '').trim() === 'tune' && isVisible(b) })
    if (!tunes.length) return
    report('화면비율 설정…')
    dispatchRealClick(tunes[tunes.length - 1])
    await sleep(1200)
    const body = document.body.innerText || ''
    if (body.indexOf('이미지 생성 기본값') === -1 && body.indexOf('에이전트 설정') === -1) return
    const nc = findBtnByIcon('radio_button_unchecked'); if (nc) { dispatchRealClick(nc); await sleep(300) }
    const asp = findBtnByIcon(ASPECT_ICON[aspect] || 'crop_16_9'); if (asp) { dispatchRealClick(asp); await sleep(300) }
    const one = findBtnByText('1x'); if (one) { dispatchRealClick(one); await sleep(300) }
    const save = findBtnByText('저장'); if (save) { dispatchRealClick(save); await sleep(1000) }
  }

  // 참조이미지(i2i): 각 dataURL 을 라이브러리에 업로드 → 이름으로 피커에서 골라 프롬프트에 첨부.
  async function attachRefs(refs, isCanceled, report) {
    if (!refs || !refs.length) return
    const names = []
    for (let i = 0; i < refs.length; i++) {
      if (isCanceled()) throw new Error('취소됨')
      const name = 'avsref' + Date.now() + '_' + i
      report('참조 이미지 업로드 ' + (i + 1) + '/' + refs.length + '…')
      try { await uploadImageToLibrary(refs[i], name); names.push(name) }
      catch (e) { report('참조 ' + (i + 1) + ' 업로드 실패: ' + ((e && e.message) || e)) }
    }
    for (let i = 0; i < names.length; i++) {
      if (isCanceled()) throw new Error('취소됨')
      report('참조 첨부 ' + (i + 1) + '/' + names.length + '…')
      try { await attachByName(names[i]) }
      catch (e) { report('참조 ' + (i + 1) + ' 첨부 실패: ' + ((e && e.message) || e)) }
    }
  }

  // ── 한 작업 실행 ───────────────────────────────────────────────────────
  const canceled = new Set()
  async function runJob(job, report) {
    const isCanceled = () => canceled.has(job.id)
    report('Flow 준비 중…')
    await prepareProject(isCanceled, report)
    for (let i = 0; i < 40 && !findEditor(); i++) { if (isCanceled()) throw new Error('취소됨'); await sleep(300) }
    if (!findEditor()) throw new Error('입력칸 없음 — Flow 로그인/페이지 준비 확인')

    await setAspectAndCount(job.aspect || '16:9', report)
    if (job.referenceImages && job.referenceImages.length) await attachRefs(job.referenceImages, isCanceled, report)

    report('프롬프트 입력 중…')
    await clearEditor()
    await setPromptText(job.prompt || '')
    await sleep(rand(300, 700))
    const known = getCurrentTileIds()
    report('생성 클릭…')
    await clickGenerate(isCanceled)
    report('이미지 생성 대기 중…')
    const url = await waitForNewImage(known, isCanceled, report)
    return url // 실제 이미지 fetch 는 ISOLATED(flow.js)가 (host_permissions/쿠키) 담당
  }

  // ── ISOLATED(flow.js) 와의 postMessage 다리 ────────────────────────────
  const TAG = '__AVS_FLOW__'
  window.addEventListener('message', async (e) => {
    if (e.source !== window) return
    const d = e.data
    if (!d || d.tag !== TAG || d.dir !== 'req') return
    if (d.action === 'cancel') { canceled.add(d.id); return }
    if (d.action !== 'generate') return
    const report = (m) => window.postMessage({ tag: TAG, dir: 'progress', id: d.id, message: m }, '*')
    try {
      const url = await runJob(d.job, report)
      window.postMessage({ tag: TAG, dir: 'done', id: d.id, url }, '*')
    } catch (err) {
      window.postMessage({ tag: TAG, dir: 'error', id: d.id, message: (err && err.message) || String(err) }, '*')
    } finally {
      canceled.delete(d.id)
    }
  })

  console.log('[AVS-FLOW] MAIN world 자동화 준비 완료')
})()
