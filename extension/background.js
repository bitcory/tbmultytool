// 백그라운드 서비스워커 — content script가 보낸 이미지를 앱(로컬 서버)으로 전달.
// 앱 포트는 47321부터 자동 탐색(앱이 포트 충돌 시 다음 포트를 쓸 수 있어서).

const PORTS = Array.from({ length: 10 }, (_, i) => 47321 + i)
let appBase = null // 찾은 앱 주소 캐시

async function ping(base) {
  try {
    const r = await fetch(base + '/ping', { method: 'GET' })
    return r.ok
  } catch {
    return false
  }
}

async function findApp() {
  if (appBase && (await ping(appBase))) return appBase
  appBase = null
  for (const p of PORTS) {
    const base = `http://127.0.0.1:${p}`
    if (await ping(base)) {
      appBase = base
      return base
    }
  }
  return null
}

function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function urlToDataUrl(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error('이미지 다운로드 실패: ' + r.status)
  const blob = await r.blob()
  const buf = await blob.arrayBuffer()
  const mime = blob.type || 'image/png'
  return `data:${mime};base64,${bytesToBase64(new Uint8Array(buf))}`
}

async function sendToApp(msg) {
  const base = await findApp()
  if (!base) throw new Error('앱을 찾을 수 없습니다. TB MTOOL 앱이 실행 중인지 확인하세요.')

  let dataUrl = msg.dataUrl
  if (!dataUrl && msg.url) dataUrl = await urlToDataUrl(msg.url)
  if (!dataUrl) throw new Error('이미지 데이터가 없습니다')

  const res = await fetch(base + '/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: msg.source, dataUrl, pageUrl: msg.pageUrl })
  })
  const j = await res.json().catch(() => ({ ok: false, error: '응답 파싱 실패' }))
  if (!j.ok) throw new Error(j.error || '전송 실패')
  return j
}

// ── 우클릭 메뉴 (떠있는 버튼이 가려질 때를 대비한 확실한 경로) ──
function sourceFromUrl(url) {
  return url && url.includes('labs.google') ? 'flow' : 'chatgpt'
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'send-to-avs',
    title: '🎬 TB STUDY로 보내기',
    contexts: ['image'],
    documentUrlPatterns: [
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
      'https://labs.google/*'
    ]
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'send-to-avs' || !info.srcUrl) return
  const source = sourceFromUrl(tab?.url || info.pageUrl)
  // blob:/data: 는 background가 못 받으므로 content script에 위임
  if (info.srcUrl.startsWith('blob:') || info.srcUrl.startsWith('data:')) {
    if (tab?.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: 'grab', src: info.srcUrl, source })
    }
    return
  }
  sendToApp({ type: 'image', source, url: info.srcUrl, pageUrl: info.pageUrl }).catch((e) =>
    console.warn('[AVS] 전송 실패:', e)
  )
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 로그인 필요: 작업용 탭을 앞으로 띄워 사용자가 로그인하게 한다
  if (msg?.type === 'need-login') {
    try {
      const tabId = sender?.tab?.id
      const winId = sender?.tab?.windowId
      if (tabId != null) chrome.tabs.update(tabId, { active: true })
      if (winId != null) chrome.windows.update(winId, { focused: true })
    } catch (e) {}
    sendResponse({ ok: true })
    return true
  }
  // 이 탭이 해당 사이트의 작업용 탭인지 확인 (작업용 탭만 폴링/실행 → 사용자 탭 보호)
  if (msg?.type === 'is-worker') {
    ;(async () => {
      await loadWorkerTabs()
      const wid = workerTabs[msg.site]
      sendResponse({ worker: sender?.tab?.id != null && sender.tab.id === wid })
    })()
    return true
  }
  // 특정 사이트 작업용 탭 보장(ChatGPT 작업용 탭이 다른 사이트 작업 감지 시 요청)
  if (msg?.type === 'ensure-worker') {
    ensureWorkerTab(msg.site)
    sendResponse({ ok: true })
    return true
  }
  // 작업 대기 중인 소스 목록 (코디네이터 탭이 다른 사이트 탭을 띄울지 판단)
  if (msg?.type === 'pending-sources') {
    ;(async () => {
      try {
        const base = await findApp()
        if (!base) return sendResponse({ sources: [] })
        const r = await fetch(base + '/pending-sources')
        const j = await r.json().catch(() => ({ sources: [] }))
        sendResponse({ sources: j.sources || [] })
      } catch (e) {
        sendResponse({ sources: [] })
      }
    })()
    return true
  }
  if (msg?.type === 'image') {
    sendToApp(msg)
      .then((j) => sendResponse({ ok: true, id: j.id }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }))
    return true // 비동기 응답
  }
  if (msg?.type === 'status') {
    findApp()
      .then((base) => sendResponse({ ok: !!base, base }))
      .catch(() => sendResponse({ ok: false }))
    return true
  }
  // 앱에서 다음 생성 작업 가져오기 (content script 자동화 루프가 폴링)
  if (msg?.type === 'poll') {
    ;(async () => {
      try {
        const base = await findApp()
        if (!base) return sendResponse({ ok: false, job: null })
        const r = await fetch(base + '/poll?source=' + encodeURIComponent(msg.source || ''))
        const j = await r.json().catch(() => ({ ok: false }))
        sendResponse({ ok: !!j.ok, job: j.job || null })
      } catch (e) {
        sendResponse({ ok: false, job: null })
      }
    })()
    return true
  }
  // 실행 중인 작업이 취소됐는지 확인 (자동화 루프가 중간중간 폴링)
  if (msg?.type === 'check-cancel') {
    ;(async () => {
      try {
        const base = await findApp()
        if (!base) return sendResponse({ canceled: false })
        const r = await fetch(base + '/job-canceled?id=' + encodeURIComponent(msg.id || ''))
        const j = await r.json().catch(() => ({ canceled: false }))
        sendResponse({ canceled: !!j.canceled })
      } catch (e) {
        sendResponse({ canceled: false })
      }
    })()
    return true
  }
  // 작업 진행/완료/실패 보고를 앱으로 중계
  if (msg?.type === 'job-status') {
    ;(async () => {
      try {
        const base = await findApp()
        if (!base) return sendResponse({ ok: false })
        await fetch(base + '/job-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: msg.id, status: msg.status, message: msg.message })
        })
        sendResponse({ ok: true })
      } catch (e) {
        sendResponse({ ok: false })
      }
    })()
    return true
  }
  return false
})

