import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import type {
  ApiKeys,
  ImageSource,
  Project,
  ProjectOptions,
  Scene,
  VideoGenSettings,
  MusicGenPayload,
  MusicTrack
} from '@shared/types'
import { IPC } from '@shared/types'
import { keysStatus, loadKeys, saveKeys } from './secrets'
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
  setDebugEval,
  enqueueJob,
  setJobStatusListener,
  cancelAllJobs,
  setSiteOpener
} from './imageBridge'
import { grabberScript } from './injectGrabber'
import { deployExtension } from './extensionDeploy'
import { grokVideoScript } from './automateGrok'

// 소스별 임베드 창 추적 (자동화 명령을 보낼 대상)
const embedded = new Map<ImageSource, BrowserWindow>()

const SOURCE_URL: Record<'chatgpt' | 'flow' | 'grok' | 'suno', string> = {
  chatgpt: 'https://chatgpt.com/',
  flow: 'https://labs.google/fx/ko/tools/flow',
  grok: 'https://grok.com/imagine',
  suno: 'https://suno.com/create'
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
  ipcMain.handle(IPC.openPath, (_e, p: string) => shell.openPath(p).then(() => undefined))
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
  setSiteOpener((source) => {
    const url = (SOURCE_URL as Record<string, string>)[source]
    if (url) shell.openExternal(url)
  })
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
    ): Promise<{ ok: boolean; message?: string }> => {
      if (source !== 'chatgpt' && source !== 'flow') {
        return { ok: false, message: '현재 ChatGPT·Flow 이미지 생성만 지원합니다.' }
      }
      if (!prompt?.trim()) return { ok: false, message: '프롬프트를 입력하세요.' }
      console.log('[AVS] 이미지 생성 요청: source=' + source)

      // ChatGPT·Flow 모두 사용자 크롬의 확장에서 실행(임베드 창 봇벽/로그인 문제 회피).
      // 큐에 넣으면 확장이 진짜 크롬(로그인된 탭)에서 생성하고 결과를 갤러리로 보낸다.
      return await enqueueJob({
        source,
        prompt: prompt.trim(),
        aspect: aspect || '16:9',
        referenceImages: referenceImages || []
      })
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

      // ChatGPT·Flow 모두 각 프롬프트를 확장 작업 큐에 넣는다(임베드 창 봇벽/로그인 문제 회피).
      // 확장이 사용자 크롬(로그인된 탭)에서 워커 풀(최대 3탭)로 생성 → 결과는 onImported 로 갤러리에 도착.
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

  // 이미지들을 순서대로 zip 으로 저장 (생성 순서 보존: 01_, 02_ … 접두어)
  ipcMain.handle(
    IPC.bridgeExportZip,
    async (
      e,
      items: { path: string; name: string }[],
      defaultName?: string
    ): Promise<{ ok: boolean; path?: string; message?: string }> => {
      const list = (items || []).filter((it) => it && it.path)
      if (!list.length) return { ok: false, message: '저장할 이미지가 없습니다.' }
      const win = BrowserWindow.fromWebContents(e.sender) || undefined
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        defaultPath: (defaultName || 'images') + '.zip',
        filters: [{ name: 'Zip', extensions: ['zip'] }]
      })
      if (canceled || !filePath) return { ok: false }

      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'avszip-'))
      try {
        const copied: string[] = []
        for (let i = 0; i < list.length; i++) {
          const ext = path.extname(list[i].path) || '.png'
          const base = path.basename(list[i].name || 'image', path.extname(list[i].name || '')) || 'image'
          const safe = base.replace(/[^\w.-]/g, '_').slice(0, 40)
          const name = String(i + 1).padStart(2, '0') + '_' + safe + ext
          const dest = path.join(tmp, name)
          await fs.copyFile(list[i].path, dest)
          copied.push(dest)
        }
        await new Promise<void>((res, rej) =>
          execFile('zip', ['-j', '-q', filePath, ...copied], (err) => (err ? rej(err) : res()))
        )
        return { ok: true, path: filePath }
      } catch (err) {
        return { ok: false, message: 'zip 생성 실패: ' + ((err as Error)?.message || err) }
      } finally {
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
      }
    }
  )
}
