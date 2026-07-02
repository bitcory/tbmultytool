// TB MTOOL — 샤오홍슈 소스찾기 스크래퍼 (content script, xiaohongshu.com).
// 앱의 'xiaohongshu' 검색 작업(kind:search)을 폴링 → 검색페이지로 이동 → 피드 스크롤로 카드 수집 → 앱 전송.
// 검색은 로그인+서명이 필요해 브라우저(이 스크립트)에서만 가능. 다운로드는 앱 메인이 처리.
;(() => {
  const log = (...a) => console.log('[AVS-XHS]', ...a)
  const delay = (ms) => new Promise((r) => setTimeout(r, ms))
  const send = (msg) =>
    new Promise((resolve) => {
      try { chrome.runtime.sendMessage(msg, (r) => resolve(r)) } catch (e) { resolve(null) }
    })
  const WID = 'w-' + Math.random().toString(36).slice(2, 10)
  const JOB_KEY = 'avs_xhs_job'
  let busy = false

  function onXhs() { return /xiaohongshu\.com/.test(location.host) }
  // 로그인 모달 존재 여부
  function hasLoginModal() {
    if (document.querySelector('[class*="login-container"], .login-modal, [class*="LoginModal"]')) return true
    const t = (document.body.innerText || '').slice(0, 2000)
    return /手机号登录|扫码登录|登录后推荐/.test(t)
  }
  // 로그인 모달의 닫기(X, use[href="#close"]) 버튼을 눌러 닫는다 — 닫으면 로그인 없이 피드 탐색 가능
  function closeLoginModal() {
    for (const u of document.querySelectorAll('use')) {
      const href = u.getAttribute('xlink:href') || u.getAttribute('href') || ''
      if (href !== '#close') continue
      let el = u.closest('svg') || u
      // 클릭 가능한 조상 탐색
      let p = el
      for (let i = 0; i < 6 && p; i++) {
        if (p.tagName === 'BUTTON' || (p.getAttribute && p.getAttribute('role') === 'button') || (p.className && /close/i.test(String(p.className.baseVal || p.className)))) {
          p.click(); return true
        }
        p = p.parentElement
      }
      try { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) } catch (e) {}
      if (el.parentElement) try { el.parentElement.click() } catch (e) {}
      return true
    }
    return false
  }
  async function dismissLogin() {
    for (let i = 0; i < 4 && hasLoginModal(); i++) {
      closeLoginModal()
      await delay(700)
    }
    return !hasLoginModal()
  }
  function num(s) {
    const m = String(s || '').trim().match(/([\d.]+)\s*([wk万]?)/i)
    if (!m) return 0
    const n = parseFloat(m[1]) || 0
    const u = (m[2] || '').toLowerCase()
    return u === 'w' || u === '万' ? Math.round(n * 1e4) : u === 'k' ? Math.round(n * 1e3) : Math.round(n)
  }
  function searchUrl(kw) {
    return 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(kw) + '&source=web_search_result_notes'
  }
  // 헤더 검색 입력창 찾기
  function findSearchInput() {
    return (
      document.querySelector('#search-input') ||
      document.querySelector('input.search-input') ||
      document.querySelector('input[placeholder*="搜索"], input[placeholder*="探索"], input[placeholder*="笔记"]') ||
      document.querySelector('.search-container input, .search-input-container input, header input[type="text"], header input')
    )
  }
  // React 제어 input 에 값 주입(네이티브 setter) + Enter 로 검색 실행
  function setNativeValue(el, val) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, val)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  function keyEnter(el) {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
    }
  }
  async function typeSearch(kw) {
    const inp = findSearchInput()
    if (!inp) { log('검색창 못 찾음'); return false }
    inp.focus()
    await delay(150)
    setNativeValue(inp, kw)
    await delay(400)
    keyEnter(inp)
    // 검색 버튼도 있으면 클릭(폴백)
    const btn = document.querySelector('.search-icon, [class*="search"] [class*="icon"], .input-button')
    if (btn) { try { btn.click() } catch (e) {} }
    log('검색어 입력:', kw)
    return true
  }

  // 피드에서 카드 추출 — 커버 링크(a[href*="/search_result/" | "/explore/"])를 기준으로 카드 컨테이너를 찾는다.
  function extractCards(limit) {
    const seen = new Map()
    const anchors = document.querySelectorAll('a[href*="/search_result/"], a[href*="/explore/"], a[href*="/discovery/item/"]')
    for (const a of anchors) {
      const href = a.getAttribute('href') || ''
      const m = href.match(/\/(?:search_result|explore|discovery\/item)\/([0-9a-f]{16,32})/i)
      if (!m) continue
      const noteId = m[1]
      if (seen.has(noteId)) continue
      const tokenM = href.match(/xsec_token=([^&]+)/)
      const token = tokenM ? decodeURIComponent(tokenM[1]) : ''
      // 카드 컨테이너: 커버 링크의 조상 중 note-item / section / 여러 자식을 가진 블록
      let card = a.closest('section') || a.closest('[class*="note"]') || a.parentElement
      const q = (sel) => (card ? card.querySelector(sel) : null)
      const img = a.querySelector('img') || q('img')
      const titleEl = q('.title, [class*="title"] span, .footer .title, span[class*="title"]')
      const authorEl = q('.author .name, .name, [class*="author"] [class*="name"], .user .name')
      const likeEl = q('.like-wrapper .count, .count, [class*="like"] [class*="count"], [class*="interaction"] [class*="count"]')
      const hasVideo = !!q('.play-icon, [class*="play"], video, [class*="video"]')
      const durEl = q('[class*="duration"], .time')
      seen.set(noteId, {
        noteId,
        url: 'https://www.xiaohongshu.com/explore/' + noteId + (token ? '?xsec_token=' + encodeURIComponent(token) + '&xsec_source=pc_search' : ''),
        title: (titleEl && titleEl.textContent || '').trim(),
        cover: (img && (img.src || img.getAttribute('data-src'))) || '',
        type: hasVideo ? 'video' : 'image',
        likes: num(likeEl && likeEl.textContent),
        author: (authorEl && authorEl.textContent || '').trim(),
        duration: (durEl && durEl.textContent || '').trim()
      })
      if (seen.size >= limit) break
    }
    return [...seen.values()]
  }

  async function scrapeUntil(limit, jobId) {
    let last = 0, stale = 0
    for (let i = 0; i < 40 && stale < 4; i++) {
      const canceled = await send({ type: 'check-cancel', id: jobId })
      if (canceled && canceled.canceled) return null
      if (hasLoginModal()) closeLoginModal()
      window.scrollTo(0, document.body.scrollHeight)
      await delay(1200)
      const n = document.querySelectorAll('a[href*="/search_result/"], a[href*="/explore/"], a[href*="/discovery/item/"]').length
      stale = n > last ? 0 : stale + 1
      last = n
      const cards = extractCards(limit)
      await send({ type: 'job-status', id: jobId, status: 'progress', message: '수집 중 ' + cards.length + '개' })
      if (cards.length >= limit) break
    }
    return extractCards(limit)
  }

  // 검색 페이지 도착 후(리로드로 재실행) 저장된 작업을 이어서 처리
  async function resumeIfPending() {
    let saved
    try { saved = JSON.parse(sessionStorage.getItem(JOB_KEY) || 'null') } catch (e) {}
    if (!saved || !saved.id) return
    if (!/search_result/.test(location.pathname) && !/\/search/.test(location.href)) return
    sessionStorage.removeItem(JOB_KEY)
    busy = true
    const limit = Math.min(300, Math.max(10, saved.limit || 100))
    log('검색 재개:', saved.keyword, 'limit', limit)
    await delay(2500) // 초기 피드 로딩 대기
    if (hasLoginModal()) {
      log('로그인 모달 감지 — 닫기 시도')
      await send({ type: 'job-status', id: saved.id, status: 'progress', message: '로그인 창 닫는 중…' })
      await dismissLogin()
      await delay(1000)
    }
    try {
      const cards = await scrapeUntil(limit, saved.id)
      // 닫아도 카드가 하나도 없으면 로그인이 필요한 상태로 안내
      if (cards && cards.length === 0 && hasLoginModal()) {
        await send({ type: 'xhs-results', cards: [] })
        await send({ type: 'job-status', id: saved.id, status: 'error', message: '샤오홍슈 로그인이 필요할 수 있어요 — 로그인 후 다시 시도' })
        busy = false
        return
      }
      if (cards) {
        await send({ type: 'xhs-results', cards })
        await send({ type: 'job-status', id: saved.id, status: 'done', message: cards.length + '개 수집' })
        log('완료:', cards.length)
      } else {
        await send({ type: 'job-status', id: saved.id, status: 'error', message: '취소됨' })
      }
    } catch (e) {
      await send({ type: 'job-status', id: saved.id, status: 'error', message: String((e && e.message) || e) })
    } finally {
      busy = false
    }
  }

  // 검색창에 입력→Enter 로 검색(SPA 라우팅). 실패 시 URL 이동으로 폴백.
  async function runSearch(job) {
    busy = true
    const opts = job.xhsSearch || {}
    const kw = (opts.keyword || job.prompt || '').trim()
    const limit = Math.min(300, Math.max(10, opts.limit || 100))
    const report = (m) => send({ type: 'job-status', id: job.id, status: 'progress', message: m })
    try {
      await dismissLogin()
      report('검색어 입력 중…')
      await typeSearch(kw)
      // 검색 결과 페이지 진입 대기
      let ok = false
      for (let i = 0; i < 12; i++) {
        await delay(800)
        await dismissLogin()
        if (/search_result|search\?keyword|\/search/.test(location.href)) { ok = true; break }
      }
      if (!ok) {
        log('입력 방식 미진입 → URL 이동 폴백')
        try { sessionStorage.setItem(JOB_KEY, JSON.stringify({ id: job.id, keyword: kw, limit, sort: opts.sort })) } catch (e) {}
        location.href = searchUrl(kw)
        return // 리로드 후 resumeIfPending 가 이어서 스크랩
      }
      await delay(1800)
      await dismissLogin()
      const cards = await scrapeUntil(limit, job.id)
      if (cards && cards.length === 0 && hasLoginModal()) {
        await send({ type: 'xhs-results', cards: [] })
        await send({ type: 'job-status', id: job.id, status: 'error', message: '샤오홍슈 로그인이 필요할 수 있어요 — 로그인 후 다시 시도' })
        return
      }
      await send({ type: 'xhs-results', cards: cards || [] })
      await send({ type: 'job-status', id: job.id, status: 'done', message: (cards || []).length + '개 수집' })
      log('완료:', (cards || []).length)
    } catch (e) {
      await send({ type: 'job-status', id: job.id, status: 'error', message: String((e && e.message) || e) })
    } finally {
      busy = false
    }
  }

  async function tick() {
    if (!onXhs() || busy) return
    const r = await send({ type: 'poll', source: 'xiaohongshu', worker: WID, ready: 1 })
    const job = r && r.job
    if (!job) return
    const kw = ((job.xhsSearch && job.xhsSearch.keyword) || job.prompt || '').trim()
    if (!kw) { await send({ type: 'job-status', id: job.id, status: 'error', message: '검색어 없음' }); return }
    log('작업 수신:', kw)
    runSearch(job).catch((e) => { busy = false; log('runSearch 오류', e) })
  }

  resumeIfPending()
  setInterval(tick, 3000)
  log('TB MTOOL 샤오홍슈 스크래퍼 대기 (' + location.href + ')')
})()
