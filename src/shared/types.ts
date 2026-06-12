// 앱 전역 공유 타입 — main/renderer 양쪽에서 import

/** 대본 생성에 쓰는 LLM 공급자 */
export type ScriptProvider = 'anthropic' | 'openai' | 'gemini'
/** 음성(TTS) 공급자 */
export type TtsProvider = 'openai' | 'elevenlabs'
/** 이미지 생성 공급자 */
export type ImageProvider = 'fal' | 'openai'

/** 저장되는 API 키 묶음 (safeStorage로 암호화 저장) */
export interface ApiKeys {
  anthropic?: string
  openai?: string
  gemini?: string
  elevenlabs?: string
  fal?: string
}

/** 화면비 */
export type AspectRatio = '16:9' | '9:16' | '1:1'

/** 영상 생성 옵션 (마법사 Step 0 입력값) */
export interface ProjectOptions {
  topic: string
  channelName?: string
  language: string // 'ko' | 'en' | ...
  aspect: AspectRatio
  sceneCount: number // 목표 씬 수
  scriptProvider: ScriptProvider
  ttsProvider: TtsProvider
  ttsVoice: string
  imageProvider: ImageProvider
  imageStyle?: string // 이미지 프롬프트에 덧붙일 스타일 지시문
}

/** 한 개의 씬(장면) */
export interface Scene {
  id: string
  index: number
  narration: string // 나레이션(자막) 텍스트
  imagePrompt: string // 이미지 생성용 영문 프롬프트
  imagePath?: string // 생성된 이미지 파일 경로
  audioPath?: string // 생성된 음성 파일 경로
  durationSec?: number // 음성 길이
}

/** 프로젝트 전체 상태 */
export interface Project {
  id: string
  title: string
  options: ProjectOptions
  scenes: Scene[]
  videoPath?: string
  createdAt: string
}

/** 확장으로부터 가져온 이미지/영상의 출처 */
export type ImageSource = 'chatgpt' | 'flow' | 'grok' | 'suno' | 'other'

/** SUNO 음악 생성 요청 */
export type SunoMode = 'simple' | 'advanced'
export interface MusicGenPayload {
  mode: SunoMode
  description?: string
  instrumental?: boolean
  style?: string
  lyrics?: string
  title?: string
}
/** 생성된 곡 한 개 (재생용 미디어 URL 포함) */
export interface MusicTrack {
  id: string
  url: string // http://127.0.0.1:<port>/media/<id>.mp3
  filename: string
}

/** 크롬 확장 → 앱으로 들어온 이미지 한 장 */
export interface ImportedImage {
  id: string
  source: ImageSource
  filename: string
  path: string // 저장된 로컬 파일 경로
  pageUrl?: string // 어느 페이지에서 가져왔는지
  importedAt: string // ISO
}

/** Grok 영상 생성 설정 */
export interface VideoGenSettings {
  duration?: string // '6' | '10'
  resolution?: string // '480p' | '720p'
  aspect?: string // '16:9' | '9:16' | '1:1'
}

/** 앱→확장으로 내려보내는 생성 작업. 확장(content script)이 /poll 로 가져가 실행한다. */
export interface BridgeJob {
  id: string
  source: ImageSource
  kind?: 'image' | 'text' // 기본 image. text 면 ChatGPT 텍스트 응답(코드블록)을 회수
  prompt: string
  aspect?: string // '16:9' 등
  referenceImages?: string[] // I2I 참조 이미지 dataURL 배열
  imageDataUrl?: string // Grok 이미지→영상: 입력 이미지 dataURL
  videoSettings?: VideoGenSettings // Grok: 길이/해상도/비율
  musicPayload?: MusicGenPayload // Suno: 음악 생성 입력
}

/** 확장 작업 완료 결과 (job-status done 보고에 실려옴) */
export interface BridgeJobResult {
  ok: boolean
  message?: string
  text?: string // text 잡: ChatGPT 응답 코드블록 내용
  imageId?: string // image 잡: import 된 이미지 id (작업↔이미지 매칭용)
}

/** 로컬 이미지 수신 서버 정보 (확장이 접속할 주소) */
export interface BridgeInfo {
  port: number
  dir: string // 가져온 이미지가 저장되는 폴더
  running: boolean
}

/** 진행 상황 이벤트 (메인→렌더러 push) */
export interface ProgressEvent {
  phase: 'script' | 'image' | 'tts' | 'render'
  message: string
  current?: number
  total?: number
  done?: boolean
  error?: string
}

