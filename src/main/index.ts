import { app, BrowserWindow, shell } from 'electron'
import path from 'path'
import { autoUpdater } from 'electron-updater'
import { registerIpc } from './ipc'
import { startImageBridge } from './imageBridge'
import { IPC } from '@shared/types'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'TB MULTY TOOL',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // 외부 링크는 기본 브라우저로
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite: 개발 시 dev 서버 URL, 빌드 시 로컬 파일
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  registerIpc()
  createWindow()

  // 크롬 확장 → 앱 이미지 수신 서버 시작. 새 이미지가 오면 렌더러로 push.
  try {
    await startImageBridge((img) => {
      mainWindow?.webContents.send(IPC.imageImported, img)
    })
  } catch (err) {
    console.error('[imageBridge] 시작 실패:', err)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // 자동 업데이트: 패키징된 앱에서만 GitHub Releases를 확인해 새 버전을 받아옴.
  // (개발 모드 app.isPackaged === false 에서는 건너뜀)
  // macOS는 코드 서명이 없으면 자동 적용이 막혀 있어 사실상 Windows에서만 동작한다.
  if (app.isPackaged && process.platform === 'win32') {
    autoUpdater.autoDownload = true
    autoUpdater.on('error', (err) => console.error('[autoUpdater]', err))
    autoUpdater.on('update-available', (info) =>
      console.log('[autoUpdater] 새 버전 발견:', info.version)
    )
    autoUpdater.on('update-downloaded', (info) => {
      console.log('[autoUpdater] 다운로드 완료, 재시작 시 적용:', info.version)
      // 다음 재시작 때 조용히 설치. 즉시 적용하려면 autoUpdater.quitAndInstall() 사용.
    })
    autoUpdater.checkForUpdatesAndNotify().catch((err) =>
      console.error('[autoUpdater] 확인 실패:', err)
    )
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
