// TB MTOOL — Google Flow 작업 폴링/브릿지 (ISOLATED world).
// 앱(로컬 서버)에 source=flow 작업을 폴링 → MAIN world(flow-main.js)에 생성을 맡기고
// (Flow 생성버튼은 React onClick 우회가 필요해 MAIN 에서만 가능) → 결과 이미지 URL 을 받아
// fetch(쿠키 포함)로 dataUrl 만들어 앱으로 전송. ChatGPT(automate.js)와 같은 워커 풀 규약.
;(() => {
  const log = (m) => console.log('[AVS-FLOW]', m)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const TAG = '__AVS_FLOW__'
  const send = (msg) => new Promise((resolve) => { try { chrome.runtime.sendMessage(msg, (r) => resolve(r)) } catch (e) { resolve(null) } })
  const WORKER_ID = 'w-' + Math.random().toString(36).slice(2, 10)
  let busy = false

  // MAIN world(flow-main.js)에 생성을 요청하고 결과 이미지 URL 을 받는다.
  function runViaMain(job, report) {
    return new Promise((resolve, reject) => {
      const id = job.id
      let cancelTimer = null
      const onMsg = (e) => {
        if (e.source !== window) return
        const d = e.data
        if (!d || d.tag !== TAG || d.id !== id) return
        if (d.dir === 'progress') { report(d.message); return }
        if (d.dir === 'done') { cleanup(); resolve(d.url); return }
        if (d.dir === 'error') { cleanup(); reject(new Error(d.message || 'Flow 생성 실패')); return }
      }
      function cleanup() {
        window.removeEventListener('message', onMsg)
        if (cancelTimer) clearInterval(cancelTimer)
      }
      window.addEventListener('message', onMsg)
      window.postMessage({ tag: TAG, dir: 'req', action: 'generate', id, job }, '*')
      // 앱 정지버튼 확인(약 6초마다) → MAIN 에 취소 알림 후 중단
      cancelTimer = setInterval(async () => {
        const r = await send({ type: 'check-cancel', id })
        if (r && r.canceled) {
          window.postMessage({ tag: TAG, dir: 'req', action: 'cancel', id }, '*')
          cleanup()
          reject(new Error('정지됨 (사용자 취소)'))
        }
      }, 6000)
    })
  }

  // Flow 생성 페이지(/tools/flow, /tools/flow/project/...)에서만 작업에 참여한다.
  // 다른 labs.google 탭이 작업을 가로채 실패시키지 않도록 → 그런 탭에선 폴링조차 안 함
  // (그러면 앱이 깨끗한 Flow 탭을 새로 열어 거기서 생성).
  function onFlowPage() { return location.pathname.indexOf('/tools/flow') !== -1 }

  async function tick() {
    if (!onFlowPage()) return
    // 작업 중에도 heartbeat 는 계속 보내(ready=0) 앱이 동시 탭 수를 정확히 통제하게 한다.
    const r = await send({ type: 'poll', source: 'flow', worker: WORKER_ID, ready: busy ? 0 : 1 })
    if (busy) return
    const job = r && r.job
    if (!job) return
    busy = true
    const report = (m) => { log(m); send({ type: 'job-status', id: job.id, status: 'progress', message: m }) }
    try {
      const url = await runViaMain(job, report)
      report('이미지 가져오는 중…')
      // Flow 이미지 URL 은 labs.google API→flow-content.google 로 리다이렉트되고 ACAO:* 라
      // content script fetch(credentials)로는 CORS 차단됨. host_permissions 가진 background 가
      // 대신 fetch(쿠키 포함, CORS 우회)해서 앱으로 보낸다.
      const r2 = await send({ type: 'image', source: 'flow', url, pageUrl: location.href })
      if (!r2 || !r2.ok) throw new Error((r2 && r2.error) || '앱 전송 실패')
      await send({ type: 'job-status', id: job.id, status: 'done', message: '완료' })
      log('완료')
    } catch (e) {
      const m = (e && e.message) || String(e)
      await send({ type: 'job-status', id: job.id, status: 'error', message: m })
      log('오류: ' + m)
    } finally {
      // 봇 감지 회피: 다음 생성까지 사람처럼 랜덤 간격(12~25초).
      const cooldown = 12000 + Math.floor(Math.random() * 13000)
      report('다음 생성까지 대기 ' + Math.round(cooldown / 1000) + '초…')
      await sleep(cooldown)
      busy = false
    }
  }

  setInterval(tick, 3000)
  log('TB MTOOL Flow 자동화 대기 시작')
})()
