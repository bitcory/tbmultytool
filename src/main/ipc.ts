import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { writeZip } from './zip'
import type {
  ApiKeys,
  BlogPostPayload,
  BridgeJobResult,
  ImageSource,
  InpockPostPayload,
  Project,
  ProjectOptions,
  Scene,
  VideoGenSettings,
  MusicGenPayload,
  MusicTrack,
  ScrollRenderSpec
} from '@shared/types'
import { IPC } from '@shared/types'
import { keysStatus, loadKeys, saveKeys } from './secrets'
import { createPartnersDeeplink } from './services/partners'
import { generateScript } from './services/script'
import { generateImage } from './services/image'
import { generateTts } from './services/tts'
import { renderVideo } from './services/render'
import {
  getBridgeInfo,
  listImported,
  clearImported,
  removeImported,
  importImage,
  importLocalFile,
  setDebugEval,
  enqueueJob,
  setJobStatusListener,
  cancelAllJobs,
  setSiteOpener,
  setXhsResultsListener
} from './imageBridge'
import { downloadNote as xhsDownloadNote } from './services/xiaohongshu'
import { grabberScript } from './injectGrabber'
import { deployExtension } from './extensionDeploy'
import { grokVideoScript } from './automateGrok'
import { renderScrollVideo } from './services/scrollVideo'
import { youtubeSearch, analyzeChannel, youtubeQuota } from './services/youtube'
import { probeVideo, extractFrame, materializeVideo } from './frames'
import type { YoutubeSearchOpts, YoutubeChannelOpts, XhsSearchOpts } from '@shared/types'

// 소스별 임베드 창 추적 (자동화 명령을 보낼 대상)
const embedded = new Map<ImageSource, BrowserWindow>()

const SOURCE_URL: Record<'chatgpt' | 'flow' | 'grok' | 'suno' | 'flowbatch' | 'runway' | 'xiaohongshu' | 'inpock', string> = {
  chatgpt: 'https://chatgpt.com/',
  flow: 'https://labs.google/fx/ko/tools/flow',
  grok: 'https://grok.com/imagine',
  suno: 'https://suno.com/create',
  flowbatch: 'https://labs.google/fx/ko/tools/flow', // Flow 엔진(한 탭 파이프라인) 배치
  runway: 'https://app.runway.com/', // Runway Seedance 2.0
  xiaohongshu: 'https://www.xiaohongshu.com/explore', // 샤오홍슈 소스찾기(확장이 검색 페이지로 이동)
  inpock: 'https://link.inpock.co.kr/admin/block/link/post' // 인포크링크 링크블록 등록 폼(확장이 채움)
}

function sourceForUrl(url: string): ImageSource {
  if (url.includes('labs.google')) return 'flow'
  if (url.includes('grok.com')) return 'grok'
  return 'chatgpt'
}

