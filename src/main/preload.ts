import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApiKeys,
  ElectronAPI,
  ImportedImage,
  ProgressEvent,
  Project,
  ProjectOptions,
  Scene
} from '@shared/types'
import { IPC } from '@shared/types'

const api: ElectronAPI = {
  getVersion: () => ipcRenderer.invoke(IPC.appVersion),
  getExtensionDir: () => ipcRenderer.invoke(IPC.appExtensionDir),
  keys: {
    getStatus: () => ipcRenderer.invoke(IPC.keysStatus),
    set: (keys: ApiKeys) => ipcRenderer.invoke(IPC.keysSet, keys),
    get: () => ipcRenderer.invoke(IPC.keysGet)
  },
  generate: {
    script: (opts: ProjectOptions) => ipcRenderer.invoke(IPC.genScript, opts),
    image: (scene: Scene, opts: ProjectOptions, outDir: string) =>
      ipcRenderer.invoke(IPC.genImage, scene, opts, outDir),
    tts: (scene: Scene, opts: ProjectOptions, outDir: string) =>
      ipcRenderer.invoke(IPC.genTts, scene, opts, outDir),
    render: (project: Project, outDir: string) => ipcRenderer.invoke(IPC.render, project, outDir)
  },
  fs: {
    selectOutputDir: () => ipcRenderer.invoke(IPC.selectOutputDir),
    openPath: (p: string) => ipcRenderer.invoke(IPC.openPath, p),
    openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
    openWindow: (url: string, title?: string) => ipcRenderer.invoke(IPC.openWindow, url, title),
    pickImage: () => ipcRenderer.invoke(IPC.pickImage),
    readImage: (p: string) => ipcRenderer.invoke(IPC.readImage, p)
  },
  bridge: {
    getInfo: () => ipcRenderer.invoke(IPC.bridgeInfo),
    list: () => ipcRenderer.invoke(IPC.bridgeList),
    clear: () => ipcRenderer.invoke(IPC.bridgeClear),
    remove: (ids) => ipcRenderer.invoke(IPC.bridgeRemove, ids),
    generate: (source, prompt, referenceImages, aspect) =>
      ipcRenderer.invoke(IPC.bridgeGenerate, source, prompt, referenceImages, aspect),
    generateVideo: (prompt, imageDataUrl, settings) =>
      ipcRenderer.invoke(IPC.bridgeGenerateVideo, prompt, imageDataUrl, settings),
    generateMusic: (payload) => ipcRenderer.invoke(IPC.bridgeGenerateMusic, payload),
    generateBatch: (source, items, aspect) =>
      ipcRenderer.invoke(IPC.bridgeGenerateBatch, source, items, aspect),
    exportZip: (items, defaultName) => ipcRenderer.invoke(IPC.bridgeExportZip, items, defaultName),
    cancel: () => ipcRenderer.invoke(IPC.bridgeCancel),
    onImported: (cb: (img: ImportedImage) => void) => {
      const listener = (_e: unknown, img: ImportedImage) => cb(img)
      ipcRenderer.on(IPC.imageImported, listener)
      return () => ipcRenderer.removeListener(IPC.imageImported, listener)
    },
    onProgress: (cb: (message: string) => void) => {
      const listener = (_e: unknown, message: string) => cb(message)
      ipcRenderer.on(IPC.bridgeProgress, listener)
      return () => ipcRenderer.removeListener(IPC.bridgeProgress, listener)
    }
  },
  onProgress: (cb: (e: ProgressEvent) => void) => {
    const listener = (_e: unknown, ev: ProgressEvent) => cb(ev)
    ipcRenderer.on(IPC.progress, listener)
    return () => ipcRenderer.removeListener(IPC.progress, listener)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
