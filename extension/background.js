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

// ── 확장 자동 reload ──────────────────────────────────────────────────────
// 앱이 배포한 확장 버전(/ping 의 extVersion)이 현재 실행 버전보다 높으면 스스로 reload.
// 압축해제 확장은 디스크 변경을 못 느끼므로, 앱이 알려주는 버전을 기준으로 갱신한다.
const SITE_GLOBS = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
  'https://grok.com/*',
  'https://suno.com/*',
  'https://labs.google/*'
]
function isNewerVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x > y
  }
  return false
}
async function checkExtUpdate() {
  try {
    const base = await findApp()
    if (!base) return
    const r = await fetch(base + '/ping')
    const j = await r.json().catch(() => null)
    const latest = j && j.extVersion
    const current = chrome.runtime.getManifest().version
    if (!latest || !isNewerVersion(latest, current)) return
    // 열려있는 우리 사이트 탭들을 reload 예약 → 재시작 후 새 content script 주입.
    let ids = []
    try {
      const tabs = await chrome.tabs.query({ url: SITE_GLOBS })
      ids = tabs.map((t) => t.id).filter((id) => id != null)
    } catch (e) {}
    await chrome.storage.local.set({ __reloadTabs: ids })
    console.log('[AVS] 확장 업데이트 감지 ' + current + ' → ' + latest + ' · 자동 reload')
    chrome.runtime.reload()
  } catch (e) {}
}
// 재시작 직후: 직전에 예약된 탭들을 새로고침(orphan content script 교체).
chrome.storage.local
  .get('__reloadTabs')
  .then(({ __reloadTabs }) => {
    if (Array.isArray(__reloadTabs) && __reloadTabs.length) {
      chrome.storage.local.remove('__reloadTabs')
      for (const id of __reloadTabs) {
        try { chrome.tabs.reload(id) } catch (e) {}
      }
    }
  })
  .catch(() => {})
try {
  chrome.alarms.create('ext-update-check', { periodInMinutes: 1 })
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'ext-update-check') checkExtUpdate() })
} catch (e) {}
checkExtUpdate() // 시작 시 즉시 1회

function bytesToBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function urlToDataUrl(url) {
  // background(서비스워커) fetch 는 host_permissions origin 에 대해 CORS 우회 + 쿠키 전송 가능.
  // Flow 이미지(labs.google→flow-content.google 리다이렉트, 인증 필요)도 이 경로로 받는다.
  const r = await fetch(url, { credentials: 'include' })
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
        const params = new URLSearchParams({
          source: msg.source || '',
          worker: msg.worker || '',
          ready: String(msg.ready != null ? msg.ready : 1)
        })
        const r = await fetch(base + '/poll?' + params.toString())
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
          body: JSON.stringify({ id: msg.id, status: msg.status, message: msg.message, text: msg.text, imageId: msg.imageId })
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

// 작업용 탭 자동관리·코디네이터·하트비트는 제거됨.
// 이제 각 사이트 content script 가 직접 폴링하고(서버 takeJob 이 작업을 한 탭에만 분배),
// 폴링하는 탭이 없으면 앱이 진짜 크롬에서 사이트를 연다(shell.openExternal).
