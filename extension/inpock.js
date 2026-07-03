// TB MTOOL — 인포크링크(link.inpock.co.kr) 링크블록 자동 등록 (ISOLATED world).
// 앱의 'inpock' 작업을 /poll 로 받아, 관리자 링크블록 폼(/admin/block/link/post)에
// 연결주소(쿠팡파트너스 링크)·타이틀(제품명)·썸네일 이미지를 채우고 "추가 완료"까지 누른다.
// 폼 필드(2026-07 실측): input[name=url], textarea[name=title], input[type=file](이미지),
// 이미지 주입 시 크롭 다이얼로그("선택" 버튼) → "추가 완료" 활성화.
;(() => {
  const log = (m) => console.log('[AVS-INPOCK]', m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => resolve(r))
      } catch (e) {
        resolve(null)
      }
    })
  const WORKER_ID = 'w-' + Math.random().toString(36).slice(2, 10)
  const FORM_PATH = '/admin/block/link/post'
  const RESUME_KEY = '__avs_inpock_job' // 전체 페이지 이동 후 작업 이어받기용
  let busy = false

  function onAdmin() {
    return location.hostname === 'link.inpock.co.kr' && location.pathname.indexOf('/admin') === 0
  }
  function onForm() {
    return location.pathname.indexOf(FORM_PATH) === 0
  }

  // React 제어 인풋에 값 주입 (native setter + input/change)
  function setVal(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set
    if (setter) setter.call(el, v)
    else el.value = v
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  async function dataUrlToFile(dataUrl, name) {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    return new File([blob], name, { type: blob.type || 'image/png' })
  }

  function findBtnByText(text) {
    return [...document.querySelectorAll('button')].find((b) => {
      const t = (b.textContent || '').trim()
      const r = b.getBoundingClientRect()
      return t === text && r.width > 0 && r.height > 0
    })
  }

  async function waitFor(fn, maxMs, everyMs) {
    const dl = Date.now() + (maxMs || 15000)
    while (Date.now() < dl) {
      const v = fn()
      if (v) return v
      await sleep(everyMs || 300)
    }
    return null
  }

  async function runJob(job) {
    const p = job.inpockPayload || {}
    const report = (m) => {
      log(m)
      send({ type: 'job-status', id: job.id, status: 'progress', message: m })
    }
    if (!p.url || !p.title || !p.imageDataUrl) throw new Error('작업 정보 부족 (url/title/image)')

    // 폼 페이지가 아니면 이동 — 작업을 sessionStorage 에 저장해 리로드 후 이어받는다.
    if (!onForm()) {
      report('링크블록 등록 폼으로 이동…')
      try {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify(job))
      } catch (e) {}
      location.href = 'https://link.inpock.co.kr' + FORM_PATH
      return false // 이 인스턴스는 여기서 끝 — 새 인스턴스가 이어받음
    }

    report('폼 로딩 대기…')
    const urlInput = await waitFor(() => document.querySelector('input[name="url"]'), 20000)
    const titleInput = document.querySelector('textarea[name="title"]')
    const fileInput = document.querySelector('input[type="file"]')
    if (!urlInput || !titleInput || !fileInput) throw new Error('링크블록 폼을 찾을 수 없습니다 (로그인/페이지 구조 확인)')

    report('링크·타이틀 입력…')
    setVal(urlInput, p.url)
    await sleep(300)
    setVal(titleInput, p.title)
    await sleep(300)

    report('썸네일 이미지 업로드…')
    const file = await dataUrlToFile(p.imageDataUrl, 'thumb.png')
    const dt = new DataTransfer()
    dt.items.add(file)
    // 주의: ISOLATED world 에서 defineProperty 로 files 를 덮으면 페이지(MAIN)의 React 가
    // 못 본다. 네이티브 setter 직접 할당만 실제 DOM 노드에 반영되어 양쪽 world 에서 보인다.
    fileInput.files = dt.files
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    fileInput.dispatchEvent(new Event('input', { bubbles: true }))
    if (!fileInput.files || !fileInput.files.length) throw new Error('이미지 파일 주입 실패 (files 비어있음)')

    // 크롭 다이얼로그의 "선택" 클릭 (안 뜨는 케이스도 있어 best-effort)
    const cropBtn = await waitFor(() => findBtnByText('선택'), 8000)
    if (cropBtn) {
      report('이미지 크롭 확인…')
      cropBtn.click()
    }

    // "추가 완료" 활성화 대기 → 클릭
    report('추가 완료 대기…')
    const done = await waitFor(() => {
      const b = findBtnByText('추가 완료')
      return b && !b.disabled ? b : null
    }, 20000)
    if (!done) throw new Error('"추가 완료" 버튼이 활성화되지 않았습니다 (필수값 미충족?)')
    done.click()

    // 등록 완료 = 폼에서 목록으로 복귀(경로 변경) 또는 폼 사라짐
    const left = await waitFor(() => (!onForm() || !document.querySelector('input[name="url"]') ? true : null), 15000)
    if (!left) throw new Error('등록 확인 실패 — 인포크 화면을 확인해주세요')
    return true
  }

  async function execute(job) {
    busy = true
    try {
      const done = await runJob(job)
      if (done) {
        await send({ type: 'job-status', id: job.id, status: 'done', message: '인포크 등록 완료' })
        log('완료: ' + (job.inpockPayload && job.inpockPayload.title))
      }
    } catch (e) {
      const m = (e && e.message) || String(e)
      await send({ type: 'job-status', id: job.id, status: 'error', message: m })
      log('오류: ' + m)
    } finally {
      busy = false
    }
  }

  // 페이지 이동으로 이어받은 작업 실행
  async function resumeIfAny() {
    let saved = null
    try {
      saved = sessionStorage.getItem(RESUME_KEY)
      if (saved) sessionStorage.removeItem(RESUME_KEY)
    } catch (e) {}
    if (!saved) return
    let job = null
    try {
      job = JSON.parse(saved)
    } catch (e) {}
    if (!job || !job.id) return
    log('이어받은 작업 실행: ' + job.id)
    await sleep(1200) // SPA 초기 렌더 대기
    await execute(job)
  }

  async function tick() {
    if (!onAdmin() || busy) {
      if (busy) await send({ type: 'poll', source: 'inpock', worker: WORKER_ID, ready: 0 })
      return
    }
    const r = await send({ type: 'poll', source: 'inpock', worker: WORKER_ID, ready: 1 })
    const job = r && r.job
    if (!job) return
    log('작업 수신: ' + job.id)
    await execute(job)
  }

  setInterval(tick, 3000)
  resumeIfAny()
  log('TB MTOOL 인포크링크 자동 등록 대기 (' + location.pathname + ')')
})()
