// TB MTOOL 자동화 content script (Suno 음악 전용).
// suno.com/create 작업용 탭에서만 동작. 폼 채우기→Create→새 곡 2개 songId 회수→
// cdn 의 mp3 가 준비되면 받아서 앱으로 전송. (automateSuno.ts 의 DOM 로직 이식)
;(() => {
  const log = (m) => console.log('[AVS-GEN]', m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const isVisible = (el) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none'
  }
  const qV = (sels) => {
    for (const sel of sels) {
      try {
        for (const el of document.querySelectorAll(sel)) if (isVisible(el)) return el
      } catch (e) {}
    }
    return null
  }
  const findByText = (tag, txt) =>
    [...document.querySelectorAll(tag)].find((e) => isVisible(e) && (e.textContent || '').trim() === txt) ||
    [...document.querySelectorAll(tag)].find((e) => isVisible(e) && (e.textContent || '').trim().includes(txt))
  function trustedClick(el) {
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    const b = { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true }
    el.dispatchEvent(new PointerEvent('pointerdown', { ...b, buttons: 1 }))
    el.dispatchEvent(new MouseEvent('mousedown', { ...b, buttons: 1 }))
    el.dispatchEvent(new PointerEvent('pointerup', { ...b, buttons: 0 }))
    el.dispatchEvent(new MouseEvent('mouseup', { ...b, buttons: 0 }))
    el.dispatchEvent(new MouseEvent('click', { ...b, buttons: 0 }))
  }
  async function setFieldValue(el, value) {
    el.focus(); await sleep(50)
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(80)
      return el.value === value
    }
    return false
  }
  function findSimpleDesc() {
    for (const el of document.querySelectorAll('textarea')) {
      if (!isVisible(el)) continue
      if (el.closest('[data-testid="lyrics-textarea"]')) continue
      if (el.closest('[data-testid="create-form-styles-wrapper"]')) continue
      return el
    }
    return null
  }
  // 문서 전체에서 /song/<id> 링크를 스캔 (clip-row 등 특정 셀렉터에 의존 안 함 — UI 변경에 견고)
  function allSongIds() {
    const s = new Set()
    for (const a of document.querySelectorAll('a[href*="/song/"]')) {
      const m = (a.getAttribute('href') || '').match(/\/song\/([\w-]+)/)
      if (m) s.add(m[1])
    }
    return s
  }
  function snapshotIds() {
    return allSongIds()
  }
  function newIds(before) {
    const out = []
    for (const id of allSongIds()) if (!before.has(id) && out.indexOf(id) < 0) out.push(id)
    return out
  }
  function blobToDataUrl(blob) { return new Promise((rs, rj) => { const fr = new FileReader(); fr.onloadend = () => rs(fr.result); fr.onerror = rj; fr.readAsDataURL(blob) }) }

  // songId 의 mp3 가 cdn 에 준비될 때까지 폴링 → dataUrl
  async function fetchSongMp3(songId, jobId, report) {
    const url = 'https://cdn1.suno.ai/' + songId + '.mp3'
    for (let i = 0; i < 60; i++) {
      await throwIfCanceled(jobId)
      try {
        const res = await fetch(url, { credentials: 'include' })
        if (res.ok) {
          const blob = await res.blob()
          if (blob.size > 1000) return await blobToDataUrl(blob)
        }
      } catch (e) {}
      if (i % 4 === 0) report('곡 완성 대기 중… (' + i * 5 + '초)')
      await sleep(5000)
    }
    return null
  }

  // 한 작업 실행 → 2곡 mp3 를 앱으로 전송 (성공 곡 수 반환)
  async function runJob(job, report) {
    const p = job.musicPayload || {}
    const MODE = p.mode === 'advanced' ? 'advanced' : 'simple'

    report('SUNO 준비 중…')
    if (!location.pathname.startsWith('/create')) {
      send({ type: 'need-login', site: 'suno' })
      throw new Error('SUNO create 페이지가 아님 — 크롬에서 suno.com 로그인 확인')
    }
    await sleep(1200)

    // 모드 전환
    const wantLabel = MODE === 'simple' ? 'Simple' : 'Advanced'
    const tab = findByText('button', wantLabel)
    if (tab && !tab.classList.contains('active')) { trustedClick(tab); await sleep(900) }

    // 폼 입력
    if (MODE === 'simple') {
      const ta = findSimpleDesc()
      if (!ta) throw new Error('설명 입력창을 찾지 못함')
      await setFieldValue(ta, p.description || '')
      if (p.instrumental) {
        const tog = qV(['button[aria-label*="instrumental" i]'])
        if (tog) {
          const pressed = tog.getAttribute('aria-pressed') === 'true' || tog.getAttribute('data-state') === 'checked' || tog.getAttribute('aria-checked') === 'true'
          if (!pressed) trustedClick(tog)
        }
      }
    } else {
      const style = qV(['[data-testid="create-form-styles-wrapper"] textarea', 'textarea[placeholder*="Describe the sound" i]'])
      if (style) await setFieldValue(style, p.style || '')
      const lyrics = qV(['textarea[data-testid="lyrics-textarea"]'])
      if (lyrics) await setFieldValue(lyrics, p.lyrics || '')
      const title = qV(['input[placeholder*="Song Title" i]'])
      if (title) await setFieldValue(title, p.title || '')
    }
    await sleep(500)

    // Create
    const before = snapshotIds()
    let btn = null
    for (let i = 0; i < 24; i++) { btn = qV(['button[aria-label="Create song"]', 'button[aria-label*="Create" i]']); if (btn && !btn.disabled) break; await sleep(250) }
    if (!btn || btn.disabled) throw new Error('Create 버튼이 활성화되지 않음')
    trustedClick(btn)
    report('생성 요청됨 · 새 곡 대기 중…')

    let ids = []
    for (let i = 0; i < 70; i++) { await sleep(1000); ids = newIds(before); if (ids.length >= 2) break; if (i % 10 === 0) await throwIfCanceled(job.id) }
    if (ids.length === 0) throw new Error('새 곡이 생성되지 않음 (크레딧/로그인 확인)')
    ids = ids.slice(0, 2)
    report(ids.length + '곡 생성 시작 — mp3 회수 중…')

    let sent = 0
    for (const songId of ids) {
      const dataUrl = await fetchSongMp3(songId, job.id, report)
      if (dataUrl) {
        await send({ type: 'image', source: 'suno', dataUrl, filename: songId + '.mp3', pageUrl: location.href })
        sent++
      }
    }
    if (sent === 0) throw new Error('mp3 를 받지 못했습니다 (시간 초과)')
    return sent
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
    const r = await send({ type: 'poll', source: 'suno' })
    const job = r && r.job
    if (!job) return
    busy = true
    const report = (m) => { log(m); send({ type: 'job-status', id: job.id, status: 'progress', message: m }) }
    try {
      const n = await runJob(job, report)
      await send({ type: 'job-status', id: job.id, status: 'done', message: n + '곡 완료' })
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
  log('TB MTOOL 자동화 대기 시작 (Suno)')
})()
