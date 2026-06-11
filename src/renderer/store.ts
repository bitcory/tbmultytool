import { create } from 'zustand'
import type { ImportedImage, ProjectOptions, Scene } from '@shared/types'

const defaultOptions: ProjectOptions = {
  topic: '',
  channelName: '',
  language: 'ko',
  aspect: '16:9',
  sceneCount: 5,
  scriptProvider: 'anthropic',
  ttsProvider: 'openai',
  ttsVoice: 'alloy',
  imageProvider: 'fal',
  imageStyle: 'cinematic, high detail, soft lighting'
}

export type View = 'home' | 'imagegen' | 'videogen' | 'musicgen' | 'cardnews' | 'wizard' | 'gallery' | 'gallerygrid' | 'settings'
export type Step = 0 | 1 | 2 | 3 // 준비 / 대본 / 자산 / 렌더

interface AppState {
  view: View
  step: Step
  options: ProjectOptions
  scenes: Scene[]
  title: string
  outDir: string | null
  videoPath: string | null
  busy: boolean
  log: string[]
  images: ImportedImage[] // 확장에서 가져온 이미지

  setView: (v: View) => void
  setStep: (s: Step) => void
  setOptions: (o: Partial<ProjectOptions>) => void
  setScenes: (s: Scene[]) => void
  updateScene: (id: string, patch: Partial<Scene>) => void
  setTitle: (t: string) => void
  setOutDir: (d: string | null) => void
  setVideoPath: (p: string | null) => void
  setBusy: (b: boolean) => void
  addLog: (m: string) => void
  setImages: (imgs: ImportedImage[]) => void
  addImage: (img: ImportedImage) => void
  removeImages: (ids: string[]) => void
  clearImages: () => void
  reset: () => void
}

export const useStore = create<AppState>((set) => ({
  view: 'home',
  step: 0,
  options: defaultOptions,
  scenes: [],
  title: '',
  outDir: null,
  videoPath: null,
  busy: false,
  log: [],
  images: [],

  setView: (view) => set({ view }),
  setStep: (step) => set({ step }),
  setOptions: (o) => set((s) => ({ options: { ...s.options, ...o } })),
  setScenes: (scenes) => set({ scenes }),
  updateScene: (id, patch) =>
    set((s) => ({ scenes: s.scenes.map((sc) => (sc.id === id ? { ...sc, ...patch } : sc)) })),
  setTitle: (title) => set({ title }),
  setOutDir: (outDir) => set({ outDir }),
  setVideoPath: (videoPath) => set({ videoPath }),
  setBusy: (busy) => set({ busy }),
  addLog: (m) => set((s) => ({ log: [...s.log.slice(-200), m] })),
  setImages: (images) => set({ images }),
  addImage: (img) => set((s) => ({ images: [img, ...s.images.filter((i) => i.id !== img.id)] })),
  removeImages: (ids) => set((s) => ({ images: s.images.filter((i) => !ids.includes(i.id)) })),
  clearImages: () => set({ images: [] }),
  reset: () => set({ step: 0, scenes: [], title: '', videoPath: null, log: [] })
}))
