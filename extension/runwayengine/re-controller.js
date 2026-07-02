// TB MTOOL — Runway 배치 컨트롤러 (ISOLATED world).
// runwayauto 확장의 자동화 로직을 plain JS 로 이식. Seedance 2.0 i2v 전용.
//   - 앱의 'runway' 작업(이미지 dataUrl + 모션 프롬프트 + 비율)을 /poll 로 받아
//   - Custom>Video 진입 → 모델(Seedance 2.0) → 비율(9:16/16:9) → 이미지 업로드 → 프롬프트 → Generate
//   - 완성 영상(<video> src)을 회수해 앱으로 전송(type:image, source:grok) → onImported 가 씬에 배정
;(() => {
  const log = (m) => console.log('[AVS-RUNWAY]', m)
  const delay = (ms) => new Promise((r) => setTimeout(r, ms))
  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(r))
      } catch (e) {
        resolve(null)
      }
    })
  const WID = 'w-' + Math.random().toString(36).slice(2, 10)
  let busy = false
  let currentJobId = null

  function onRunwayPage() {
    return /runway(ml)?\.com/.test(location.host)
  }

  // ── 선택자/클릭 유틸 (selectors.ts 이식) ───────────────────────────────
  function isVisible(el) {
    if (!el) return false
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none'
  }
  function findByText(text, tag = '*', parent = document) {
    const lower = text.toLowerCase()
    const cands = parent.querySelectorAll(tag)
    for (const el of cands) if ((el.textContent || '').trim().toLowerCase() === lower) return el
    for (const el of cands) {
      const t = (el.textContent || '').trim().toLowerCase()
      if (t.includes(lower) && t.length < lower.length * 3) return el
    }
    return null
  }
  function findClickableAncestor(el) {
    let cur = el
    while (cur) {
      const role = cur.getAttribute && cur.getAttribute('role')
      if (cur.tagName === 'BUTTON' || cur.tagName === 'A' || cur.tagName === 'LABEL' || role === 'button' || role === 'tab' || role === 'menuitem' || role === 'option') return cur
      if (cur.onclick != null) return cur
      cur = cur.parentElement
    }
    return null
  }
  function findControl(name) {
    const text = findByText(name, 'button, a, label, [role="tab"], [role="button"], [role="menuitem"], [role="option"], div, span')
    return findClickableAncestor(text)
  }
  function findDropdownOption(target) {
    const options = document.querySelectorAll('div[role="option"], [role="option"]')
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    if (target.dataKey) for (const o of options) if (o.getAttribute('data-key') === target.dataKey && vis(o)) return o
    if (target.text) {
      const lower = target.text.toLowerCase()
      for (const o of options) {
        const t = (o.textContent || '').trim().toLowerCase()
        if (vis(o) && (t === lower || t.startsWith(lower) || t.includes(lower))) return o
      }
    }
    return null
  }
  function findPromptInput() {
    const editable = document.querySelector('[contenteditable="true"]')
    if (editable && isVisible(editable)) return editable
    const ta = document.querySelector('textarea')
    if (ta && isVisible(ta)) return ta
    return null
  }
  function findGenerateButton() {
    const g = findByText('Generate', 'button')
    if (g) return g
    for (const b of document.querySelectorAll('button')) if ((b.textContent || '').trim().toLowerCase() === 'generate') return b
    return null
  }
  function robustClick(el) {
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    const o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }
    try { el.focus() } catch (e) {}
    try {
      el.dispatchEvent(new PointerEvent('pointerover', { ...o, pointerId: 1, pointerType: 'mouse' }))
      el.dispatchEvent(new PointerEvent('pointerdown', { ...o, pointerId: 1, pointerType: 'mouse', buttons: 1 }))
      el.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }))
      el.dispatchEvent(new PointerEvent('pointerup', { ...o, pointerId: 1, pointerType: 'mouse' }))
      el.dispatchEvent(new MouseEvent('mouseup', o))
      el.dispatchEvent(new MouseEvent('click', o))
    } catch (e) {}
  }
  function keyEvent(type, key, code, keyCode, mod) {
    return new KeyboardEvent(type, { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, ...(mod || {}) })
  }

  // ── 네비게이션 (navigate.ts) ───────────────────────────────────────────
  function inVideoPanel() {
    return !!(findControl('Multi-reference') || findControl('Keyframe'))
  }
  function generateUrlForTeam() {
    const m = location.pathname.match(/\/video-tools\/teams\/([^/]+)\//)
    return m ? `${location.origin}/video-tools/teams/${m[1]}/ai-tools/generate?tool=video&mode=tools` : null
  }
  async function ensureCustomVideoPanel(timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs
    if (inVideoPanel()) return true
    let customClicked = false
    while (Date.now() < deadline) {
      const c = findControl('Custom')
      if (c) { robustClick(c); customClicked = true; break }
      await delay(300)
    }
    if (!customClicked) {
      const url = generateUrlForTeam()
      if (url) location.href = url
    }
    while (Date.now() < deadline) {
      if (inVideoPanel()) return true
      const v = findControl('Video')
      if (v) { robustClick(v); await delay(500); if (inVideoPanel()) return true }
      await delay(300)
    }
    return inVideoPanel()
  }
  async function switchVideoSubTab(name) {
    for (let i = 0; i < 15; i++) {
      const b = findControl(name)
      if (b) { robustClick(b); await delay(300); return true }
      await delay(200)
    }
    return false
  }

  // ── 모델/비율/길이 (videoSettings.ts) ──────────────────────────────────
  // 칩 탐지용 모델 이름 목록(현재 어떤 모델이든 칩을 찾기 위함)
  const MODEL_NAMES = ['Gen-4.5', 'Gen-4 Turbo', 'Gen-4', 'Characters', 'Act-Two', 'Seedance 2.0', 'Kling O3 4K', 'Kling O3 Pro', 'Kling O3 Standard', 'Kling 3.0 4K', 'Kling 3.0 Pro', 'Kling 3.0 Standard', 'Kling 3.0 Motion', 'Kling 2.6 Pro', 'Kling 2.5 Turbo Pro', 'Kling 2.5 Turbo Standard', 'Veo 3.1', 'Veo 3', 'WAN 2.6 Flash', 'WAN 2.6', 'WAN 2.2 Animate', 'HappyHorse 1.0']
  const SEEDANCE = { key: 'seedance-2', name: 'Seedance 2.0', provider: 'ByteDance' }

  function findSelectForLabel(ariaLabel) {
    const btn = document.querySelector(`button[aria-label="${ariaLabel}"]`)
    if (!btn) return null
    let p = btn
    for (let d = 0; d < 8 && p; d++) { p = p.parentElement; const sel = p && p.querySelector('select'); if (sel) return sel }
    return null
  }
  function setSelectValue(select, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    if (!setter) return false
    setter.call(select, value)
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }
  async function setSelectByLabel(ariaLabel, value) {
    const sel = findSelectForLabel(ariaLabel)
    if (!sel) { log('<select> 없음: ' + ariaLabel); return false }
    if (sel.value === value) return true
    setSelectValue(sel, value)
    await delay(300)
    return sel.value === value
  }
  async function selectAspectRatio(ratio) { return setSelectByLabel('Aspect ratio', ratio) }

  async function selectDuration(duration) {
    const chip = document.querySelector('button[aria-label="Duration"]')
    if (!chip) return false
    if ((chip.textContent || '').trim() === `${duration}s`) return true
    chip.focus(); await delay(150)
    chip.dispatchEvent(keyEvent('keydown', 'Enter', 'Enter', 13)); chip.dispatchEvent(keyEvent('keyup', 'Enter', 'Enter', 13))
    await delay(500)
    let slider = document.querySelector('[role="slider"]')
    if (!slider) {
      chip.dispatchEvent(keyEvent('keydown', 'Enter', 'Enter', 13)); chip.dispatchEvent(keyEvent('keyup', 'Enter', 'Enter', 13))
      await delay(500); slider = document.querySelector('[role="slider"]')
    }
    if (!slider) return false
    const min = parseInt(slider.getAttribute('aria-valuemin') || '4', 10)
    const max = parseInt(slider.getAttribute('aria-valuemax') || '15', 10)
    const target = Math.max(min, Math.min(max, duration))
    slider.focus(); await delay(150)
    slider.dispatchEvent(keyEvent('keydown', 'Home', 'Home', 36)); slider.dispatchEvent(keyEvent('keyup', 'Home', 'Home', 36))
    await delay(150)
    for (let i = 0; i < target - min; i++) {
      slider.dispatchEvent(keyEvent('keydown', 'ArrowRight', 'ArrowRight', 39)); slider.dispatchEvent(keyEvent('keyup', 'ArrowRight', 'ArrowRight', 39))
      await delay(50)
    }
    await delay(200)
    slider.dispatchEvent(keyEvent('keydown', 'Escape', 'Escape', 27)); slider.dispatchEvent(keyEvent('keyup', 'Escape', 'Escape', 27))
    await delay(250)
    return (document.querySelector('button[aria-label="Duration"]')?.textContent || '').trim() === `${duration}s`
  }

  function findProviderTab(name) {
    return Array.from(document.querySelectorAll('button')).find((b) => {
      const t = (b.textContent || '').trim(); const r = b.getBoundingClientRect()
      return r.width > 0 && r.width < 140 && t === name
    }) || null
  }
  async function selectModel(entry) {
    const generateBtn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Generate')
    const generateY = generateBtn ? generateBtn.getBoundingClientRect().y : 0
    const chip = Array.from(document.querySelectorAll('button')).find((b) => {
      const t = (b.textContent || '').trim(); const r = b.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return false
      if (Math.abs(r.y - generateY) > 50) return false
      return t.length < 30 && MODEL_NAMES.some((m) => t === m || t.startsWith(m))
    })
    if (!chip) { log('모델 칩 못 찾음'); return false }
    if ((chip.textContent || '').trim().startsWith(entry.name)) return true
    robustClick(chip); await delay(500)
    const tab = findProviderTab(entry.provider)
    if (tab) { robustClick(tab); await delay(500) }
    const listbox = document.querySelector('[role="listbox"]')
    if (listbox) listbox.scrollTop = 0
    for (let i = 0; i < 15; i++) {
      const opt = findDropdownOption({ dataKey: entry.key, text: entry.name })
      if (opt) { opt.scrollIntoView({ block: 'center' }); await delay(120); robustClick(opt); await delay(300); return true }
      if (listbox && i === 4) listbox.scrollTop += 200
      if (listbox && i === 8) listbox.scrollTop += 400
      await delay(180)
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return false
  }

  // ── 이미지 업로드 (imageUpload.ts) ─────────────────────────────────────
  const REMOVE_BTN_SELECTOR = 'button[aria-label^="Remove Image"], button[aria-label^="Remove IMG"], button[aria-label="Remove image"]'
  async function dataUrlToFile(dataUrl, index) {
    const res = await fetch(dataUrl); const blob = await res.blob()
    const ext = (blob.type.split('/')[1] || 'png')
    return new File([blob], `tb_${Date.now()}_${index}.${ext}`, { type: blob.type })
  }
  function findFileInputs() {
    const all = Array.from(document.querySelectorAll('input[type="file"]'))
    const imgs = all.filter((inp) => (inp.accept || '').includes('image') || inp.multiple)
    return imgs.length ? imgs : all
  }
  function assignFile(input, file) {
    const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  function countAttachedImages() { return document.querySelectorAll(REMOVE_BTN_SELECTOR).length }
  async function clearAllReferences() {
    for (let pass = 0; pass < 12; pass++) {
      const btns = Array.from(document.querySelectorAll(REMOVE_BTN_SELECTOR))
      if (!btns.length) break
      robustClick(btns[btns.length - 1]); await delay(180)
    }
  }
  async function waitForRefCount(target, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) { if (countAttachedImages() >= target) return true; await delay(120) }
    return false
  }
  async function uploadReferenceImages(dataUrls) {
    if (!dataUrls.length) return true
    await clearAllReferences(); await delay(200)
    let inputs = findFileInputs()
    if (!inputs.length) {
      const refsBtn = findControl('References')
      if (refsBtn) { robustClick(refsBtn); await delay(400) }
      inputs = findFileInputs()
    }
    if (!inputs.length) { log('파일 input 없음'); return false }
    const files = await Promise.all(dataUrls.map((d, i) => dataUrlToFile(d, i)))
    const multiInput = inputs.find((i) => i.multiple)
    if (multiInput) {
      for (let i = 0; i < files.length; i++) { assignFile(multiInput, files[i]); if (!(await waitForRefCount(i + 1, 60000))) break }
    } else {
      const slots = inputs; const expected = Math.min(files.length, slots.length)
      for (let i = 0; i < expected; i++) { assignFile(slots[i], files[i]); await delay(250) }
    }
    return await waitForRefCount(dataUrls.length, 60000)
  }

  // ── 프롬프트 입력 (promptInput.ts) ─────────────────────────────────────
  async function robustClear(input) {
    if (input.tagName === 'TEXTAREA') { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); return true }
    const isEmpty = () => (input.textContent || '').trim().length === 0
    const mod = navigator.platform.includes('Mac') ? { metaKey: true } : { ctrlKey: true }
    for (let attempt = 0; attempt < 4; attempt++) {
      input.focus(); await delay(50)
      input.dispatchEvent(keyEvent('keydown', 'a', 'KeyA', 65, mod)); await delay(60)
      const sel = window.getSelection(); sel && sel.removeAllRanges()
      try { sel && sel.selectAllChildren(input) } catch (e) { const r = document.createRange(); r.selectNodeContents(input); sel && sel.addRange(r) }
      await delay(40)
      input.dispatchEvent(keyEvent('keydown', 'Backspace', 'Backspace', 8))
      document.execCommand('delete', false)
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }))
      await delay(100)
      if (isEmpty()) return true
    }
    return isEmpty()
  }
  function insertText(input, text) {
    if (input.tagName === 'TEXTAREA') { input.value = (input.value || '') + text; input.dispatchEvent(new Event('input', { bubbles: true })); return }
    input.focus()
    const sel = window.getSelection()
    if (sel) { const r = document.createRange(); r.selectNodeContents(input); r.collapse(false); sel.removeAllRanges(); sel.addRange(r) }
    try { document.execCommand('insertText', false, text) } catch (e) {
      const node = document.createTextNode(text); input.appendChild(node)
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
    }
  }
  async function typePromptText(text) {
    const input = findPromptInput()
    if (!input) { log('프롬프트 input 없음'); return false }
    await robustClear(input); await delay(60)
    if (input.tagName !== 'TEXTAREA') {
      input.focus(); const sel = window.getSelection(); const r = document.createRange(); r.selectNodeContents(input); r.collapse(true); sel && sel.removeAllRanges(); sel && sel.addRange(r)
    }
    insertText(input, text); await delay(150)
    const got = (input.tagName === 'TEXTAREA' ? input.value : input.textContent || '').trim()
    if (!got.startsWith(text.trim().slice(0, 24))) { await robustClear(input); await delay(60); insertText(input, text); await delay(150) }
    return true
  }
  async function clickGenerate() {
    for (let i = 0; i < 30; i++) {
      const btn = findGenerateButton()
      if (btn) {
        const cs = getComputedStyle(btn)
        const clickable = !btn.hasAttribute('disabled') && btn.getAttribute('aria-disabled') !== 'true' && cs.pointerEvents !== 'none' && parseFloat(cs.opacity || '1') > 0.4
        if (clickable) { robustClick(btn); log('Generate 클릭'); return true }
      }
      await delay(300)
    }
    return false
  }

  // ── 결과 회수 (resultCapture.ts) ───────────────────────────────────────
  function snapshotVideoUrls() {
    const urls = new Set()
    document.querySelectorAll('video').forEach((v) => { if (v.src) urls.add(v.src); const s = v.querySelector('source'); if (s && s.src) urls.add(s.src) })
    return urls
  }
  function getProgressPercent() {
    for (const prefix of ['percentage-', 'progressText-', 'progress-']) {
      const el = document.querySelector(`[class*="${prefix}"]`); const t = el && el.textContent && el.textContent.trim()
      if (t) { const m = t.match(/(\d+)\s*%/); if (m) return parseInt(m[1], 10) }
    }
    for (const el of document.querySelectorAll('span, div, p')) {
      if (el.children.length > 0) continue
      const t = (el.textContent || '').trim()
      if (!/^\d{1,3}\s*%$/.test(t)) continue
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue
      return parseInt(t, 10)
    }
    return null
  }
  async function waitForNewVideo(baseline, jobId, timeoutMs = 300000) {
    const deadline = Date.now() + timeoutMs
    let last = -1
    while (Date.now() < deadline) {
      const pct = getProgressPercent()
      if (pct !== null && pct !== last) { last = pct; send({ type: 'job-status', id: jobId, status: 'progress', message: '생성 중 ' + pct + '%' }) }
      for (const v of document.querySelectorAll('video')) {
        const src = v.src || (v.querySelector('source') && v.querySelector('source').src)
        if (src && !baseline.has(src) && v.readyState >= 2) { await delay(500); return src }
      }
      await delay(800)
    }
    return null
  }
  function blobToDataUrl(blob) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob) })
  }

  // ── 작업 처리 ──────────────────────────────────────────────────────────
  const RATIOS = { '9:16': '9:16', '16:9': '16:9' }
  async function runJob(job) {
    busy = true; currentJobId = job.id
    const report = (m) => send({ type: 'job-status', id: job.id, status: 'progress', message: m })
    try {
      const imageDataUrl = job.imageDataUrl
      const prompt = job.prompt || ''
      const aspect = RATIOS[job.aspect] || '9:16'
      const duration = Math.max(4, Math.min(15, parseInt(job.duration || '5', 10)))

      report('Runway Video 패널 진입…')
      if (!(await ensureCustomVideoPanel())) throw new Error('Custom>Video 패널 진입 실패 (로그인/페이지 확인)')
      await switchVideoSubTab('Multi-reference')
      await delay(400)
      report('Seedance 2.0 선택…')
      await selectModel(SEEDANCE)
      await delay(400)
      await selectAspectRatio(aspect)
      await selectDuration(duration)
      if (imageDataUrl) { report('이미지 업로드…'); await uploadReferenceImages([imageDataUrl]) }
      report('프롬프트 입력…')
      await typePromptText(prompt)
      await delay(300)
      const baseline = snapshotVideoUrls()
      if (!(await clickGenerate())) throw new Error('Generate 클릭 실패')
      report('생성 대기 중…')
      const url = await waitForNewVideo(baseline, job.id)
      if (!url) throw new Error('영상 생성 타임아웃')
      report('영상 회수 중…')
      const blob = await (await fetch(url)).blob()
      const dataUrl = await blobToDataUrl(blob)
      await send({ type: 'image', source: 'grok', dataUrl, pageUrl: location.href })
      await send({ type: 'job-status', id: job.id, status: 'done', message: '완료' })
      log('완료: ' + job.id)
    } catch (e) {
      await send({ type: 'job-status', id: job.id, status: 'error', message: String((e && e.message) || e) })
      log('오류: ' + ((e && e.message) || e))
    } finally {
      // 봇 회피 쿨다운
      await delay(4000)
      busy = false
      currentJobId = null
    }
  }

  async function tick() {
    if (!onRunwayPage()) return
    if (busy) {
      await send({ type: 'poll', source: 'runway', worker: WID, ready: 0 })
      if (currentJobId) {
        const c = await send({ type: 'check-cancel', id: currentJobId })
        if (c && c.canceled) { busy = false; currentJobId = null; log('취소됨') }
      }
      return
    }
    const r = await send({ type: 'poll', source: 'runway', worker: WID, ready: 1 })
    const job = r && r.job
    if (!job) return
    log('작업 수신: ' + job.id)
    runJob(job).catch((e) => { send({ type: 'job-status', id: job.id, status: 'error', message: String((e && e.message) || e) }); busy = false; currentJobId = null })
  }

  setInterval(tick, 3000)
  log('TB MTOOL Runway 컨트롤러 대기 (' + location.href + ')')
})()
