// TB MTOOL 자동화 content script (ChatGPT 전용).
// 사용자의 진짜 크롬(=로그인된 정상 브라우저)에서 동작하므로 봇벽이 없다.
// 앱(로컬 서버)에 생성 작업을 폴링 → 받으면 ChatGPT 페이지를 자동 조작해 이미지 생성
// → 결과를 background 경유로 앱에 전달하고 완료 보고.
;(() => {
  const log = (m) => console.log('[AVS-GEN]', m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const qs = (s, r = document) => r.querySelector(s)
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s))

  const SEL = {
    promptInput: '#prompt-textarea',
    promptFallback: 'div.ProseMirror[contenteditable="true"][role="textbox"]',
    plus: '#composer-plus-btn',
    plusFallback: 'button[data-testid="composer-plus-btn"]',
    send: 'button[data-testid="send-button"]',
    stop: 'button[data-testid="stop-button"]',
    turn: '[data-testid^="conversation-turn-"]'
  }
  const PAT = {
    imageTool: ['이미지 만들기', 'Create image', 'Create an image'],
    moreSubmenu: ['더 보기', 'More'],
    genAlt: ['생성된 이미지', 'Generated image'],
    editAlt: ['편집된 이미지', 'Edited image']
  }
  const SIZE_MAP = {
    '1:1': { ratio: '1:1', labels: ['정사각형 1:1', 'Square 1:1'] },
    '3:4': { ratio: '3:4', labels: ['세로 3:4', 'Portrait 3:4'] },
    '4:3': { ratio: '4:3', labels: ['가로 4:3', 'Landscape 4:3'] },
    '16:9': { ratio: '16:9', labels: ['와이드스크린 16:9', 'Widescreen 16:9'] },
    '9:16': { ratio: '9:16', labels: ['스토리 9:16', 'Story 9:16'] }
  }

  const getPromptInput = () => qs(SEL.promptInput) || qs(SEL.promptFallback)
  const getPlusButton = () => qs(SEL.plus) || qs(SEL.plusFallback)
  const getSendButton = () => qs(SEL.send)
  const isStreaming = () => !!qs(SEL.stop)

  async function clickEl(el) {
    const r = el.getBoundingClientRect()
    const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0, pointerType: 'mouse', pointerId: 1, isPrimary: true }
    el.dispatchEvent(new PointerEvent('pointerdown', o))
    el.dispatchEvent(new PointerEvent('pointerup', o))
    el.click()
    await sleep(60)
  }
  const findByText = (sel, pats) => qsa(sel).find((e) => { const t = (e.innerText || e.textContent || '').trim(); return pats.some((p) => t === p || t.startsWith(p)) })

  function getPlaceholder() {
    const i = getPromptInput()
    if (!i) return ''
    const inner = qs('[data-placeholder]', i)
    return i.getAttribute('data-placeholder') || i.getAttribute('placeholder') || (inner && inner.getAttribute('data-placeholder')) || ''
  }
  function isImageModeActive() {
    const ph = getPlaceholder()
    if (ph.includes('이미지 묘사 또는 편집') || ph.toLowerCase().includes('describe or edit')) return true
    const form = qs('form')
    if (form) {
      const chip = qsa('button', form).find((b) => { const a = b.getAttribute('aria-label') || ''; return a.startsWith('이미지') || a.startsWith('Image') })
      if (chip) return true
    }
    return false
  }
  async function openPlusMenu() {
    const btn = getPlusButton()
    if (!btn) return false
    if (btn.getAttribute('aria-expanded') === 'true') return true
    await clickEl(btn)
    for (let i = 0; i < 15; i++) { await sleep(100); if (qs('[role="menu"]')) return true }
    return !!qs('[role="menu"]')
  }
  async function activateImageTool() {
    if (isImageModeActive()) return true
    const quick = findByText('button, [role="button"], a', PAT.imageTool)
    if (quick) {
      await clickEl(quick)
      for (let i = 0; i < 6; i++) { await sleep(250); if (isImageModeActive()) { log('이미지 모드 활성(빠른액션)'); return true } }
    }
    if (await openPlusMenu()) {
      const item = qsa('[role="menuitemradio"], [role="menuitem"]').find((e) => { const t = (e.innerText || '').trim(); return PAT.imageTool.some((p) => t === p || t.startsWith(p)) })
      if (item) {
        await clickEl(item)
        for (let i = 0; i < 6; i++) { await sleep(250); if (isImageModeActive()) { log('이미지 모드 활성(+메뉴)'); return true } }
      }
      const more = findByText('[role="menuitem"]', PAT.moreSubmenu)
      if (more) {
        await clickEl(more)
        await sleep(400)
        const sub = qsa('[role="menuitemradio"], [role="menuitem"]').find((e) => { const t = (e.innerText || '').trim(); return PAT.imageTool.some((p) => t === p || t.startsWith(p)) })
        if (sub) {
          await clickEl(sub)
          for (let i = 0; i < 6; i++) { await sleep(250); if (isImageModeActive()) { log('이미지 모드 활성(더보기)'); return true } }
        }
      }
    }
    return isImageModeActive()
  }

  function findSizeBtn() {
    const form = qs('form'); if (!form) return null
    const cands = ['자동', 'Auto', '1:1', '3:4', '4:3', '9:16', '16:9']
    return qsa('button', form).find((b) => { const t = (b.innerText || '').trim(); return cands.some((c) => t === c || t.startsWith(c)) }) || null
  }
  const isSizeMenuOpen = () => { const m = qs('[role="menu"]'); return !!m && m.querySelectorAll('[role="menuitemradio"]').length > 0 }
  async function applyImageSize(ASPECT) {
    const map = SIZE_MAP[ASPECT]; if (!map) return false
    const btn = findSizeBtn(); if (!btn) { log('비율 버튼 없음'); return false }
    if ((btn.innerText || '').trim().includes(map.ratio)) return true
    await clickEl(btn)
    for (let i = 0; i < 15; i++) { await sleep(100); if (isSizeMenuOpen()) break }
    if (!isSizeMenuOpen()) return false
    const target = qsa('[role="menuitemradio"]').find((it) => { const t = (it.innerText || '').trim(); return map.labels.some((l) => t === l || t.includes(l)) || t.includes(map.ratio) })
    if (!target) { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return false }
    await clickEl(target)
    for (let i = 0; i < 10; i++) { await sleep(100); const f = findSizeBtn(); if (f && (f.innerText || '').trim().includes(map.ratio)) { log('비율 ' + map.ratio + ' 적용'); return true } }
    return false
  }

  function dataUrlToFile(d, name) { const c = d.indexOf(','); const mime = (d.slice(0, c).match(/data:([^;]+)/) || [])[1] || 'image/png'; const bin = atob(d.slice(c + 1)); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new File([a], name, { type: mime }) }
  function countThumbs() { const form = qs('form'); if (!form) return 0; return qsa('img', form).filter((im) => { const s = im.src || ''; return s.startsWith('blob:') || s.startsWith('data:') }).length }
  async function uploadImages(urls) {
    if (!urls.length) return true
    const fi = qsa('input[type="file"]').find((i) => !i.accept || i.accept.includes('image')) || qsa('input[type="file"]')[0]
    if (!fi) { log('파일 input 없음'); return false }
    const before = countThumbs()
    const dt = new DataTransfer()
    urls.forEach((u, i) => { const ext = u.includes('image/png') ? 'png' : u.includes('image/webp') ? 'webp' : 'jpg'; dt.items.add(dataUrlToFile(u, 'avs-i2i-' + i + '.' + ext)) })
    fi.files = dt.files
    fi.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }))
    for (let i = 0; i < 80; i++) { await sleep(150); if (countThumbs() >= before + urls.length) { log('참조 ' + urls.length + '장 업로드'); return true } }
    return false
  }

  function hasContent(el, text) { return (el.textContent || '').includes(text.slice(0, Math.min(20, text.length))) }
  function fireInput(el, text) {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Unidentified' }))
  }
  async function ensureSendAppears(el, text, ms) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) { const b = getSendButton(); if (b && !b.disabled) return true; fireInput(el, text); await sleep(150) }
    return false
  }
  function clearInput(el) { try { const sel = window.getSelection(); sel.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(el); sel.addRange(r); document.execCommand('delete', false) } catch (e) {} }
  async function typePrompt(text) {
    const el = getPromptInput(); if (!el) return false
    el.focus(); await sleep(50)
    clearInput(el); await sleep(50)
    document.execCommand('insertText', false, text)
    fireInput(el, text)
    await sleep(200)
    if (hasContent(el, text) && (await ensureSendAppears(el, text, 5000))) return true
    clearInput(el)
    const dt = new DataTransfer(); dt.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    await sleep(200); fireInput(el, text)
    return await ensureSendAppears(el, text, 5000)
  }

  function lastTurnImageUrls() {
    const turns = qsa(SEL.turn); const last = turns[turns.length - 1]; if (!last) return []
    const out = []; const seen = new Set()
    qsa('img', last).forEach((im) => {
      const alt = im.alt || ''
      const isGen = PAT.genAlt.some((p) => alt.startsWith(p)) || PAT.editAlt.some((p) => alt.startsWith(p))
      if (!isGen) return
      const s = im.src || ''; if (!s || s.startsWith('blob:') || s.startsWith('data:')) return
      const clean = s.split('#')[0]; if (seen.has(clean)) return; seen.add(clean); out.push(clean)
    })
    return out
  }

  function blobToDataUrl(blob) { return new Promise((rs, rj) => { const fr = new FileReader(); fr.onloadend = () => rs(fr.result); fr.onerror = rj; fr.readAsDataURL(blob) }) }

  // 로그인 여부 확인 (Scenify 방식): /api/auth/session 에 user 가 있으면 로그인됨.
  async function isLoggedIn() {
    try {
      const r = await fetch('https://chatgpt.com/api/auth/session', { credentials: 'include' })
      if (!r.ok) return false
      const j = await r.json().catch(() => null)
      return !!(j && (j.user || j.accessToken))
    } catch (e) {
      return false
    }
  }

  // 한 개 작업 실행 → 생성된 이미지 dataUrl 반환 (실패 시 throw)
  async function runJob(job, report) {
    const PROMPT = job.prompt || ''
    const ASPECT = job.aspect || '16:9'
    const REFS = job.referenceImages || []

    report('로그인 확인 중…')
    if (!(await isLoggedIn())) {
      // 작업용 탭(이 탭)을 앞으로 띄워 사용자가 바로 로그인하게
      send({ type: 'need-login' })
      throw new Error('ChatGPT 로그인 필요 — 방금 띄운 크롬 탭에서 로그인한 뒤 다시 시도하세요')
    }

    report('ChatGPT 준비 중…')
    for (let i = 0; i < 40 && !getPromptInput(); i++) await sleep(300)
    if (!getPromptInput()) throw new Error('입력창 없음 — ChatGPT 페이지가 준비되지 않았습니다(새로고침 후 재시도)')

    report('이미지 모드 활성화…')
    if (!(await activateImageTool())) log('경고: 이미지 모드 활성 실패 — 일반 모드로 진행')
    await applyImageSize(ASPECT)
    if (REFS.length) { report('참조 이미지 업로드…'); await uploadImages(REFS); await sleep(1500) }

    report('프롬프트 입력 중…')
    if (!(await typePrompt(PROMPT))) throw new Error('프롬프트 입력 실패')

    let send = getSendButton(), t = 0
    while ((!send || send.disabled) && t++ < 30) { await sleep(150); send = getSendButton() }
    if (!send || send.disabled) throw new Error('전송 버튼 비활성')
    await clickEl(send)
    report('전송됨 · 이미지 생성 대기 중…')
    await sleep(500)

    let stableUrl = null, stableCount = 0
    for (let i = 0; i < 160; i++) {
      await sleep(1500)
      if (i % 4 === 0) await throwIfCanceled(job.id) // 정지 버튼 확인(약 6초마다)
      if (i > 0 && i % 8 === 0) report('이미지 생성 대기 중… (' + Math.round(i * 1.5) + '초)')
      const urls = lastTurnImageUrls()
      if (urls.length && !isStreaming()) {
        const u = urls[urls.length - 1]
        if (u === stableUrl) stableCount++
        else { stableUrl = u; stableCount = 0 }
        if (stableCount >= 1) break
      } else {
        stableCount = 0
      }
    }
    if (!stableUrl) throw new Error('시간 초과 — 생성 이미지 없음')

    report('이미지 가져오는 중…')
    const res = await fetch(stableUrl, { credentials: 'include' })
    if (!res.ok) throw new Error('이미지 다운로드 실패 ' + res.status)
    return await blobToDataUrl(await res.blob())
  }

  // ── 폴링 루프 ───────────────────────────────────────────────────────────
  const send = (msg) => new Promise((resolve) => { try { chrome.runtime.sendMessage(msg, (r) => resolve(r)) } catch (e) { resolve(null) } })
  let busy = false

  // 앱의 정지 버튼이 눌렸는지 확인 (실행 중 중간중간 호출). 취소면 throw 로 즉시 중단.
  async function throwIfCanceled(jobId) {
    const r = await send({ type: 'check-cancel', id: jobId })
    if (r && r.canceled) throw new Error('정지됨 (사용자 취소)')
  }

  async function tick() {
    if (busy) return
    const r = await send({ type: 'poll', source: 'chatgpt' })
    const job = r && r.job
    if (!job) return
    busy = true
    const report = (m) => { log(m); send({ type: 'job-status', id: job.id, status: 'progress', message: m }) }
    try {
      const dataUrl = await runJob(job, report)
      await send({ type: 'image', source: 'chatgpt', dataUrl, pageUrl: location.href })
      await send({ type: 'job-status', id: job.id, status: 'done', message: '완료' })
      log('완료')
    } catch (e) {
      const m = (e && e.message) || String(e)
      await send({ type: 'job-status', id: job.id, status: 'error', message: m })
      log('오류: ' + m)
    } finally {
      // 봇 감지 회피: 다음 생성까지 사람처럼 랜덤 간격(12~25초). 고정 간격은 그 자체가 봇 신호.
      const cooldown = 12000 + Math.floor(Math.random() * 13000)
      const sec = Math.round(cooldown / 1000)
      report('다음 생성까지 대기 ' + sec + '초…')
      await sleep(cooldown)
      busy = false
    }
  }

  setInterval(tick, 3000)
  log('TB MTOOL 자동화 대기 시작 (ChatGPT)')
})()
