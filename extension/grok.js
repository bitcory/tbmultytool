// TB MTOOL 자동화 content script (Grok 이미지→영상 전용).
// grok.com/imagine 작업용 탭에서만 동작. 앱의 grok 작업을 폴링해 자동 생성.
// (automateGrok.ts 의 DOM 로직 이식 — Grok 은 합성 포인터 시퀀스를 받아줌)
;(() => {
  const log = (m) => console.log('[AVS-GEN]', m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const qs = (s, r = document) => { try { return r.querySelector(s) } catch { return null } }
  const qsa = (s, r = document) => { try { return [...r.querySelectorAll(s)] } catch { return [] } }

  const getInput = () => qs('div[contenteditable="true"]') || qs('textarea[placeholder]') || qs('[data-testid="prompt-textarea"]')
  const getForm = () => { const i = getInput(); return (i && i.closest('form')) || qs('form') }

  function realClick(el) {
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1 }
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o, pointerId: 1, pointerType: 'mouse' }))
    el.dispatchEvent(new MouseEvent('mousedown', o))
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, pointerId: 1, pointerType: 'mouse' }))
    el.dispatchEvent(new MouseEvent('mouseup', o))
    el.dispatchEvent(new MouseEvent('click', o))
  }
  function menuClick(el) {
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }
    el.dispatchEvent(new PointerEvent('pointerenter', { ...o, pointerId: 1, pointerType: 'mouse' }))
    el.dispatchEvent(new PointerEvent('pointermove', { ...o, pointerId: 1, pointerType: 'mouse' }))
    el.dispatchEvent(new MouseEvent('mouseover', o))
    el.focus && el.focus()
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o, buttons: 1, pointerId: 1, pointerType: 'mouse' }))
    el.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }))
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, pointerId: 1, pointerType: 'mouse' }))
    el.dispatchEvent(new MouseEvent('mouseup', o))
    el.dispatchEvent(new MouseEvent('click', o))
  }
  function dataUrlToFile(dataUrl, name) {
    const c = dataUrl.indexOf(','); const head = dataUrl.slice(0, c), b64 = dataUrl.slice(c + 1)
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png'
    const bin = atob(b64); const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return new File([arr], name + '.' + (mime.split('/')[1] || 'png'), { type: mime })
  }

  async function switchVideoMode() {
    const form = getForm(); if (!form) return false
    for (const b of form.querySelectorAll('button')) {
      const t = (b.innerText || '').trim()
      if (t === '비디오' || t.toLowerCase() === 'video') {
        b.click(); await sleep(400)
        const d = b.querySelector('div'); if (d) { d.click(); await sleep(200) }
        return true
      }
    }
    return false
  }
  const chipActive = (b) => b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-pressed') === 'true' || b.getAttribute('data-state') === 'on' || b.getAttribute('aria-selected') === 'true'
  async function setChip(label) {
    const form = getForm(); if (!form) return false
    for (const b of form.querySelectorAll('button')) {
      if ((b.innerText || '').trim() === label) {
        if (chipActive(b)) return true
        b.click(); await sleep(300); return true
      }
    }
    return false
  }
  async function setAspect(ASPECT) {
    const RAT = { '16:9': ['16:9', '16∶9'], '9:16': ['9:16', '9∶16'], '1:1': ['1:1', '1∶1'], '4:3': ['4:3'], '3:4': ['3:4'] }
    const labels = RAT[ASPECT]; if (!labels) return
    let trig = qs('button[aria-label="종횡비"], button[aria-label="Aspect ratio"]')
    if (!trig) trig = qsa('button[aria-haspopup="menu"]').find((b) => /^\d+\s*[∶:]\s*\d+$/.test((b.innerText || '').trim()))
    if (!trig) { log('종횡비 버튼 없음(스킵)'); return }
    if (labels.some((l) => (trig.innerText || '').trim() === l)) return
    realClick(trig)
    for (let i = 0; i < 30; i++) { await sleep(100); if (qs('[data-radix-menu-content]')) break }
    const item = qsa('[data-radix-menu-content] [role="menuitem"]').find((it) => labels.some((l) => (it.innerText || '').trim().includes(l)))
    if (item) { menuClick(item); await sleep(400); log('종횡비 ' + ASPECT + ' 적용') }
    else { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); log('종횡비 항목 못찾음(스킵)') }
  }
  async function uploadImage(IMG) {
    const form = getForm()
    const before = form ? form.querySelectorAll('img[src^="blob:"]').length : 0
    const fi = qs('input[type="file"][accept*="image"]') || qs('input[type="file"]')
    const file = dataUrlToFile(IMG, 'board')
    if (fi) {
      const dt = new DataTransfer(); dt.items.add(file)
      fi.files = dt.files; fi.dispatchEvent(new Event('change', { bubbles: true }))
    } else {
      const target = getInput() || form
      const dt = new DataTransfer(); dt.items.add(file)
      ;['dragenter', 'dragover', 'drop'].forEach((t) => target && target.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt })))
    }
    const start = Date.now()
    while (Date.now() - start < 8000) {
      const f = getForm()
      const imgs = f ? [...f.querySelectorAll('img[src^="blob:"]')] : []
      const loaded = imgs.filter((im) => im.complete && im.naturalWidth > 0)
      if (loaded.length >= before + 1) return true
      await sleep(150)
    }
    log('주의: 업로드 프리뷰 확인 못함(계속 진행)')
    return false
  }
  async function typePrompt(text) {
    if (!text) return true
    let input = getInput(); if (!input) return false
    input.focus(); await sleep(150)
    try { const sel = window.getSelection(); const rng = document.createRange(); rng.selectNodeContents(input); sel.removeAllRanges(); sel.addRange(rng); document.execCommand('delete', false) } catch {}
    document.execCommand('insertText', false, text); await sleep(300)
    if ((input.textContent || '').includes(text.slice(0, 10))) return true
    input = getInput(); input.focus(); input.textContent = text
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
    await sleep(200)
    return (input.textContent || '').length > 0
  }
  async function waitSubmitReady(timeout) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const btn = qs('form button[type="submit"]')
      if (btn && !btn.disabled) return true
      await sleep(100)
    }
    return false
  }
  function submitEnter() {
    const input = getInput(); if (!input) return false
    input.focus()
    const p = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }
    input.dispatchEvent(new KeyboardEvent('keydown', p))
    input.dispatchEvent(new KeyboardEvent('keypress', p))
    input.dispatchEvent(new KeyboardEvent('keyup', p))
    return true
  }
  function clickSend() {
    const c = qs('form div.absolute.right-2.bottom-0')
    if (c) { const b = c.querySelector('button'); if (b) { b.click(); return true } }
    const b = qs('button[aria-label="제출"], button[aria-label="Send"], button[aria-label="Submit"], button[data-testid="send-button"]')
    if (b) { b.click(); return true }
    return false
  }
  function foundVideo() {
    const vids = qsa('video#hd-video, video#sd-video, video[src*="generated_video"]')
    for (const v of vids) { const s = v.src || (v.querySelector('source') && v.querySelector('source').src); if (s) return { v, s } }
    return null
  }
  async function clickUpscale() {
    let more = null; const start = Date.now()
    while (Date.now() - start < 30000) {
      const byLabel = qsa('button[aria-label="추가 옵션"], button[aria-label="More options"]')
      if (byLabel.length) { more = byLabel[byLabel.length - 1]; break }
      const menuBtns = qsa('button[aria-haspopup="menu"]')
      for (let i = menuBtns.length - 1; i >= 0; i--) { if (menuBtns[i].querySelector('circle') || menuBtns[i].querySelector('.lucide-ellipsis')) { more = menuBtns[i]; break } }
      if (more) break
      await sleep(1000)
    }
    if (!more) { log('업스케일: 추가옵션 버튼 못찾음'); return false }
    for (let a = 0; a < 3; a++) { realClick(more); await sleep(700); if (qs('[data-radix-popper-content-wrapper]') || qs('[data-radix-menu-content]')) break }
    for (let a = 0; a < 6; a++) {
      const up = qsa('[role="menuitem"]').find((it) => { const t = (it.innerText || ''); return t.includes('업스케일') || t.toLowerCase().includes('upscale') })
      if (up) { menuClick(up); return true }
      await sleep(600)
    }
    document.body.click(); log('업스케일 메뉴 항목 못찾음'); return false
  }
  async function waitUpscale(timeout) {
    const start = Date.now(); let lastChange = Date.now()
    const getSrc = () => { const vs = qsa('video'); const v = vs[vs.length - 1]; return v ? (v.src || (v.querySelector('source') && v.querySelector('source').src) || '') : '' }
    const initial = getSrc()
    const obs = new MutationObserver(() => { lastChange = Date.now() })
    obs.observe(document.body, { childList: true, subtree: true, attributes: true })
    while (Date.now() - start < timeout) {
      await sleep(2000)
      const elapsed = Date.now() - start, since = Date.now() - lastChange
      const upscaling = !!qs('[class*="animate-pulse-lg"]')
      const cur = getSrc()
      if (!upscaling && elapsed > 5000 && since > 3000) { obs.disconnect(); return true }
      if (initial && cur && cur !== initial && since > 3000) { obs.disconnect(); return true }
      if (elapsed > 15000 && since > 8000) { obs.disconnect(); return true }
    }
    obs.disconnect(); return false
  }
  function blobToDataUrl(blob) { return new Promise((rs, rj) => { const fr = new FileReader(); fr.onload = () => rs(fr.result); fr.onerror = rj; fr.readAsDataURL(blob) }) }

  // 한 개 작업 실행 → 생성 영상 {dataUrl} 또는 {url} 반환 (실패 시 throw)
  async function runJob(job, report) {
    const PROMPT = job.prompt || ''
    const IMG = job.imageDataUrl || ''
    const s = job.videoSettings || {}
    const ASPECT = s.aspect || '16:9'
    const DURATION = s.duration || '6'
    const QUALITY = s.resolution || '720p'
    const RES_CHIP = QUALITY === '720p' ? '720p' : '480p'
    if (!IMG) throw new Error('입력 이미지가 없습니다')

    report('Grok 준비 중…')
    let input = getInput(), t = 0
    while (!input && t++ < 24) { await sleep(500); input = getInput() }
    if (!input) {
      send({ type: 'need-login', site: 'grok' })
      throw new Error('Grok 입력창 없음 — 크롬에서 grok.com 로그인 후 다시 시도하세요')
    }

    report('비디오 모드 선택 중…')
    if (!(await switchVideoMode())) log('주의: 비디오 칩 못찾음(계속 진행)')
    await sleep(300)

    report('종횡비/화질/길이 설정 중…')
    await setAspect(ASPECT)
    await setChip(RES_CHIP)
    await setChip(DURATION + 's')

    report('이미지 업로드 중…')
    await uploadImage(IMG)
    await sleep(500)

    report('프롬프트 입력 중…')
    await typePrompt(PROMPT)
    await sleep(300)

    report('업로드 완료 대기 중…')
    await waitSubmitReady(120000)
    if (!submitEnter()) clickSend()
    await sleep(2000)
    if (qs('form button[type="submit"]') && !qs('form button[type="submit"]').disabled) clickSend()
    report('전송됨 · 영상 생성 대기 중…')

    let res = null
    for (let i = 0; i < 240; i++) {
      await sleep(1500)
      if (i % 4 === 0) await throwIfCanceled(job.id)
      if (i > 0 && i % 16 === 0) report('영상 생성 대기 중… (' + Math.round(i * 1.5) + '초)')
      const f = foundVideo()
      if (f) { const s1 = f.s; await sleep(3000); const f2 = foundVideo(); if (f2 && f2.s === s1) { res = f2; break } }
    }
    if (!res) throw new Error('시간 초과 — 생성 영상을 찾지 못함')

    if (QUALITY === '480p-upscale') {
      report('480p → 720p 업스케일 중…')
      if (await clickUpscale()) { await waitUpscale(180000); await sleep(1500); const f3 = foundVideo(); if (f3) res = f3 }
    }

    report('영상 가져오는 중…')
    try { qsa('video').forEach((v) => { v.pause(); v.muted = true; v.loop = false }) } catch {}
    const src = res.s
    try {
      const blob = await (await fetch(src, { credentials: 'include' })).blob()
      return { dataUrl: await blobToDataUrl(blob) }
    } catch (e) {
      return { url: src } // 직접 fetch 실패 시 url 전달(background 가 시도)
    }
  }

  // ── 폴링 루프 ───────────────────────────────────────────────────────────
  const send = (msg) => new Promise((resolve) => { try { chrome.runtime.sendMessage(msg, (r) => resolve(r)) } catch (e) { resolve(null) } })
  let busy = false
  async function throwIfCanceled(jobId) {
    const r = await send({ type: 'check-cancel', id: jobId })
    if (r && r.canceled) throw new Error('정지됨 (사용자 취소)')
  }

  async function tick() {
    if (busy) return
    const r = await send({ type: 'poll', source: 'grok' })
    const job = r && r.job
    if (!job) return
    busy = true
    const report = (m) => { log(m); send({ type: 'job-status', id: job.id, status: 'progress', message: m }) }
    try {
      const out = await runJob(job, report)
      const payload = { type: 'image', source: 'grok', pageUrl: location.href }
      if (out.dataUrl) payload.dataUrl = out.dataUrl
      else payload.url = out.url
      await send(payload)
      await send({ type: 'job-status', id: job.id, status: 'done', message: '완료' })
      log('완료')
    } catch (e) {
      const m = (e && e.message) || String(e)
      await send({ type: 'job-status', id: job.id, status: 'error', message: m })
      log('오류: ' + m)
    } finally {
      const cooldown = 12000 + Math.floor(Math.random() * 13000)
      report('다음 생성까지 대기 ' + Math.round(cooldown / 1000) + '초…')
      await sleep(cooldown)
      busy = false
    }
  }

  // 작업용 탭에서만 자동화 (사용자가 직접 쓰는 Grok 탭은 건드리지 않음)
  ;(async () => {
    let isWorker = false
    for (let i = 0; i < 10; i++) {
      const r = await send({ type: 'is-worker', site: 'grok' })
      if (r && r.worker) { isWorker = true; break }
      await sleep(1000)
    }
    if (!isWorker) { log('이 탭은 Grok 작업용 탭이 아님 — 자동화 비활성'); return }
    setInterval(tick, 3000)
    log('TB MTOOL 자동화 대기 시작 (Grok 작업용 탭)')
  })()
})()
