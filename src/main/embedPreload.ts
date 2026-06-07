// 임베드 창(ChatGPT/Flow) 전용 최소 preload.
// 주입된 grabber 스크립트가 페이지 CSP에 막히지 않고 이미지를 앱으로 보내도록
// IPC 한 줄만 노출한다. (앱의 다른 기능은 노출하지 않음 = 제3자 사이트에 안전)
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'

contextBridge.exposeInMainWorld('__avsBridge', {
  sendImage: (payload: { source?: string; dataUrl?: string; url?: string; pageUrl?: string }) =>
    ipcRenderer.invoke(IPC.bridgeImport, payload)
})