/** IPC 채널 이름 상수 */
export const IPC = {
  appVersion: 'app:version',
  appExtensionDir: 'app:extensionDir',
  keysGet: 'keys:get',
  keysSet: 'keys:set',
  keysStatus: 'keys:status',
  genScript: 'gen:script',
  genImage: 'gen:image',
  genTts: 'gen:tts',
  render: 'gen:render',
  selectOutputDir: 'fs:selectOutputDir',
  openPath: 'fs:openPath',
  openExternal: 'fs:openExternal',
  openWindow: 'fs:openWindow',
  pickImage: 'fs:pickImage',
  readImage: 'fs:readImage',
  bridgeInfo: 'bridge:info',
  bridgeList: 'bridge:list',
  bridgeClear: 'bridge:clear',
  bridgeRemove: 'bridge:remove',
  bridgeImport: 'bridge:import', // 임베드 창에서 직접 이미지 저장(IPC, CSP 우회)
  bridgeGenerate: 'bridge:generate', // 임베드 창 자동화(프롬프트 입력→생성→회수)
  bridgeGenerateText: 'bridge:generateText', // ChatGPT 텍스트 생성(코드블록 회수) — 카드뉴스 자동화용
  bridgeGenerateVideo: 'bridge:generateVideo', // Grok 이미지→영상 자동화
  bridgeGenerateMusic: 'bridge:generateMusic', // SUNO 음악 생성 자동화
  bridgeGenerateBatch: 'bridge:generateBatch', // 멀티 프롬프트 배치 이미지 생성(T2I/I2I)
  bridgeCancel: 'bridge:cancel', // 진행/대기 중인 확장 생성 작업 전체 취소
  bridgeExportZip: 'bridge:exportZip', // 이미지들을 순서대로 zip 으로 저장
  progress: 'progress', // 이벤트 채널
  imageImported: 'bridge:imageImported', // 이벤트 채널 (확장→앱 이미지 도착)
  bridgeProgress: 'bridge:progress' // 이벤트 채널 (자동 생성 진행 상황)
} as const

/** preload가 contextBridge로 노출하는 API 형태 */
export interface ElectronAPI {
  /** 현재 앱 버전 (package.json version) */
  getVersion: () => Promise<string>
  /** 번들 확장이 배포된 폴더 경로 (크롬에 압축해제 로드용) */
  getExtensionDir: () => Promise<string>
  keys: {
    getStatus: () => Promise<Record<keyof ApiKeys, boolean>>
    set: (keys: ApiKeys) => Promise<void>
    get: () => Promise<ApiKeys>
  }
  generate: {
    script: (opts: ProjectOptions) => Promise<Scene[]>
    image: (scene: Scene, opts: ProjectOptions, outDir: string) => Promise<string>
    tts: (scene: Scene, opts: ProjectOptions, outDir: string) => Promise<{ path: string; durationSec: number }>
    render: (project: Project, outDir: string) => Promise<string>
  }
  fs: {
    selectOutputDir: () => Promise<string | null>
    openPath: (p: string) => Promise<void>
    openExternal: (url: string) => Promise<void>
    /** URL을 인앱 별도 브라우저 창으로 연다 (사용자가 직접 로그인·사용) */
    openWindow: (url: string, title?: string) => Promise<void>
    /** 이미지 파일 선택 다이얼로그 → 선택된 경로(취소 시 null) */
    pickImage: () => Promise<string | null>
    /** 로컬 이미지 파일을 data URL로 읽어 미리보기 */
    readImage: (path: string) => Promise<string>
  }
  /** 크롬 확장 ↔ 앱 이미지 브릿지 */
  bridge: {
    /** 로컬 수신 서버 정보(포트/폴더) */
    getInfo: () => Promise<BridgeInfo>
    /** 지금까지 가져온 이미지 목록 */
    list: () => Promise<ImportedImage[]>
    /** 가져온 이미지 전체 삭제 */
    clear: () => Promise<void>
    /** 선택한 항목들 삭제 */
    remove: (ids: string[]) => Promise<void>
    /** 임베드 창을 열어 프롬프트로 이미지를 자동 생성·회수 (실험적). referenceImages: 첨부할 레퍼런스 dataUrl 배열 */
    generate: (
      source: ImageSource,
      prompt: string,
      referenceImages?: string[],
      aspect?: string
    ) => Promise<BridgeJobResult>
    /** ChatGPT 텍스트 생성: 프롬프트 전송 → 응답 코드블록 내용 회수 (카드뉴스 자동화용) */
    generateText: (prompt: string) => Promise<BridgeJobResult>
    /** Grok 으로 이미지→영상 자동 생성·회수 (실험적). settings: 길이/해상도/비율 */
    generateVideo: (
      prompt: string,
      imageDataUrl: string,
      settings?: VideoGenSettings
    ) => Promise<{ ok: boolean; message?: string }>
    /** SUNO 로 음악 자동 생성·회수 (2곡). tracks: 재생용 미디어 URL 목록 */
    generateMusic: (
      payload: MusicGenPayload
    ) => Promise<{ ok: boolean; message?: string; tracks?: MusicTrack[] }>
    /** 배치 이미지 생성: 프롬프트 N개 → 창 N개 → 이미지 N장. items[i]={prompt, images?(I2I 참조 N장)} */
    generateBatch: (
      source: ImageSource,
      items: { prompt: string; images?: string[] }[],
      aspect?: string
    ) => Promise<{ ok: boolean; count?: number; message?: string }>
    /** 이미지들을 순서대로(01_, 02_ …) zip 으로 저장. path(파일) 또는 dataUrl 둘 다 지원. 저장 다이얼로그 표시 */
    exportZip: (
      items: { path?: string; dataUrl?: string; name: string }[],
      defaultName?: string
    ) => Promise<{ ok: boolean; path?: string; message?: string }>
    /** 진행/대기 중인 모든 생성 작업 취소(정지 버튼) */
    cancel: () => Promise<void>
    /** 새 이미지가 도착할 때마다 호출 */
    onImported: (cb: (img: ImportedImage) => void) => () => void
    /** 자동 생성 진행 상황 메시지 */
    onProgress: (cb: (message: string) => void) => () => void
  }
  onProgress: (cb: (e: ProgressEvent) => void) => () => void
}
