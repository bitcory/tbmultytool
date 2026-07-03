import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ApiKeys,
  CoupangProduct,
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
  partners: {
    deeplink: (productUrl: string) => ipcRenderer.invoke(IPC.partnersDeeplink, productUrl),
    inpockPost: (payload) => ipcRenderer.invoke(IPC.inpockPost, payload)
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
    readImage: (p: string) => ipcRenderer.invoke(IPC.readImage, p),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    saveFileAs: (srcPath: string, defaultName: string) =>
      ipcRenderer.invoke(IPC.saveFileAs, srcPath, defaultName)
  },
  frames: {
    probe: (filePath: string) => ipcRenderer.invoke(IPC.framesProbe, filePath),
    extract: (filePath: string, timeSec: number) =>
      ipcRenderer.invoke(IPC.framesExtract, filePath, timeSec),
    prepare: (dataUrl: string) => ipcRenderer.invoke(IPC.framesPrepare, dataUrl)
  },
  bridge: {
    getInfo: () => ipcRenderer.invoke(IPC.bridgeInfo),
    list: () => ipcRenderer.invoke(IPC.bridgeList),
    importImage: (payload) => ipcRenderer.invoke(IPC.bridgeImport, payload),
    clear: () => ipcRenderer.invoke(IPC.bridgeClear),
    remove: (ids) => ipcRenderer.invoke(IPC.bridgeRemove, ids),
    generate: (source, prompt, referenceImages, aspect) =>
      ipcRenderer.invoke(IPC.bridgeGenerate, source, prompt, referenceImages, aspect),
    generateText: (prompt) => ipcRenderer.invoke(IPC.bridgeGenerateText, prompt),
    generateBlog: (payload) => ipcRenderer.invoke(IPC.bridgeGenerateBlog, payload),
    generateVideo: (prompt, imageDataUrl, settings) =>
      ipcRenderer.invoke(IPC.bridgeGenerateVideo, prompt, imageDataUrl, settings),
    generateRunway: (prompt, imageDataUrl, opts) =>
      ipcRenderer.invoke(IPC.bridgeGenerateRunway, prompt, imageDataUrl, opts),
    generateScroll: (spec) => ipcRenderer.invoke(IPC.bridgeGenerateScroll, spec),
    generateMusic: (payload) => ipcRenderer.invoke(IPC.bridgeGenerateMusic, payload),
    generateBatch: (source, items, aspect) =>
      ipcRenderer.invoke(IPC.bridgeGenerateBatch, source, items, aspect),
    generateFlowBatch: (prompts, assets, aspect) =>
      ipcRenderer.invoke(IPC.bridgeGenerateFlowBatch, prompts, assets, aspect),
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
    },
    onProduct: (cb: (product: CoupangProduct) => void) => {
      const listener = (_e: unknown, product: CoupangProduct) => cb(product)
      ipcRenderer.on(IPC.productImported, listener)
      return () => ipcRenderer.removeListener(IPC.productImported, listener)
    }
  },
  onProgress: (cb: (e: ProgressEvent) => void) => {
    const listener = (_e: unknown, ev: ProgressEvent) => cb(ev)
    ipcRenderer.on(IPC.progress, listener)
    return () => ipcRenderer.removeListener(IPC.progress, listener)
  },
  youtube: {
    search: (opts) => ipcRenderer.invoke(IPC.youtubeSearch, opts),
    analyzeChannel: (opts) => ipcRenderer.invoke(IPC.youtubeAnalyzeChannel, opts)
  },
  xhs: {
    search: (opts) => ipcRenderer.invoke(IPC.xhsSearch, opts),
    download: (url: string) => ipcRenderer.invoke(IPC.xhsDownload, url),
    onResults: (cb) => {
      const listener = (_e: unknown, cards: import('@shared/types').XhsCard[]) => cb(cards)
      ipcRenderer.on(IPC.xhsResults, listener)
      return () => ipcRenderer.removeListener(IPC.xhsResults, listener)
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
