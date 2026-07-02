// TB MTOOL — Flow 배치 컨트롤러 (ISOLATED world).
// TOOLB FLOW 엔진(fe-page-script, MAIN)을 구동해 한 탭에서 여러 프롬프트를 파이프라인 생성한다.
//   - 앱의 'flowbatch' 작업(프롬프트 배열)을 /poll 로 받아 → START_BATCH 로 page-script 에 전달
//   - page-script 의 DOWNLOAD_IMAGE(url) 이벤트를 받아 앱으로 이미지 전송(type:image, source:flow)
//   - BATCH_COMPLETE 시 job-status done 보고 → 앱의 generateFlowBatch 프로미스 resolve
// page-script(MAIN)와 같은 window 라 window.postMessage 로 직접 통신(별도 bridge 불필요).
;(() => {
  const log = (m) => console.log('[AVS-FLOWBATCH]', m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
  let onEvent = null
  const uploadedAssets = new Set() // 이 세션에서 이미 업로드한 참조 에셋 이름(중복 업로드 방지)

  // Flow 생성 페이지인지 (labs.google/fx/.../tools/flow)
  function onFlowPage() {
    return location.pathname.indexOf('/fx') !== -1
  }

  const RATIOS = { '9:16': '9:16', '16:9': '16:9', '1:1': '1:1', '3:4': '3:4', '4:3': '4:3' }

  // 프롬프트 에디터 존재 = 프로젝트 안.
  function hasEditor() {
    return !!document.querySelector(
      '[role="textbox"][contenteditable="true"], [data-slate-editor="true"][contenteditable="true"], [role="textbox"], textarea'
    )
  }

  function realClick(el) {
    try {
      el.scrollIntoView({ block: 'center' })
    } catch (e) {}
    const o = { bubbles: true, cancelable: true, view: window }
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', o))
      el.dispatchEvent(new MouseEvent('mousedown', o))
      el.dispatchEvent(new PointerEvent('pointerup', o))
      el.dispatchEvent(new MouseEvent('mouseup', o))
      el.dispatchEvent(new MouseEvent('click', o))
    } catch (e) {}
    try {
      el.click()
    } catch (e) {}
  }

  let projDiagged = false
  // "새 프로젝트"(텍스트 또는 add_2 아이콘) 버튼을 찾는다.
  function findNewProjectBtn() {
    const els = [...document.querySelectorAll('button, [role="button"], a')]
    const re = /새\s*프로젝트|new\s*project/i
    // 1) 텍스트 매칭
    let b = els.find((x) => re.test(x.textContent || ''))
    if (b) return b
    // 2) add_2 아이콘 보유
    b = els.find((x) => [...x.querySelectorAll('i, span')].some((ic) => (ic.textContent || '').trim() === 'add_2'))
    if (b) return b
    // 진단: 한 번만 버튼 텍스트들 덤프
    if (!projDiagged) {
      projDiagged = true
      const texts = els.slice(0, 20).map((x) => (x.textContent || '').trim().slice(0, 24)).filter(Boolean)
      log('새 프로젝트 버튼 못 찾음. 버튼 후보: ' + JSON.stringify(texts))
    }
    return null
  }

  // 공지/프로모 다이얼로그 자동 닫기 — 새 프로젝트 진입 직후 Flow 가 띄우는 안내 모달
  // (예: "Tools Community Gallery" 공지)이 에디터를 가려 자동화가 막힌다.
  // 닫기(X) 버튼 → Escape → 마지막 버튼(→/다음/확인) 순으로 시도, 여러 장짜리 공지는 반복해 넘긴다.
  // 주의: 에셋 첨부 다이얼로그와 충돌하지 않도록 배치 시작 전(진입 단계)에만 호출할 것.
  async function dismissDialogs() {
    let closedAny = false
    for (let i = 0; i < 6; i++) {
      const dlg = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].find((d) => {
        const r = d.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
      if (!dlg) return closedAny
      let btn = [...dlg.querySelectorAll('button, [role="button"]')].find((b) => {
        const ic = (b.querySelector('i, span')?.textContent || '').trim().toLowerCase()
        const al = (b.getAttribute('aria-label') || '').toLowerCase()
        return ic === 'close' || al.includes('close') || al.includes('닫기')
      })
      if (!btn) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
        await sleep(600)
        if (!document.contains(dlg) || dlg.getBoundingClientRect().width === 0) {
          closedAny = true
          continue
        }
        // Escape 도 안 먹으면 다이얼로그의 마지막 보이는 버튼(→/다음/확인)을 클릭해 넘긴다.
        const btns = [...dlg.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0)
        btn = btns[btns.length - 1]
      }
      if (!btn) return closedAny
      log('공지/프로모 다이얼로그 닫는 중…')
      realClick(btn)
      closedAny = true
      await sleep(900)
    }
    return closedAny
  }

  // 프로젝트에 진입(에디터가 뜰 때까지). 새 Flow 는 landing 에서 "새 프로젝트"를 눌러야 생성 UI 가 뜸.
  // landing 에 "새 프로젝트" 버튼이 있으면(=프로젝트 밖) 한 번 클릭해 들어간다. 이미 안이면 에디터만 확인.
  async function ensureProject() {
    let clicked = false
    for (let i = 0; i < 30; i++) {
      // 진입 각 단계에서 공지 모달이 뜰 수 있어(랜딩/새 프로젝트 직후) 매 반복마다 정리한다.
      await dismissDialogs()
      const btn = findNewProjectBtn()
      if (btn && !clicked) {
        log('새 프로젝트 진입 클릭')
        realClick(btn)
        clicked = true
        await sleep(2200)
        continue
      }
      // 버튼이 사라졌고 에디터가 떴으면 진입 완료
      if (!btn && hasEditor()) return true
      // 이미 프로젝트 안(버튼 없음)인데 에디터 로딩 대기
      await sleep(700)
    }
    return hasEditor()
  }

  function cleanup() {
    if (onEvent) {
      window.removeEventListener('message', onEvent)
      onEvent = null
    }
  }

  // 제품 이미지(dataURL)를 Flow 라이브러리에 에셋으로 업로드 → drop-handler(MAIN)가 처리.
  // 이후 프롬프트의 @[product] 가 이 에셋을 참조해 제품을 유지(I2I)한다.
  function attachRef(dataUrl, fileName) {
    return new Promise((resolve) => {
      let done = false
      const onR = (evt) => {
        if (evt.source !== window) return
        const d = evt.data
        if (!d || d.__toolb !== 'DROP_CHAR_RESULT') return
        done = true
        window.removeEventListener('message', onR)
        resolve(!!d.success)
      }
      window.addEventListener('message', onR)
      window.postMessage({ __toolb: 'DROP_CHAR', imageData: dataUrl, fileName: fileName }, '*')
      setTimeout(() => {
        if (!done) {
          window.removeEventListener('message', onR)
          resolve(false)
        }
      }, 90000)
    })
  }

  // page-script(MAIN) 이벤트 수신
  function startListening(job) {
    let imgCount = 0
    onEvent = (evt) => {
      if (evt.source !== window) return
      const d = evt.data
      if (!d || d.source !== 'flowbulk-page' || d.type !== 'EVENT') return
      const p = d.payload || {}
      if (p.type === 'DOWNLOAD_IMAGE' && p.url) {
        imgCount++
        // Flow 이미지 URL(labs.google→googleusercontent, 인증 필요) → background 가 쿠키 포함 fetch 로 회수.
        send({ type: 'image', source: 'flow', url: p.url, pageUrl: location.href })
        send({ type: 'job-status', id: job.id, status: 'progress', message: '이미지 ' + imgCount + '장 수신' })
        log('이미지 수신 ' + imgCount + ': ' + p.url.slice(0, 60))
      } else if (p.type === 'LOG') {
        log(p.text)
      } else if (p.type === 'GENERATION_FAILED') {
        log('생성 실패 #' + p.index + ': ' + p.error)
      } else if (p.type === 'BATCH_COMPLETE') {
        send({ type: 'job-status', id: job.id, status: 'done', message: '완료 ' + p.successCount + '/' + p.totalCount })
        log('배치 완료: ' + p.successCount + '/' + p.totalCount)
        cleanup()
        busy = false
        currentJobId = null
      }
    }
    window.addEventListener('message', onEvent)
  }

  async function runJob(job) {
    busy = true
    currentJobId = job.id
    let prompts = Array.isArray(job.prompts) ? job.prompts.filter(Boolean) : job.prompt ? [job.prompt] : []
    if (!prompts.length) {
      await send({ type: 'job-status', id: job.id, status: 'error', message: '프롬프트 없음' })
      busy = false
      currentJobId = null
      return
    }
    startListening(job)
    // 0) 프로젝트 진입 — 새 Flow 는 "새 프로젝트" 버튼을 눌러야 생성 UI 가 뜬다.
    await send({ type: 'job-status', id: job.id, status: 'progress', message: 'Flow 프로젝트 진입 중…' })
    const entered = await ensureProject()
    if (!entered) {
      await send({ type: 'job-status', id: job.id, status: 'error', message: 'Flow 프로젝트 진입 실패 — 수동으로 새 프로젝트를 열어주세요' })
      cleanup()
      busy = false
      currentJobId = null
      return
    }
    await sleep(800)
    await dismissDialogs() // 에디터 로딩 후 늦게 뜨는 공지 모달도 정리
    // 1) 비율 적용 — flow-options 는 chrome.runtime 으로 받으므로 background 가 이 탭으로 릴레이.
    await send({ type: 'fe-apply-options', ratio: RATIOS[job.aspect] || '9:16', count: 'x1' })
    await sleep(1800) // 비율 탭 클릭 반영 대기
    // 1.5) 참조 에셋 업로드 — 프롬프트의 @[name] 토큰에 대응. 같은 세션에서 이미 올린 건 건너뜀.
    const assets = Array.isArray(job.assets) ? job.assets.filter((a) => a && a.name && a.dataUrl) : []
    if (assets.length) {
      await send({ type: 'job-status', id: job.id, status: 'progress', message: `참조 이미지 ${assets.length}개 업로드 중…` })
      for (const a of assets) {
        if (uploadedAssets.has(a.name)) {
          log('참조 에셋 재사용: ' + a.name)
          continue
        }
        log('참조 에셋 업로드: ' + a.name)
        const ok = await attachRef(a.dataUrl, a.name + '.png')
        if (ok) uploadedAssets.add(a.name)
        else log('참조 에셋 업로드 실패: ' + a.name)
      }
    }
    // 프롬프트는 앱에서 이미 @[name] 토큰을 포함해 보냄 — 그대로 사용.
    // 2) START_BATCH 직접 전달 (같은 window)
    window.postMessage(
      {
        source: 'flowbulk-bridge',
        payload: {
          type: 'START_BATCH',
          settings: {
            prompts,
            imageMode: 'none',
            delayMin: 1,
            delayMax: 2,
            autoDownload: true, // DOWNLOAD_IMAGE 이벤트를 받기 위해 ON (실제 디스크 저장 안 함 — 앱이 회수)
            filenamePrefix: 'tb_shorts',
            concurrent: 2, // 30%/80% 파이프라인
            count: 'x1',
            genTimeout: 180
          }
        }
      },
      '*'
    )
    log('START_BATCH 전송: ' + prompts.length + '개 프롬프트')
  }

  async function tick() {
    if (!onFlowPage()) return
    if (busy) {
      // 작업 중에도 heartbeat(ready=0) + 취소 확인
      await send({ type: 'poll', source: 'flowbatch', worker: WID, ready: 0 })
      if (currentJobId) {
        const c = await send({ type: 'check-cancel', id: currentJobId })
        if (c && c.canceled) {
          window.postMessage({ source: 'flowbulk-bridge', payload: { type: 'STOP_BATCH' } }, '*')
          log('취소됨 — STOP_BATCH')
          cleanup()
          busy = false
          currentJobId = null
        }
      }
      return
    }
    const r = await send({ type: 'poll', source: 'flowbatch', worker: WID, ready: 1 })
    const job = r && r.job
    if (!job) return
    log('작업 수신: ' + (Array.isArray(job.prompts) ? job.prompts.length : 1) + '개')
    runJob(job).catch((e) => {
      send({ type: 'job-status', id: job.id, status: 'error', message: String((e && e.message) || e) })
      cleanup()
      busy = false
      currentJobId = null
    })
  }

  setInterval(tick, 3000)
  log('TB MTOOL Flow 배치 컨트롤러 대기 (' + location.href + ')')
})()
