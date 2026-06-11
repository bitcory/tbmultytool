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
  async function typePrompt(text, hasRefs) {
    const el = getPromptInput(); if (!el) return false
    // 참조 이미지가 있으면 업로드 처리 동안 전송버튼이 한동안 비활성 → 대기를 넉넉히.
    const budget = hasRefs ? 25000 : 8000
    el.focus(); await sleep(50)
    clearInput(el); await sleep(50)
    document.execCommand('insertText', false, text)
    fireInput(el, text)
    await sleep(200)
    // 1) 텍스트가 안 들어갔으면 붙여넣기로 폴백
    if (!hasContent(el, text)) {
      clearInput(el)
      const dt = new DataTransfer(); dt.setData('text/plain', text)
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
      await sleep(200); fireInput(el, text)
    }
    if (!hasContent(el, text)) return false
    // 2) 텍스트는 들어갔음 → 전송버튼이 활성화될 때까지(참조 업로드 처리 포함) 대기
    return await ensureSendAppears(el, text, budget)
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
    if (!(await typePrompt(PROMPT, REFS.length > 0))) throw new Error('프롬프트 입력 실패(전송버튼 미활성 — 참조 업로드 지연일 수 있음)')

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
      if (isRateLimited()) { const e = new Error('레이트 리밋'); e.rateLimit = true; throw e }
      if (i > 0 && i % 8 === 0) report('이미지 생성 대기 중… (' + Math.round(i * 1.5) + '초)')
      const urls = lastTurnImageUrls()
      const u = urls.length ? urls[urls.length - 1] : null
      if (u) {
        if (u === stableUrl) stableCount++
        else { stableUrl = u; stableCount = 0 }
        // 스트리밍 끝났으면 1회 안정으로 즉시 채택. 새 ChatGPT는 이미지 완료 후에도
        // task 처리로 stop 버튼이 잠시 남을 수 있어, 스트리밍 중이면 URL 이 ~6초(4회) 안정될 때 채택.
        if (isStreaming() ? stableCount >= 4 : stableCount >= 1) break
      } else if (!isStreaming()) {
        stableCount = 0
      }
    }
    if (!stableUrl) throw new Error('시간 초과 — 생성 이미지 없음')

    report('이미지 가져오는 중…')
    const res = await fetch(stableUrl, { credentials: 'include' })
    if (!res.ok) throw new Error('이미지 다운로드 실패 ' + res.status)
    return await blobToDataUrl(await res.blob())
  }

  // 레이트리밋(계정 사용량 한도) 감지 — 마지막 turn 텍스트에서 한도 안내 문구를 찾는다.
  const RATE_PAT = ['한도', '제한에 도달', '한도에 도달', '사용량', '잠시 후 다시', '나중에 다시', 'rate limit', 'too many', 'limit reached', 'try again later', 'usage limit', "you've hit"]
  function isRateLimited() {
    const turns = qsa(SEL.turn); const last = turns[turns.length - 1]
    const t = (last ? (last.innerText || last.textContent || '') : '').toLowerCase()
    if (!t) return false
    return RATE_PAT.some((p) => t.includes(p.toLowerCase()))
  }

  // ── 폴링 루프 ───────────────────────────────────────────────────────────
  const send = (msg) => new Promise((resolve) => { try { chrome.runtime.sendMessage(msg, (r) => resolve(r)) } catch (e) { resolve(null) } })
  // 이 탭의 고유 워커 ID — 앱이 살아있는 탭 수를 정확히 세어 동시 탭 수를 상한(3)으로 통제.
  const WORKER_ID = 'w-' + Math.random().toString(36).slice(2, 10)
  let busy = false
  let backoffUntil = 0 // 레이트리밋 시 이 시각까지 새 작업 안 받음(heartbeat 는 계속)

  // 앱의 정지 버튼이 눌렸는지 확인 (실행 중 중간중간 호출). 취소면 throw 로 즉시 중단.
  async function throwIfCanceled(jobId) {
    const r = await send({ type: 'check-cancel', id: jobId })
    if (r && r.canceled) throw new Error('정지됨 (사용자 취소)')
  }

  async function tick() {
    // 한가할 때(새 작업 받기 전)만 페이지 가드: 이미지 생성이 가능한 "기본 채팅"에서만 작업을 받는다.
    //  - 허용: "/"(새 채팅), "/c/..."(일반 대화)
    //  - 제외: "/g/..."(커스텀 GPT·프로젝트), "/gpts", 설정 등 — 이미지 도구가 없어 "이 대화에선 이미지 생성
    //    도구를 사용할 수 없습니다"가 뜨는 곳. 이런 탭은 폴링조차 안 해 → 앱이 깨끗한 chatgpt.com 탭을 새로 연다.
    // (작업 중이면 컴포저 유무와 무관하게 heartbeat 를 계속 보내 탭이 살아있음을 알린다.)
    if (!busy) {
      // URL 만으로 판정한다. (getPromptInput 등 컴포저 로딩 의존 조건을 넣으면, 새로 열린 chatgpt.com/ 탭이
      //  컴포저 뜨기 전까지 heartbeat 를 못 보내 워커 등록이 안 되고 → 앱이 새 탭을 계속 열어 창이 증식한다.)
      const p = location.pathname
      if (p !== '/' && p.indexOf('/c/') !== 0) return // 기본 채팅(/ 또는 /c/)이 아니면 작업 안 받음
    }
    // heartbeat 는 작업 중(쿨다운/백오프 포함)에도 항상 보낸다 → 앱이 이 탭이 살아있음을 알고
    // 동시 탭 수를 정확히 통제(쿨다운 중 엉뚱한 새 탭이 열리지 않음).
    const ready = !busy && Date.now() >= backoffUntil
    const r = await send({ type: 'poll', source: 'chatgpt', worker: WORKER_ID, ready: ready ? 1 : 0 })
    if (!ready) return
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
      if (e && e.rateLimit) {
        // 계정 레이트리밋 — 작업은 큐로 되돌리고(retry) 이 탭은 잠시 쉰다.
        backoffUntil = Date.now() + 90000
        await send({ type: 'job-status', id: job.id, status: 'retry', message: '레이트 리밋 — 90초 후 재시도' })
        log('레이트 리밋 감지 — 이 탭 90초 대기, 작업은 재시도 큐로')
      } else {
        const m = (e && e.message) || String(e)
        await send({ type: 'job-status', id: job.id, status: 'error', message: m })
        log('오류: ' + m)
      }
    } finally {
      // 봇 감지 회피: 다음 생성까지 사람처럼 랜덤 간격(12~25초). 고정 간격은 그 자체가 봇 신호.
      const cooldown = 12000 + Math.floor(Math.random() * 13000)
      const sec = Math.round(cooldown / 1000)
      report('다음 생성까지 대기 ' + sec + '초…')
      await sleep(cooldown)
      busy = false
    }
  }

  // 진단: ChatGPT 페이지에서 Alt+Shift+D 누르면 이미지 alt·src 를 콘솔에 출력.
  // (content script 는 페이지와 격리된 world 라 콘솔 함수 호출은 안 보임 → 키 입력으로 트리거)
  function runDiag() {
    const turns = qsa(SEL.turn)
    const last = turns[turns.length - 1]
    const imgs = last ? qsa('img', last) : []
    console.log('%c[AVS-DIAG] === 마지막 turn 이미지 개수:', 'color:#4ea1ff', imgs.length)
    imgs.forEach((im, i) => console.log('[AVS-DIAG] turn', i, { alt: im.alt, srcHead: (im.src || '').slice(0, 80), w: im.naturalWidth, h: im.naturalHeight }))
    const all = qsa('img').filter((im) => { const s = im.src || ''; return s.indexOf('oaiusercontent') >= 0 || s.indexOf('sdmntpr') >= 0 || s.indexOf('files') >= 0 })
    console.log('%c[AVS-DIAG] === oaiusercontent류 img:', 'color:#4ea1ff', all.length)
    all.forEach((im, i) => console.log('[AVS-DIAG] cand', i, { alt: im.alt, srcHead: (im.src || '').slice(0, 100) }))
    const detected = lastTurnImageUrls()
    console.log('%c[AVS-DIAG] === 현재 감지로직 결과 lastTurnImageUrls():', 'color:#4ea1ff', detected)
    // 감지된 URL 을 실제로 fetch 해본다 (자동화가 이미지를 가져오는 그 단계)
    if (detected[0]) {
      fetch(detected[0], { credentials: 'include' })
        .then(async (r) => {
          const blob = r.ok ? await r.blob() : null
          console.log('%c[AVS-DIAG] === fetch 테스트:', 'color:#4ea1ff', { status: r.status, ok: r.ok, type: blob && blob.type, sizeKB: blob && Math.round(blob.size / 1024) })
        })
        .catch((e) => console.log('%c[AVS-DIAG] === fetch 실패:', 'color:#ff6b6b', String(e && e.message || e)))
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) { e.preventDefault(); runDiag() }
  })

  setInterval(tick, 3000)
  log('TB MTOOL 자동화 대기 시작 (ChatGPT) — 진단: Alt+Shift+D 또는 로드 2.5초 후 자동')
})()