// Electron/앱 식별자를 제거한 깨끗한 Chrome UA (Google Flow 등 자동화 탐지/크래시 회피).
// 버전·플랫폼을 실제값과 일치시킨다 — 윈도우에서 Mac UA를 보내면(플랫폼 거짓말) 봇 탐지에 걸린다.
const CHROME_FULL = process.versions.chrome || '130.0.0.0'
const CLEAN_UA =
  process.platform === 'win32'
    ? `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36`
    : process.platform === 'darwin'
      ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36`
      : `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36`

// 렌더러(메인 창)로 진행 상황 전달 — 임베드 창이 아닌 창들에 보냄
function emitProgress(message: string): void {
  const embeds = new Set(embedded.values())
  for (const w of BrowserWindow.getAllWindows()) {
    if (!embeds.has(w) && !w.isDestroyed()) w.webContents.send(IPC.bridgeProgress, message)
  }
}

// 자동화로 크롬 탭을 연 직후, 앱(웹앱) 창을 다시 앞으로 — 크롬이 앱을 가리지 않게.
function focusApp(): void {
  try {
    app.focus({ steal: true })
  } catch (e) {}
  const embeds = new Set(embedded.values())
  for (const w of BrowserWindow.getAllWindows()) {
    if (!embeds.has(w) && !w.isDestroyed()) {
      try {
        w.focus()
      } catch (e) {}
      break
    }
  }
}

// 임베드 창을 열거나(있으면 재사용) 포커스. grabber 주입 + 콘솔 로그 연결.
// hidden=true 면 화면에 띄우지 않고 백그라운드로 실행(자동 생성용).
function openEmbedded(url: string, title?: string, hidden = false): BrowserWindow {
  const source = sourceForUrl(url)
  const existing = embedded.get(source)
  if (existing && !existing.isDestroyed()) {
    if (!hidden) {
      existing.show()
      existing.focus()
    }
    return existing
  }
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    title: title ?? '',
    show: !hidden,
    autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:embedded',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload(embed.js)가 모듈을 로드하려면 필요
      backgroundThrottling: false, // 숨김 창에서도 자동화 타이머가 느려지지 않게
      preload: path.join(__dirname, '../preload/embed.js')
    }
  })
  win.webContents.setUserAgent(CLEAN_UA) // Electron UA 숨김 (Flow 크래시 회피)
  embedded.set(source, win)
  win.on('closed', () => {
    if (embedded.get(source) === win) embedded.delete(source)
  })
  const inject = (): void => {
    const { port } = getBridgeInfo()
    win.webContents.executeJavaScript(grabberScript(port)).catch(() => {})
  }
  win.webContents.on('did-finish-load', inject)
  win.webContents.on('console-message', (_e, _lvl, msg) => {
    // 자동 생성 진행 로그는 렌더러로 전달(앱 카드에 표시) + 메인 로그(디버그)
    if (msg.includes('[AVS-GEN]')) {
      console.log('[embed]', msg)
      emitProgress(msg.replace(/^.*\[AVS-GEN\]\s*/, ''))
    }
  })
  win.loadURL(url)
  return win
}

export function registerIpc(): void {
  // 디버그: 임베드 창에서 JS 실행 / CDP 진짜 클릭 (로컬 /debug 라우트용)
  setDebugEval(async (target, js) => {
    const win = embedded.get(target as ImageSource)
    if (!win || win.isDestroyed()) return { error: 'no window for ' + target }
    if (js.startsWith('CDPCLICK:')) {
      const [x, y] = js.slice(9).split(',').map(Number)
      const dbg = win.webContents.debugger
      try {
        if (!dbg.isAttached()) dbg.attach('1.3')
      } catch (e) {
        /* already attached */
      }
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
      return { cdpClicked: [x, y] }
    }
    return await win.webContents.executeJavaScript(js)
  })

  // --- 앱 정보 ---
  ipcMain.handle(IPC.appVersion, () => app.getVersion())
  ipcMain.handle(IPC.appExtensionDir, () => deployExtension())

  // --- API 키 ---
  ipcMain.handle(IPC.keysStatus, () => keysStatus())
  ipcMain.handle(IPC.keysGet, () => loadKeys())
  ipcMain.handle(IPC.keysSet, (_e, keys: ApiKeys) => saveKeys(keys))

  // --- 쿠팡파트너스 제휴 단축링크 발급 (Open API) ---
  ipcMain.handle(IPC.partnersDeeplink, (_e, productUrl: string) => createPartnersDeeplink(productUrl))

  // --- 인포크링크 링크블록 자동 게시 (확장이 link.inpock.co.kr 관리자에서 등록) ---
  ipcMain.handle(IPC.inpockPost, async (_e, payload: InpockPostPayload): Promise<BridgeJobResult> => {
    if (!payload?.url?.trim()) return { ok: false, message: '연결할 링크(제휴링크)가 없습니다.' }
    if (!payload?.title?.trim()) return { ok: false, message: '타이틀(제품명)이 없습니다.' }
    if (!payload?.imageDataUrl) return { ok: false, message: '썸네일 이미지가 없습니다. 상품을 먼저 분석하세요.' }
    return await enqueueJob({ source: 'inpock', kind: 'inpock', prompt: payload.title, inpockPayload: payload })
  })

  // --- 생성 파이프라인 ---
  ipcMain.handle(IPC.genScript, (_e, opts: ProjectOptions) => generateScript(opts))
  ipcMain.handle(IPC.genImage, (_e, scene: Scene, opts: ProjectOptions, outDir: string) =>
    generateImage(scene, opts, outDir)
  )
  ipcMain.handle(IPC.genTts, (_e, scene: Scene, opts: ProjectOptions, outDir: string) =>
    generateTts(scene, opts, outDir)
  )
  ipcMain.handle(IPC.render, (e, project: Project, outDir: string) => {
    const sender = e.sender
    return renderVideo(project, outDir, (ev) => sender.send(IPC.progress, ev))
  })

  // --- 파일시스템 ---
  ipcMain.handle(IPC.selectOutputDir, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  // '@downloads' = 시스템 다운로드 폴더 별칭 (카드뉴스 PNG 가 떨어지는 기본 위치)
  ipcMain.handle(IPC.openPath, (_e, p: string) =>
    shell.openPath(p === '@downloads' ? app.getPath('downloads') : p).then(() => undefined)
  )
  ipcMain.handle(IPC.openExternal, (_e, url: string) => shell.openExternal(url))

  // URL을 임베드 창으로 연다(이미지 잡기 grabber 주입). 로그인 유지를 위해 persist 파티션.
  ipcMain.handle(IPC.openWindow, (_e, url: string, title?: string) => {
    openEmbedded(url, title)
  })

  // 이미지 파일 선택 (Flow 등에서 저장한 이미지를 앱으로 가져오기)
  ipcMain.handle(IPC.pickImage, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })

  // 로컬 파일을 사용자가 고른 위치로 저장 (스크롤영상 등 내보내기)
  ipcMain.handle(
    IPC.saveFileAs,
    async (e, srcPath: string, defaultName: string): Promise<{ ok: boolean; path?: string }> => {
      const win = BrowserWindow.fromWebContents(e.sender) || undefined
      const ext = path.extname(srcPath) || '.mp4'
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        defaultPath: defaultName.endsWith(ext) ? defaultName : defaultName + ext
      })
      if (canceled || !filePath) return { ok: false }
      await fs.copyFile(srcPath, filePath)
      return { ok: true, path: filePath }
    }
  )

  // --- 프레임 추출기 (ffmpeg) ---
  ipcMain.handle(IPC.framesProbe, (_e, filePath: string) => probeVideo(filePath))
  ipcMain.handle(IPC.framesExtract, (_e, filePath: string, timeSec: number) =>
    extractFrame(filePath, timeSec)
  )
  ipcMain.handle(IPC.framesPrepare, (_e, dataUrl: string) => materializeVideo(dataUrl))

  // 로컬 미디어(이미지/영상) → data URL (렌더러 미리보기용)
  ipcMain.handle(IPC.readImage, async (_e, p: string) => {
    const buf = await fs.readFile(p)
    const ext = path.extname(p).slice(1).toLowerCase()
    const VIDEO: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }
    const mime = VIDEO[ext] ?? `image/${ext === 'jpg' ? 'jpeg' : ext}`
    return `data:${mime};base64,${buf.toString('base64')}`
  })

  // --- 이미지 브릿지 (확장 ↔ 앱) ---
  // 확장 작업(job) 진행 메시지를 렌더러로 전달
  setJobStatusListener(emitProgress)
  // 작업이 들어왔는데 해당 사이트 탭이 없으면 진짜 크롬에서 사이트를 연다(확장이 거기서 처리).
  // activate:false → 브라우저를 앞으로 끌어오지 않고 뒤에서 열어 앱 포커스를 유지(macOS).
  setSiteOpener((source) => {
    const url = (SOURCE_URL as Record<string, string>)[source]
    if (url) {
      // activate:false → 브라우저를 앞으로 끌어오지 않음(자동화 창은 뒤에서 열림)
      shell.openExternal(url, { activate: false })
      // 혹시 크롬이 앞으로 튀어나오면, 잠시 후 앱 창을 다시 앞으로
      setTimeout(focusApp, 500)
    }
  })
  // 샤오홍슈 검색결과(확장 스크래퍼) → 모든 렌더러로 전달
  setXhsResultsListener((cards) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(IPC.xhsResults, cards)
    }
  })
  // 샤오홍슈 검색 작업을 확장에 전달(크롬 샤오홍슈에서 스크래핑)
  ipcMain.handle(IPC.xhsSearch, async (_e, opts: XhsSearchOpts): Promise<{ ok: boolean; message?: string }> => {
    const kw = (opts?.keyword || '').trim()
    if (!kw) return { ok: false, message: '검색어를 입력하세요.' }
    const r = await enqueueJob({ source: 'xiaohongshu', kind: 'search', prompt: kw, xhsSearch: { ...opts, keyword: kw } })
    return { ok: !!r.ok, message: r.message }
  })
  // 샤오홍슈 노트 미디어(영상/이미지) 다운로드
  ipcMain.handle(IPC.xhsDownload, async (_e, url: string) => xhsDownloadNote(url))

  ipcMain.handle(IPC.bridgeInfo, () => getBridgeInfo())
  ipcMain.handle(IPC.bridgeList, () => listImported())
  ipcMain.handle(IPC.bridgeClear, () => clearImported())
  ipcMain.handle(IPC.bridgeRemove, (_e, ids: string[]) => removeImported(ids))
  // 임베드 창의 grabber가 IPC로 직접 이미지를 보냄 (페이지 CSP 우회)
  ipcMain.handle(IPC.bridgeImport, (_e, payload) => importImage(payload))
  // 정지 버튼: 진행/대기 중인 확장 생성 작업 전체 취소
  ipcMain.handle(IPC.bridgeCancel, () => cancelAllJobs())

  // 임베드 창 자동화: 프롬프트 입력 → 생성 → 자동 회수 (실험적)
  ipcMain.handle(
    IPC.bridgeGenerate,
    async (
      _e,
      source: ImageSource,
      prompt: string,
      referenceImages?: string[],
      aspect?: string
    ): Promise<BridgeJobResult> => {
      if (source !== 'chatgpt' && source !== 'flow') {
        return { ok: false, message: '현재 ChatGPT·Flow 이미지 생성만 지원합니다.' }
      }
      if (!prompt?.trim()) return { ok: false, message: '프롬프트를 입력하세요.' }
      console.log('[AVS] 이미지 생성 요청: source=' + source)

      // Flow 는 flowbatch(신형 한 탭 파이프라인)로 변환 — 구형 flow.js 폴링 경로는 끊겨 있음(위 batch 참조).
      if (source === 'flow') {
        const refs = referenceImages || []
        const assets = refs.map((u, i) => ({ name: 'r' + (i + 1), dataUrl: u }))
        const tokens = assets.map((a) => `@[${a.name}]`).join(' ')
        const p = tokens ? `${tokens} ${prompt.trim()}` : prompt.trim()
        return await enqueueJob({
          source: 'flowbatch',
          prompt: p,
          prompts: [p],
          aspect: aspect || '16:9',
          assets
        })
      }

      // ChatGPT 는 사용자 크롬의 확장에서 실행(임베드 창 봇벽/로그인 문제 회피).
      // 큐에 넣으면 확장이 진짜 크롬(로그인된 탭)에서 생성하고 결과를 갤러리로 보낸다.
      return await enqueueJob({
        source,
        prompt: prompt.trim(),
        aspect: aspect || '16:9',
        referenceImages: referenceImages || []
      })
    }
  )

  // ChatGPT 텍스트 생성: 프롬프트 전송 → 응답 코드블록 내용 회수 (카드뉴스 자동화용)
  ipcMain.handle(
    IPC.bridgeGenerateText,
    async (_e, prompt: string): Promise<BridgeJobResult> => {
      if (!prompt?.trim()) return { ok: false, message: '프롬프트를 입력하세요.' }
      console.log('[AVS] 텍스트 생성 요청 (chatgpt)')
      return await enqueueJob({ source: 'chatgpt', kind: 'text', prompt: prompt.trim() })
    }
  )

  // 티스토리 블로그 발행: 블로그 확장이 티스토리 에디터 탭에서 작업을 가져가 주입.
  // (사용자가 티스토리 글쓰기 페이지를 열어두고 블로그 확장이 설치돼 있어야 함)
  ipcMain.handle(
    IPC.bridgeGenerateBlog,
    async (_e, payload: BlogPostPayload): Promise<BridgeJobResult> => {
      if (!payload?.title?.trim()) return { ok: false, message: '제목이 비어 있습니다.' }
      console.log('[AVS] 블로그 발행 요청 (tistory)')
      return await enqueueJob({ source: 'tistory', kind: 'blog', prompt: payload.title.trim(), blogPayload: payload })
    }
  )

  // Grok 이미지→영상 자동화 (백그라운드 숨김 창)
  ipcMain.handle(
    IPC.bridgeGenerateVideo,
    async (
      _e,
      prompt: string,
      imageDataUrl: string,
      settings?: VideoGenSettings
    ): Promise<{ ok: boolean; message?: string }> => {
      // 이미지 없이 텍스트(T2V)도 허용 — 프롬프트나 이미지 중 하나는 필요.
      if (!imageDataUrl && !prompt?.trim()) {
        return { ok: false, message: '프롬프트 또는 이미지를 입력하세요.' }
      }
      // 사용자 크롬의 확장에서 실행(임베드 창 봇벽 회피). 큐에 넣고 결과를 기다린다.
      return await enqueueJob({
        source: 'grok',
        prompt: prompt || '',
        imageDataUrl: imageDataUrl || '',
        videoSettings: settings || {}
      })

      const win = openEmbedded(SOURCE_URL.grok, 'Grok', true)
      win.webContents.setAudioMuted(true) // 숨김 자동화 창 소리 차단
      // 반드시 /imagine 에서 시작 (영상/이미지 생성 진입점)
      if (!win.webContents.getURL().includes('/imagine')) {
        win.webContents.loadURL(SOURCE_URL.grok)
      }
      if (win.webContents.isLoadingMainFrame()) {
        await new Promise<void>((res) => win.webContents.once('did-finish-load', () => res()))
      }
      await new Promise((res) => setTimeout(res, 1500)) // SPA 초기화 여유
      await win.webContents
        .executeJavaScript(grokVideoScript(prompt, imageDataUrl, settings || {}))
        .catch((e) => {
          console.error('[AVS] Grok 자동화 주입 오류:', e)
        })
      return { ok: true }
    }
  )

  // 스크롤영상 생성 (앱 내부 ffmpeg, 확장 불필요). 렌더러 Canvas 사양 → 합성 → 갤러리로 import.
  ipcMain.handle(
    IPC.bridgeGenerateScroll,
    async (
      _e,
      spec: ScrollRenderSpec
    ): Promise<{ ok: boolean; message?: string; imageId?: string }> => {
      try {
        const out = await renderScrollVideo(spec, emitProgress)
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')
        const img = await importLocalFile(out, 'scroll', `scroll-${stamp}.mp4`)
        await fs.rm(out, { force: true }).catch(() => {}) // 브릿지가 복사했으니 임시 출력 삭제
        emitProgress('스크롤영상 완료')
        return { ok: true, imageId: img.id }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[AVS] 스크롤영상 생성 실패:', message)
        return { ok: false, message: '스크롤영상 생성 실패: ' + message }
      }
    }
  )

  // SUNO 음악 생성 자동화 (백그라운드 숨김 창). 2곡 생성 → mp3 회수 → import
  ipcMain.handle(
    IPC.bridgeGenerateMusic,
    async (
      _e,
      payload: MusicGenPayload
    ): Promise<{ ok: boolean; message?: string; tracks?: MusicTrack[] }> => {
      // 사용자 크롬의 확장에서 실행(임베드 창 봇벽 회피). 결과 mp3 는 onImported(오디오)로 도착.
      return await enqueueJob({ source: 'suno', prompt: '', musicPayload: payload })
    }
  )

  // 배치 이미지 생성 (T2I/I2I) — 프롬프트 N개 → 창 N개 → 이미지 N장 병렬 생성.
  // items[i] = { prompt, image? }  (image = I2I 첨부 dataUrl)
  ipcMain.handle(
    IPC.bridgeGenerateBatch,
    async (
      _e,
      source: ImageSource,
      items: { prompt: string; images?: string[] }[],
      aspect?: string
    ): Promise<{ ok: boolean; count?: number; message?: string }> => {
      if (source !== 'chatgpt' && source !== 'flow') {
        return { ok: false, message: 'ChatGPT 또는 Flow 만 지원합니다.' }
      }
      const list = (items || []).filter((it) => it && it.prompt && it.prompt.trim())
      if (!list.length) return { ok: false, message: '프롬프트가 없습니다.' }

      // Flow 는 flowbatch(신형 한 탭 파이프라인) 잡 하나로 변환해 처리.
      // 구형 flow.js 경로는 manifest 가 labs.google/fx/* 를 제외해 폴링 주체가 없다(잡이 영원히 대기).
      // I2I 참조 이미지는 flowengine 의 @[name] 에셋 규약으로 매핑 — 같은 dataUrl 은 한 번만 업로드.
      if (source === 'flow') {
        const assets: { name: string; dataUrl: string }[] = []
        const nameByUrl = new Map<string, string>()
        const prompts = list.map((item) => {
          const tokens = (item.images || [])
            .map((u) => {
              let name = nameByUrl.get(u)
              if (!name) {
                name = 'r' + (nameByUrl.size + 1)
                nameByUrl.set(u, name)
                assets.push({ name, dataUrl: u })
              }
              return `@[${name}]`
            })
            .join(' ')
          return tokens ? `${tokens} ${item.prompt.trim()}` : item.prompt.trim()
        })
        enqueueJob({
          source: 'flowbatch',
          prompt: prompts[0],
          prompts,
          aspect: aspect || '16:9',
          assets
        }).catch(() => {})
        return { ok: true, count: prompts.length }
      }

      // ChatGPT 는 각 프롬프트를 개별 잡으로 큐잉(임베드 창 봇벽/로그인 문제 회피).
      // 확장이 사용자 크롬(로그인된 탭)에서 워커 풀로 생성 → 결과는 onImported 로 갤러리에 도착.
      list.forEach((item) => {
        enqueueJob({
          source,
          prompt: item.prompt.trim(),
          aspect: aspect || '16:9',
          referenceImages: item.images && item.images.length ? item.images : []
        }).catch(() => {})
      })
      return { ok: true, count: list.length }
    }
  )

  // Flow 엔진 배치 — 프롬프트 배열 1개를 단일 'flowbatch' 작업으로 큐잉.
  // 확장의 fe-controller 가 Flow 탭 하나에서 START_BATCH 로 파이프라인 생성, 결과는 onImported(source 'flow').
  ipcMain.handle(
    IPC.bridgeGenerateFlowBatch,
    async (
      _e,
      prompts: string[],
      assets?: { name: string; dataUrl: string }[],
      aspect?: string
    ): Promise<{ ok: boolean; message?: string }> => {
      const list = (prompts || []).map((p) => (p || '').trim()).filter(Boolean)
      if (!list.length) return { ok: false, message: '프롬프트가 없습니다.' }
      const r = await enqueueJob({
        source: 'flowbatch',
        prompt: list[0],
        prompts: list,
        aspect: aspect || '9:16',
        assets: assets && assets.length ? assets : []
      })
      return { ok: !!r.ok, message: r.message }
    }
  )

  // Runway(Seedance 2.0) i2v — 'runway' 작업 큐잉. 확장 re-controller 가 처리, 결과는 onImported(source 'grok').
  ipcMain.handle(
    IPC.bridgeGenerateRunway,
    async (
      _e,
      prompt: string,
      imageDataUrl: string,
      opts?: { aspect?: string; duration?: string }
    ): Promise<{ ok: boolean; message?: string }> => {
      if (!imageDataUrl) return { ok: false, message: '이미지가 필요합니다.' }
      const ratio = opts?.aspect === '16:9' ? '16:9' : '9:16' // Seedance 는 9:16 / 16:9
      const r = await enqueueJob({
        source: 'runway',
        prompt: prompt || '',
        imageDataUrl,
        aspect: ratio,
        duration: opts?.duration || '5'
      })
      return { ok: !!r.ok, message: r.message }
    }
  )

  // 유튜브 분석기 — YouTube Data API 로 검색 + 통계/구독자 + 지표 계산
  ipcMain.handle(IPC.youtubeSearch, async (_e, opts: YoutubeSearchOpts) => {
    try {
      const items = await youtubeSearch(opts)
      return { ok: true, items, quotaUsed: youtubeQuota() }
    } catch (err) {
      return { ok: false, message: String(err instanceof Error ? err.message : err) }
    }
  })

  // 유튜브 채널 상세 분석 (등급/수익/참여/업로드 패턴)
  ipcMain.handle(IPC.youtubeAnalyzeChannel, async (_e, opts: YoutubeChannelOpts) => {
    try {
      const analysis = await analyzeChannel(opts)
      return { ok: true, analysis }
    } catch (err) {
      return { ok: false, message: String(err instanceof Error ? err.message : err) }
    }
  })

  // 이미지들을 순서대로 zip 으로 저장 (생성 순서 보존: 01_, 02_ … 접두어).
  // path(로컬 파일) 또는 dataUrl(카드뉴스 PNG 등 메모리 생성 이미지) 둘 다 지원.
  ipcMain.handle(
    IPC.bridgeExportZip,
    async (
      e,
      items: { path?: string; dataUrl?: string; name: string }[],
      defaultName?: string
    ): Promise<{ ok: boolean; path?: string; message?: string }> => {
      const list = (items || []).filter((it) => it && (it.path || it.dataUrl))
      if (!list.length) return { ok: false, message: '저장할 이미지가 없습니다.' }
      const win = BrowserWindow.fromWebContents(e.sender) || undefined
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        defaultPath: (defaultName || 'images') + '.zip',
        filters: [{ name: 'Zip', extensions: ['zip'] }]
      })
      if (canceled || !filePath) return { ok: false }

      const MIME_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }
      try {
        // 메모리에 엔트리를 모아 자체 ZIP 작성기로 저장 (외부 zip CLI 없음 → 윈도우 호환)
        const entries: { name: string; data: Buffer }[] = []
        for (let i = 0; i < list.length; i++) {
          const it = list[i]
          let ext: string
          let data: Buffer
          if (it.dataUrl) {
            const m = /^data:([^;]+);base64,(.*)$/s.exec(it.dataUrl)
            if (!m) continue
            ext = MIME_EXT[m[1].toLowerCase()] || '.png'
            data = Buffer.from(m[2], 'base64')
          } else {
            ext = path.extname(it.path!) || '.png'
            data = await fs.readFile(it.path!)
          }
          const base = path.basename(it.name || 'image', path.extname(it.name || '')) || 'image'
          const safe = base.replace(/[^\w.-]/g, '_').slice(0, 40)
          entries.push({ name: String(i + 1).padStart(2, '0') + '_' + safe + ext, data })
        }
        await writeZip(filePath, entries)
        return { ok: true, path: filePath }
      } catch (err) {
        return { ok: false, message: 'zip 생성 실패: ' + ((err as Error)?.message || err) }
      }
    }
  )
}
