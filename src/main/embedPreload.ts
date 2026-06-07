// 임베드 창(ChatGPT/Flow/Grok 등) 전용 preload.
// contextIsolation:false 라 이 스크립트는 페이지의 main world 에서, 페이지 스크립트보다
// 먼저 실행된다. 두 가지를 한다:
//   1) navigator.userAgentData 위장 — 진짜 Chrome 처럼 "Google Chrome" 브랜드 포함 +
//      버전을 실제 내장 Chromium 과 일치. (Cloudflare/Google 의 client-side 봇 검사가
//      읽는 값. 위장 안 하면 brands 에 Google Chrome 이 없어 Electron 으로 들통남)
//   2) __avsBridge 노출 — grabber 가 이미지를 앱으로 보내는 IPC 한 줄.
import { ipcRenderer } from 'electron'
import { IPC } from '@shared/types'

// ── 1) userAgentData 위장 ───────────────────────────────────────────────
try {
  const full = process.versions.chrome || '130.0.0.0'
  const major = full.split('.')[0]
  const platform =
    process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'
  const brands = [
    { brand: 'Chromium', version: major },
    { brand: 'Google Chrome', version: major },
    { brand: 'Not?A_Brand', version: '99' }
  ]
  const low = { brands, mobile: false, platform }
  const high = {
    ...low,
    architecture: 'x86',
    bitness: '64',
    model: '',
    platformVersion: platform === 'Windows' ? '15.0.0' : '14.0.0',
    uaFullVersion: full,
    fullVersionList: [
      { brand: 'Chromium', version: full },
      { brand: 'Google Chrome', version: full },
      { brand: 'Not?A_Brand', version: '99.0.0.0' }
    ],
    wow64: false
  }
  const fake = {
    brands,
    mobile: false,
    platform,
    getHighEntropyValues: (hints?: string[]) => {
      const out: Record<string, unknown> = { brands, mobile: false, platform }
      ;(hints || []).forEach((h) => {
        if (h in high) out[h] = (high as Record<string, unknown>)[h]
      })
      return Promise.resolve(out)
    },
    toJSON: () => low
  }
  Object.defineProperty(navigator, 'userAgentData', { get: () => fake, configurable: true })
} catch {
  /* userAgentData 미지원 환경이면 그냥 통과 */
}

// ── 2) 이미지 브릿지 노출 (main world 직접 할당) ──────────────────────────
;(window as unknown as { __avsBridge: unknown }).__avsBridge = {
  sendImage: (payload: { source?: string; dataUrl?: string; url?: string; pageUrl?: string }) =>
    ipcRenderer.invoke(IPC.bridgeImport, payload)
}
