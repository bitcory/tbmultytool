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

  // ── 새 Grok Imagine UI(2026-06) 대응 ──────────────────────────────────────
  // 변경점: 모드/해상도/길이/종횡비 인라인 칩이 사라지고, [업로드][동영상 만들기][설정]
  // 아이콘 버튼만 남음. 해상도(480p/720p)·길이(6s/10s)·종횡비(16:9 등)는 "설정"
  // (button[aria-label="설정"]) 클릭 시 열리는 팝오버 안으로 이동. 제출 버튼은
  // aria-label="동영상 만들기". 쿠키 동의 배너가 페이지를 덮어 클릭을 막기도 함.

  // 쿠키 동의 배너("환경 설정 센터")가 떠 있으면 닫는다.
  function dismissCookie() {
    const ok = ['모두 허용', '모두 동의', '전체 허용', 'Allow all', 'Accept all', 'Accept All', 'I Agree', '동의함', '동의']
    for (const b of qsa('button')) {
      const t = (b.innerText || '').trim()
      if (t && ok.some((a) => t === a || t.includes(a))) { b.click(); log('쿠키 배너 닫음: ' + t); return true }
    }
    return false
  }
  // 종횡비/해상도/길이가 들어있는 "설정" 팝오버를 찾는다(쿠키 등 다른 dialog 와 구분).
  function findSettings() {
    for (const el of qsa('[data-radix-popper-content-wrapper], [role="dialog"]')) {
      if (el.querySelector('button[aria-label="16:9"], button[aria-label="9:16"], button[aria-label="1:1"]')) return el
      if (/종횡비|해상도|동영상 길이|Aspect|Resolution|Duration/.test(el.innerText || '')) return el
    }
    return null
  }
  async function openSettings() {
    let p = findSettings(); if (p) return p
    const trig = qs('button[aria-label="설정"], button[aria-label="Settings"]')
    if (!trig) { log('설정 버튼 없음'); return null }
    realClick(trig)
    for (let i = 0; i < 25; i++) { await sleep(120); p = findSettings(); if (p) { await sleep(250); return p } }
    log('설정 팝오버 안 열림'); return null
  }
  const closeSettings = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  function clickPanelChip(panel, label) {
    for (const b of panel.querySelectorAll('button')) {
      const t = (b.innerText || '').trim(), al = b.getAttribute('aria-label') || ''
      if (t === label || al === label) { realClick(b); log('설정 칩: ' + label); return true }
    }
    return false
  }
  // 새 UI: 설정 팝오버를 한 번 열어 종횡비/해상도/길이를 모두 적용. 하나도 못찾으면 false → 옛 UI 폴백.
  async function applySettingsNewUI(ASPECT, RES_CHIP, DURATION) {
    const panel = await openSettings(); if (!panel) return false
    const RAT = { '16:9': ['16:9', '16∶9'], '9:16': ['9:16', '9∶16'], '1:1': ['1:1', '1∶1'], '4:3': ['4:3'], '3:4': ['3:4'] }
    const aspLabels = RAT[ASPECT] || [ASPECT]
    let any = false
    for (const l of aspLabels) { if (clickPanelChip(panel, l)) { any = true; break } }
    await sleep(150)
    if (clickPanelChip(panel, RES_CHIP)) any = true
    await sleep(150)
    if (clickPanelChip(panel, DURATION + 's')) any = true
    await sleep(150)
    closeSettings(); await sleep(150)
    return any
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
    // 새 UI: 비디오 칩이 사라지고 제출 버튼이 "동영상 만들기"로 모드를 드러냄 → 이미 비디오 모드로 간주.
    if (qs('button[aria-label="동영상 만들기"]')) { log('새 UI — 동영상 만들기 버튼 존재, 비디오 모드로 간주'); return true }
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
  // 새 UI: 제출 버튼이 type="submit" 가 아니라 aria-label="동영상 만들기" 기반. 옛 셀렉터와 OR.
  const SUBMIT_SEL = 'form button[type="submit"], button[aria-label="동영상 만들기"], button[aria-label="이미지 만들기"], button[aria-label="만들기"]'
  const submitBtn = () => qs(SUBMIT_SEL)
  async function waitSubmitReady(timeout) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const btn = submitBtn()
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') return true
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
    // 새 UI: "동영상 만들기" 우선, 옛 라벨(제출/Send) 폴백.
    const b = qs('button[aria-label="동영상 만들기"], button[aria-label="이미지 만들기"], button[aria-label="만들기"], button[aria-label="제출"], button[aria-label="Send"], button[aria-label="Submit"], button[data-testid="send-button"]')
    if (b) { realClick(b); return true }
    const c = qs('form div.absolute.right-2.bottom-0')
    if (c) { const x = c.querySelector('button'); if (x) { x.click(); return true } }
    return false
  }
  const vidSrc = (v) => v.src || (v.querySelector('source') && v.querySelector('source').src) || ''
  // 현재 페이지의 모든 video src 집합 — 제출 직전에 찍어 "이전부터 있던 영상"을 가린다.
  function videoSrcSet() {
    const set = new Set()
    for (const v of qsa('video')) { const s = vidSrc(v); if (s) set.add(s) }
    return set
  }
  // baseline 에 없던(= 이번 생성으로 새로 나타난) 결과 영상을 찾는다.
  // 새 UI 는 video id/패턴이 다를 수 있으므로 "새 src" 기준으로 고르고, 그 안에서 결과답게 보이는 걸 우선.
  function foundVideo(baseline) {
    const base = baseline || new Set()
    const cands = []
    for (const v of qsa('video')) {
      const s = vidSrc(v)
      if (!s || base.has(s) || s.startsWith('data:')) continue   // 이전부터 있던 것/포스터 제외
      if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(s)) continue    // 이미지 썸네일 제외
      cands.push({ v, s })
    }
    if (!cands.length) return null
    const pick =
      cands.find((c) => c.v.id === 'hd-video' || c.v.id === 'sd-video') ||
      cands.find((c) => /generated_video|assets\.grok|\/video/i.test(c.s)) ||
      cands[cands.length - 1]
    return pick
  }
  async function clickUpscale() {
    // 새 UI: 결과 우측에 업스케일 버튼이 직접 노출되면 메뉴 안 거치고 바로 클릭(버튼 활성까지 최대 30s 대기).
    const d0 = Date.now()
    while (Date.now() - d0 < 30000) {
      const dbtn = qs('button[aria-label="업스케일"], button[aria-label="Upscale"]')
      if (dbtn && !dbtn.hasAttribute('disabled')) { realClick(dbtn); log('업스케일(직접 버튼)'); return true }
      if (qsa('button[aria-label="추가 옵션"], button[aria-label="More options"]').length) break
      await sleep(500)
    }
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

  // 사이드바의 "Imagine" 을 눌러 새 생성 세션으로 리셋(이전 영상 잔재 제거).
  // content script 라 페이지 리로드(작업 끊김) 대신 SPA 클릭으로 깨끗한 컴포저를 얻는다.
  function findImagineLink() {
    return (
      qs('a[href="/imagine"]') ||
      qs('a[href$="/imagine"]') ||
      qs('a[href*="imagine" i]') ||
      qs('div.bg-surface-base ul li a[href*="imagine" i]') ||
      qsa('div.bg-surface-base a, [class*="sidebar"] a').find((e) => /imagine/i.test(e.getAttribute('href') || '') || (e.innerText || e.textContent || '').trim() === 'Imagine') ||
      qsa('a, button').find((e) => {
        const t = (e.innerText || e.textContent || '').trim()
        return t === 'Imagine' || t === '이미지 생성' || (e.getAttribute('aria-label') || '') === 'Imagine'
      }) ||
      null
    )
  }
  async function goFreshImagine() {
    // 새 UI: "New Generation" 버튼이 인라인 리셋 진입점 — 먼저 시도(이전 영상/대화 제거).
    const newGen = qs('button[aria-label="New Generation"], button[aria-label="새 생성"], button[aria-label="새 생성하기"]')
    if (newGen) {
      realClick(newGen)
      await sleep(1200)
    } else {
      const link = findImagineLink()
      if (link) { realClick(link); await sleep(1500) }
    }
    // 쿠키 동의 배너가 떠 있으면 닫는다(페이지를 덮어 이후 클릭을 막음).
    dismissCookie()
    // 새 컴포저(입력창) 준비 대기 — 이전 대화/영상이 사라지고 깨끗해질 때까지
    let input = getInput(), t = 0
    while (!input && t++ < 24) { await sleep(300); input = getInput() }
    return !!getInput()
  }

  // 한 개 작업 실행 → 생성 영상 {dataUrl} 또는 {url} 반환 (실패 시 throw)
  async function runJob(job, report) {
    const PROMPT = job.prompt || ''
    const IMG = job.imageDataUrl || ''
    const s = job.videoSettings || {}
    const ASPECT = s.aspect || '16:9'
    const DURATION = s.duration || '6'
    const QUALITY = s.resolution || '720p'
    const RES_CHIP = QUALITY === '720p' ? '720p' : '480p'
    if (!IMG && !PROMPT) throw new Error('이미지나 프롬프트 중 하나는 필요합니다')

    report('Grok 준비 중…')
    let input = getInput(), t = 0
    while (!input && t++ < 24) { await sleep(500); input = getInput() }
    if (!input) {
      send({ type: 'need-login', site: 'grok' })
      throw new Error('Grok 입력창 없음 — 크롬에서 grok.com 로그인 후 다시 시도하세요')
    }

    // 이전 생성 잔재 제거: 새 Imagine 세션으로 리셋 (안 그러면 2번째부터 "업로드 대기"에서 멈춤)
    report('새 생성 세션 시작…')
    await goFreshImagine()

    report('비디오 모드 선택 중…')
    if (!(await switchVideoMode())) log('주의: 비디오 칩 못찾음(계속 진행)')
    await sleep(300)

    report('종횡비/화질/길이 설정 중…')
    // 새 UI: "설정" 팝오버 안에서 일괄 적용. 하나도 못찾으면 옛 UI(인라인 칩/드롭다운) 폴백.
    if (!(await applySettingsNewUI(ASPECT, RES_CHIP, DURATION))) {
      await setAspect(ASPECT)
      await setChip(RES_CHIP)
      await setChip(DURATION + 's')
    }

    if (IMG) {
      report('이미지 업로드 중…')
      await uploadImage(IMG)
      await sleep(500)
    }

    report('프롬프트 입력 중…')
    await typePrompt(PROMPT)
    await sleep(300)

    report('업로드 완료 대기 중…')
    await waitSubmitReady(120000)
    // 제출 직전 기존 영상 src 를 baseline 으로 — 이전 결과/잔재를 새 영상으로 오인하지 않도록.
    const baseline = videoSrcSet()
    log('baseline videos: ' + baseline.size)
    if (!submitEnter()) clickSend()
    await sleep(2000)
    // Enter 가 전송 안됐으면(입력창에 글자 남아있음) 전송 버튼 클릭으로 재시도.
    if ((getInput()?.textContent || '').trim() && PROMPT) clickSend()
    report('전송됨 · 영상 생성 대기 중…')

    let res = null
    for (let i = 0; i < 240; i++) {
      await sleep(1500)
      if (i % 4 === 0) await throwIfCanceled(job.id)
      if (i > 0 && i % 16 === 0) report('영상 생성 대기 중… (' + Math.round(i * 1.5) + '초)')
      const f = foundVideo(baseline)
      // src 가 3초간 안정적으로 유지될 때만 채택(생성 도중 바뀌는 src 걸러냄).
      if (f) { const s1 = f.s; await sleep(3000); const f2 = foundVideo(baseline); if (f2 && f2.s === s1) { res = f2; break } }
    }
    if (!res) {
      log('현재 video 들: ' + JSON.stringify(qsa('video').map(vidSrc).filter(Boolean).map((s) => s.slice(0, 60))))
      throw new Error('시간 초과 — 생성 영상을 찾지 못함')
    }
    log('가져올 새 영상 src: ' + (res.s || '').slice(0, 90))

    if (QUALITY === '480p-upscale') {
      report('480p → 720p 업스케일 중…')
      // 업스케일 결과는 또 새 src 로 나타나므로, 현재(480p 포함) 전체를 baseline 으로 잡고 그 뒤 새것만 채택.
      const upBase = videoSrcSet()
      if (await clickUpscale()) { await waitUpscale(180000); await sleep(1500); const f3 = foundVideo(upBase); if (f3) { res = f3; log('업스케일 영상 src: ' + (f3.s || '').slice(0, 90)) } }
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
  const WORKER_ID = 'w-' + Math.random().toString(36).slice(2, 10) // 동시 탭 수 통제용 고유 ID
  let busy = false
  async function throwIfCanceled(jobId) {
    const r = await send({ type: 'check-cancel', id: jobId })
    if (r && r.canceled) throw new Error('정지됨 (사용자 취소)')
  }

  async function tick() {
    // 작업 중에도 heartbeat 는 계속 보내(ready=0) 앱이 동시 탭 수를 정확히 통제하게 한다.
    const r = await send({ type: 'poll', source: 'grok', worker: WORKER_ID, ready: busy ? 0 : 1 })
    if (busy) return
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

  setInterval(tick, 3000)
  log('TB MTOOL 자동화 대기 시작 (Grok)')
})()