// ── 작업용 탭 자동관리 (사이트별) ───────────────────────────────────────────
// 앱이 실행 중이면 사이트별 "작업용 탭"(백그라운드·고정)을 띄운다.
// 그 탭의 content script 만 자동화를 돌린다(사용자가 직접 쓰는 탭엔 끼어들지 않음).
// ChatGPT 탭은 상시 유지(하트비트). 그 탭이 /pending-sources 를 보고 다른 사이트 탭을 요청.
const SITE_URLS = {
  chatgpt: 'https://chatgpt.com/',
  grok: 'https://grok.com/imagine'
}

let workerTabs = {} // { chatgpt: tabId, grok: tabId, ... }  (SW 재시작 대비 storage.session 저장)
async function loadWorkerTabs() {
  if (workerTabs && Object.keys(workerTabs).length) return workerTabs
  try {
    const s = await chrome.storage.session.get('workerTabs')
    workerTabs = s?.workerTabs || {}
  } catch (e) {}
  return workerTabs
}
async function saveWorkerTabs() {
  try {
    await chrome.storage.session.set({ workerTabs })
  } catch (e) {}
}

async function ensureWorkerTab(site) {
  const url = SITE_URLS[site]
  if (!url) return
  try {
    const base = await findApp()
    if (!base) return // 앱이 꺼져 있으면 탭 안 띄움(불필요한 탭 방지)
    await loadWorkerTabs()
    const id = workerTabs[site]
    if (id != null) {
      const existing = await chrome.tabs.get(id).catch(() => null)
      if (existing) return // 살아있음
    }
    const tab = await chrome.tabs.create({ url, active: false, pinned: true })
    workerTabs[site] = tab.id
    await saveWorkerTabs()
    console.log('[AVS] ' + site + ' 작업용 탭 생성 id=' + tab.id)
  } catch (e) {
    console.warn('[AVS] ' + site + ' 작업용 탭 생성 실패:', e)
  }
}

// 작업용 탭이 닫히면 해당 사이트 id 비움(다음 점검/요청에 재생성)
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await loadWorkerTabs()
  let changed = false
  for (const s of Object.keys(workerTabs)) {
    if (workerTabs[s] === tabId) {
      delete workerTabs[s]
      changed = true
    }
  }
  if (changed) await saveWorkerTabs()
})

// ChatGPT 작업용 탭은 상시 유지(다른 사이트는 ChatGPT 탭이 작업 감지 시 요청)
function ensureHeartbeatTab() {
  ensureWorkerTab('chatgpt')
}
chrome.runtime.onInstalled.addListener(ensureHeartbeatTab)
chrome.runtime.onStartup.addListener(ensureHeartbeatTab)
chrome.alarms.create('ensure-worker-tab', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'ensure-worker-tab') ensureHeartbeatTab()
})
ensureHeartbeatTab()
