// 앱 전역 공유 타입 — main/renderer 양쪽에서 import

/** 대본 생성에 쓰는 LLM 공급자 */
export type ScriptProvider = 'anthropic' | 'openai' | 'gemini'
/** 음성(TTS) 공급자 */
export type TtsProvider = 'openai' | 'elevenlabs' | 'typecast'
/** 이미지 생성 공급자 */
export type ImageProvider = 'fal' | 'openai'

/** 저장되는 API 키 묶음 (safeStorage로 암호화 저장) */
export interface ApiKeys {
  anthropic?: string
  openai?: string
  gemini?: string
  elevenlabs?: string
  fal?: string
  youtube?: string
  coupangAccess?: string // 쿠팡파트너스 Open API Access Key
  coupangSecret?: string // 쿠팡파트너스 Open API Secret Key
  typecast?: string // Typecast API Key (TTS)
}

/** 쿠팡파트너스 딥링크 발급 결과 */
export interface PartnersDeeplinkResult {
  ok: boolean
  shortenUrl?: string // https://link.coupang.com/a/… 단축 제휴링크
  landingUrl?: string
  message?: string
}

/** 인포크링크 링크블록 자동 게시 입력 (확장이 link.inpock.co.kr 관리자에서 등록) */
export interface InpockPostPayload {
  url: string // 연결할 주소 (쿠팡파트너스 제휴링크)
  title: string // 링크블록 타이틀 (제품명)
  imageDataUrl: string // 썸네일 이미지 (쿠팡 제품 썸네일 dataURL)
}

/** Typecast 보이스 (정규화된 형태 — /v2/voices 응답에서 추출) */
export interface TypecastVoice {
  voiceId: string
  name: string
  gender?: string
  age?: string
  useCases?: string[] // 용도 태그 (Audiobook, Ads, Game 등)
  voiceType?: string // original | custom
  /** 모델별 지원 감정 프리셋 (예: { 'ssfm-v30': ['normal','happy',...] }) */
  emotions?: Record<string, string[]>
}

/** Typecast TTS 상세 옵션 (모델/감정/출력) */
export interface TypecastTtsOptions {
  voiceId?: string // tc_/uc_ 보이스 ID (없으면 자동 선택)
  model?: 'ssfm-v30' | 'ssfm-v21'
  language?: string // ISO 639-3 (kor/eng/cmn/jpn 등, '' = 자동 감지)
  emotionPreset?: string // normal|happy|sad|angry|whisper|toneup|tonedown ('' = 스마트 자동)
  emotionIntensity?: number // 0.0~2.0 (기본 1.0)
  volume?: number // 0~200 (기본 100)
  pitch?: number // -12~+12 반음 (기본 0)
  tempo?: number // 0.5~2.0 배속 (기본 1.0)
  seed?: number // 재현용 (선택)
}

/** 유튜브 분석기 검색 옵션 */
export interface YoutubeSearchOpts {
  query: string
  max: number // 수량 (최대)
  days: number // 기간(일)
  region: string // 국가 코드 (KR 등)
  order?: 'relevance' | 'viewCount' | 'date' // 정렬 (기본 viewCount). 채널/키워드 공통
}

/** 유튜브 분석 영상 1건 */
export interface YoutubeVideo {
  id: string
  title: string
  channel: string
  channelId?: string // 채널 상세 분석 진입용
  thumbnail: string
  url: string
  views: number
  subscribers: number
  publishedAt: string // ISO
  durationSec: number
  likes: number | null
  comments: number | null
  type: 'shorts' | 'long'
  subViewRatio: number | null // 조회수/구독자
  likeRate: number | null // 좋아요/조회수 %
  commentRate: number | null // 댓글/조회수 %
  categoryId?: string
  estRevenue: { min: number; max: number } | null // 예상 수익(원)
  cii: 'Great' | 'Good' | 'Bad'
}

/** 채널 상세 분석 (luha-master 방식 이식) */
export interface YoutubeChannelAnalysis {
  channelId: string
  title: string
  handle?: string
  thumbnail: string
  description: string
  subscribers: number
  totalViews: number
  videoCount: number
  publishedAt: string // ISO (채널 개설일)
  rating: {
    score: number // 0-100
    grade: string // S+ ~ D
    breakdown: { subscriber: number; view: number; engagement: number; consistency: number; growth: number }
  }
  revenue: {
    monthly: { min: number; max: number }
    yearly: { min: number; max: number }
    perVideoAvg: { min: number; max: number }
  }
  engagement: { avgLikeRate: number; avgCommentRate: number; avgViewsPerVideo: number; subViewRate: number }
  upload: { perWeek: number; perMonth: number; mostActiveDay: string; lastUpload: string }
  videos: YoutubeVideo[] // 최근 영상(분석 대상)
  quotaUsed: number // 세션 누적 API 사용량(대략치)
}

/** 채널 분석 요청 */
export interface YoutubeChannelOpts {
  channel: string // 채널ID(UC…) / @핸들 / 채널 URL / 채널명
  max?: number // 분석할 최근 영상 수 (기본 50)
}

/** 스크립트(자막) 추출 요청 — API 키/할당량 불필요 */
export interface YoutubeTranscriptOpts {
  url: string // 영상 URL(watch?v=/youtu.be/shorts) 또는 11자 영상ID
  lang?: string // 원하는 자막 언어코드 (미지정 시 ko → 원어 순)
}

/** 자막 트랙 1개 (언어 선택용) */
export interface YoutubeTranscriptTrack {
  lang: string // 언어코드 (ko, en …)
  name: string // 표시명 (한국어(자동 생성됨) 등)
  auto: boolean // 자동 생성(ASR) 여부
}

/** 자막 문장 1건 */
export interface YoutubeTranscriptSegment {
  start: number // 시작 시각(초)
  dur: number // 길이(초)
  text: string
}

/** 스크립트 추출 결과 */
export interface YoutubeTranscriptResult {
  videoId: string
  title: string
  channel: string
  url: string
  tracks: YoutubeTranscriptTrack[] // 사용 가능한 자막 언어 목록
  lang: string // 실제 사용된 트랙 언어코드
  segments: YoutubeTranscriptSegment[]
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
  imagePrompt: string // 이미지(첫 프레임) 생성용 영문 프롬프트
  motionPrompt?: string // 영상(i2v) 모션 프롬프트 — 제품 특성에 맞춘 카메라/움직임 묘사
  seedancePrompt?: string // Seedance 2.0용 멀티컷 디렉팅 프롬프트(Style/Dynamic CUT/Static/Audio/Total)
  captions?: { at: string; hook: string; detail?: string }[] // 화면 자막(후킹 문구) — at=타임코드
  role?: string // 세그먼트 역할(hook+design, features+cta 등)
  sellingPoints?: string[] // 이 세그먼트의 셀링포인트
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

/** 확장으로부터 가져온 이미지/영상의 출처 ('scroll' = 앱 내부 스크롤영상 생성기, 'tistory' = 블로그 발행) */
export type ImageSource = 'chatgpt' | 'flow' | 'grok' | 'suno' | 'scroll' | 'tistory' | 'coupang' | 'flowbatch' | 'runway' | 'xiaohongshu' | 'inpock' | 'other'

// ── 샤오홍슈 소스찾기 ──
export interface XhsSearchOpts {
  keyword: string
  days?: number // 최근 N일 (0=전체)
  limit?: number // 수집 개수
  sort?: 'hot' | 'time' | 'like' // 종합(인기)/최신/좋아요순
}
/** 검색 피드 카드(확장이 스크래핑) */
export interface XhsCard {
  noteId: string
  url: string // xsec_token 포함 노트 URL
  title: string
  cover: string // 커버 이미지 URL
  type: 'video' | 'image'
  likes: number
  author: string
  duration?: string // mm:ss
  publishedAt?: string
}
/** 노트 상세(메인 서비스가 fetch) */
export interface XhsNote {
  noteId: string
  url: string
  title: string
  desc: string
  type: 'video' | 'image'
  author: string
  likes: number
  collects: number
  comments: number
  cover: string
  images: string[]
  videoUrl?: string
  duration?: string
}

/** 쿠팡 상품페이지에서 확장(coupang.js)이 추출한 상품 정보 */
export interface CoupangProduct {
  productId?: string | null
  url: string
  name: string
  price: number | null
  originalPrice: number | null
  discount: number | null
  rating: number | null
  reviewCount: number | null
  images: string[] // 대표/썸네일 이미지 URL
  videos?: string[] // 제품 영상 URL (있을 때만 — mp4/m3u8)
  reviews?: CoupangReview[] // 상품평 (평점 높은 순)
  attributes?: CoupangAttribute[] // 속성 만족도 요약 (내구성/편리성 등)
  capturedAt?: string
}

/** 개별 상품평 */
export interface CoupangReview {
  rating: number | null
  date?: string
  title?: string
  body?: string
}

/** 속성 만족도 한 줄 (예: 전송 속도 / 아주 빨라요 / 100) */
export interface CoupangAttribute {
  label: string
  value: string
  percent: number | null
}

/** 블로그 발행 작업 페이로드 (앱→블로그 확장). 본문은 text/image 블록 순서 그대로. */
export interface BlogPostPayload {
  platform: 'tistory'
  title: string
  tags: string[]
  thumbDataUrl?: string // 대표이미지(썸네일)
  blocks: Array<{ type: 'text'; text: string } | { type: 'image'; dataUrl: string }>
}

/** 사각 영역(픽셀) — 스크롤영상 레이아웃 박스 */
export interface ScrollRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 스크롤영상 렌더 사양 — 렌더러(Canvas)가 한글 텍스트/장식 PNG와 레이아웃을 모두 계산해
 * 메인(ffmpeg)으로 넘긴다. 메인은 이 사양만으로 합성·인코딩한다.
 */
export interface ScrollMediaLayer {
  path?: string // 로컬 파일 경로(영상 권장) — dataUrl 과 둘 중 하나
  dataUrl?: string
  isVideo: boolean
  box: ScrollRect // 외곽 박스(이 위치에 올리고, 둥근 마스크/테두리도 이 크기)
  padX: number // 박스 안쪽 좌우 여백
  padY: number // 박스 안쪽 상하 여백
  fit: 'contain' | 'cover' // contain=원본비율 유지(여백), cover=꽉채움(잘림)
  zoom?: number // 확대 배율(>1 이면 더 키워서 가장자리 크롭 — 영상에 박힌 레터박스 제거용). 기본 1
  mask?: string // 둥근 모서리 알파 마스크 dataURL (흰=보임/검=투명, box 크기)
}

export interface ScrollRenderSpec {
  width: number
  height: number
  fps: number
  bg: string // 배경색 hex (예 '#0a0a0c')
  speed: number // 스크롤 속도 px/s (사용자 입력 기준; 영상 모드면 메인이 길이에 맞춰 재계산)
  travel: number // 텍스트 총 이동 거리 = 섹션안쪽높이 + 텍스트높이
  mute: boolean // 영상 오디오 음소거 여부
  mediaLayers: ScrollMediaLayer[] // 영상/이미지 레이어들(아래에서 위 순서). 비어있으면 텍스트 전용
  section: ScrollRect // 텍스트가 흐르는 섹션 안쪽 영역
  titleY?: number // 제목 PNG 를 올릴 y (가로는 가운데 정렬)
  png: {
    text: string // 스크롤 텍스트 블록 (dataURL)
    fade: string // 섹션 위/아래 페이드 마스크 (dataURL)
    frame: string // 둥근 테두리 (dataURL, 전체 캔버스 크기)
    title?: string // 제목 (dataURL)
  }
}

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
  kind?: 'image' | 'text' | 'blog' | 'search' | 'inpock' // 기본 image. text=ChatGPT 텍스트 회수, blog=티스토리 발행, search=샤오홍슈 검색, inpock=인포크링크 게시
  xhsSearch?: XhsSearchOpts // search 잡: 샤오홍슈 검색 조건
  prompt: string
  prompts?: string[] // flowbatch: 한 작업에 여러 프롬프트(배치) — Flow 엔진이 한 탭에서 파이프라인 생성
  assets?: { name: string; dataUrl: string }[] // flowbatch: 프롬프트의 @[name] 참조에 대응하는 업로드 이미지
  aspect?: string // '16:9' 등
  referenceImages?: string[] // I2I 참조 이미지 dataURL 배열
  imageDataUrl?: string // Grok 이미지→영상: 입력 이미지 dataURL
  videoSettings?: VideoGenSettings // Grok: 길이/해상도/비율
  duration?: string // runway: 영상 길이(초)
  musicPayload?: MusicGenPayload // Suno: 음악 생성 입력
  blogPayload?: BlogPostPayload // blog 잡: 티스토리에 발행할 제목/본문/이미지/태그
  inpockPayload?: InpockPostPayload // inpock 잡: 인포크링크 링크블록 등록 정보
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
  partnersDeeplink: 'partners:deeplink', // 쿠팡파트너스 제휴 단축링크 발급
  inpockPost: 'inpock:post', // 인포크링크 링크블록 자동 게시(확장이 관리자에서 등록)
  genScript: 'gen:script',
  genImage: 'gen:image',
  genTts: 'gen:tts',
  genNarration: 'gen:narration', // 통합 나레이션 텍스트 → 음성(mp3) 생성 + 갤러리 등록
  typecastVoices: 'typecast:voices', // Typecast 보이스 목록 조회(키 필요, 캐시)
  typecastPreview: 'typecast:preview', // 보이스 미리듣기 샘플 생성(캐시) → /media/ 파일명 반환
  render: 'gen:render',
  selectOutputDir: 'fs:selectOutputDir',
  openPath: 'fs:openPath',
  openExternal: 'fs:openExternal',
  openWindow: 'fs:openWindow',
  pickImage: 'fs:pickImage',
  readImage: 'fs:readImage',
  saveFileAs: 'fs:saveFileAs', // 로컬 파일을 사용자가 고른 위치로 저장(다른 이름으로 저장)
  framesProbe: 'frames:probe', // 영상 길이/해상도 조회
  framesExtract: 'frames:extract', // 특정 시각 프레임을 고화질 PNG 로 추출
  framesPrepare: 'frames:prepare', // dataURL 영상 → 임시 파일 경로(경로를 못 잡는 폴백)
  bridgeInfo: 'bridge:info',
  bridgeList: 'bridge:list',
  bridgeClear: 'bridge:clear',
  bridgeRemove: 'bridge:remove',
  bridgeImport: 'bridge:import', // 임베드 창에서 직접 이미지 저장(IPC, CSP 우회)
  bridgeGenerate: 'bridge:generate', // 임베드 창 자동화(프롬프트 입력→생성→회수)
  bridgeGenerateText: 'bridge:generateText', // ChatGPT 텍스트 생성(코드블록 회수) — 카드뉴스 자동화용
  bridgeGenerateVideo: 'bridge:generateVideo', // Grok 이미지→영상 자동화
  bridgeGenerateScroll: 'bridge:generateScroll', // 앱 내부 스크롤영상 생성(ffmpeg, 확장 불필요)
  bridgeGenerateMusic: 'bridge:generateMusic', // SUNO 음악 생성 자동화
  bridgeGenerateBatch: 'bridge:generateBatch', // 멀티 프롬프트 배치 이미지 생성(T2I/I2I)
  bridgeGenerateFlowBatch: 'bridge:generateFlowBatch', // Flow 엔진(한 탭 파이프라인) 배치 생성
  bridgeGenerateRunway: 'bridge:generateRunway', // Runway(Seedance 2.0) i2v 생성
  bridgeGenerateBlog: 'bridge:generateBlog', // 티스토리 블로그 자동 발행(확장이 에디터에 주입)
  bridgeCancel: 'bridge:cancel', // 진행/대기 중인 확장 생성 작업 전체 취소
  bridgeExportZip: 'bridge:exportZip', // 이미지들을 순서대로 zip 으로 저장
  progress: 'progress', // 이벤트 채널
  imageImported: 'bridge:imageImported', // 이벤트 채널 (확장→앱 이미지 도착)
  bridgeProgress: 'bridge:progress', // 이벤트 채널 (자동 생성 진행 상황)
  productImported: 'bridge:productImported', // 이벤트 채널 (확장→앱 쿠팡 상품정보 도착)
  youtubeSearch: 'youtube:search', // 유튜브 분석기 검색
  youtubeAnalyzeChannel: 'youtube:analyzeChannel', // 채널 상세 분석
  youtubeTranscript: 'youtube:transcript', // 스크립트(자막) 추출
  youtubeVideo: 'youtube:video', // 스크립트 분석기 플레이어용 영상 로컬 다운로드
  xhsSearch: 'xhs:search', // 샤오홍슈 검색(브라우저 확장에 작업 전달)
  xhsDownload: 'xhs:download', // 샤오홍슈 노트 미디어 다운로드
  xhsResults: 'xhs:results' // 이벤트 채널 (확장→앱 검색결과 도착)
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
  typecast: {
    /** 계정에서 사용 가능한 보이스 목록 (설정의 Typecast 키 필요) */
    voices: () => Promise<TypecastVoice[]>
    /** 보이스 미리듣기 — 짧은 예시문장을 합성해 /media/<file> 로 재생 가능한 파일명 반환 (보이스별 캐시) */
    preview: (voiceId: string, model: string, language: string) => Promise<{ file: string }>
  }
  partners: {
    /** 쿠팡 상품 URL → 파트너스 제휴 단축링크 발급 (Open API, 키 필요) */
    deeplink: (productUrl: string) => Promise<PartnersDeeplinkResult>
    /** 인포크링크 관리자에 링크블록 자동 등록 (크롬 확장 자동화, 인포크 로그인 필요) */
    inpockPost: (payload: InpockPostPayload) => Promise<BridgeJobResult>
  }
  generate: {
    script: (opts: ProjectOptions) => Promise<Scene[]>
    image: (scene: Scene, opts: ProjectOptions, outDir: string) => Promise<string>
    tts: (scene: Scene, opts: ProjectOptions, outDir: string) => Promise<{ path: string; durationSec: number }>
    /** 통합 나레이션 텍스트를 음성으로 생성해 갤러리에 등록 — 재생은 /media/<파일명> */
    narration: (
      text: string,
      provider: TtsProvider,
      voice: string,
      typecastOpts?: TypecastTtsOptions
    ) => Promise<{ path: string; durationSec: number; filename: string }>
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
    /** 드래그/선택한 File 의 실제 파일 경로 (Electron webUtils). 큰 영상을 base64 없이 경로로 다루기 위함 */
    getPathForFile: (file: File) => string
    /** 로컬 파일을 사용자가 고른 위치로 저장(저장 다이얼로그). 취소 시 ok:false */
    saveFileAs: (srcPath: string, defaultName: string) => Promise<{ ok: boolean; path?: string }>
  }
  /** 프레임 추출기 (ffmpeg, 확장 불필요) */
  frames: {
    /** 영상 길이(초)/해상도(px) */
    probe: (filePath: string) => Promise<{ duration: number; width: number; height: number }>
    /** timeSec 위치의 프레임을 원본 해상도 PNG 로 추출 (임시 파일 경로 + 미리보기 dataURL) */
    extract: (
      filePath: string,
      timeSec: number
    ) => Promise<{ path: string; dataUrl: string; timeSec: number }>
    /** 파일 경로를 못 잡는 경우 dataURL 영상을 임시 파일로 저장하고 경로를 받는다 */
    prepare: (dataUrl: string) => Promise<string>
  }
  /** 크롬 확장 ↔ 앱 이미지 브릿지 */
  bridge: {
    /** 로컬 수신 서버 정보(포트/폴더) */
    getInfo: () => Promise<BridgeInfo>
    /** 지금까지 가져온 이미지 목록 */
    list: () => Promise<ImportedImage[]>
    /** dataUrl 이미지를 갤러리에 저장(편집기 결과 저장 등). 저장된 항목 반환 */
    importImage: (payload: {
      source?: string
      dataUrl?: string
      url?: string
      filename?: string
      pageUrl?: string
    }) => Promise<ImportedImage>
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
    /** 티스토리 블로그 발행: 제목/본문/이미지/태그를 블로그 확장이 에디터에 자동 주입 (공개 발행 직전까지) */
    generateBlog: (payload: BlogPostPayload) => Promise<BridgeJobResult>
    /** Grok 으로 이미지→영상 자동 생성·회수 (실험적). settings: 길이/해상도/비율 */
    generateVideo: (
      prompt: string,
      imageDataUrl: string,
      settings?: VideoGenSettings
    ) => Promise<{ ok: boolean; message?: string }>
    /** Runway(Seedance 2.0) 이미지→영상. aspect 는 '9:16' | '16:9'. 결과는 onImported(source 'grok' 영상)로 도착 */
    generateRunway: (
      prompt: string,
      imageDataUrl: string,
      opts?: { aspect?: string; duration?: string }
    ) => Promise<{ ok: boolean; message?: string }>
    /** 스크롤영상 생성: 렌더러 Canvas 사양 → ffmpeg 합성. 결과는 onImported(영상)로 갤러리에 도착 */
    generateScroll: (
      spec: ScrollRenderSpec
    ) => Promise<{ ok: boolean; message?: string; imageId?: string }>
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
    /** Flow 엔진(TOOLB FLOW 이식)으로 한 탭에서 여러 프롬프트를 파이프라인 생성. 결과는 onImported(source 'flow')로 도착.
     *  prompts 는 이미 @[name] 참조 토큰을 포함하고, assets 는 그 토큰에 대응하는 이미지(name↔dataUrl). */
    generateFlowBatch: (
      prompts: string[],
      assets?: { name: string; dataUrl: string }[],
      aspect?: string
    ) => Promise<{ ok: boolean; message?: string }>
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
    /** 확장이 추출한 쿠팡 상품정보가 도착할 때마다 호출 */
    onProduct: (cb: (product: CoupangProduct) => void) => () => void
  }
  onProgress: (cb: (e: ProgressEvent) => void) => () => void
  /** 유튜브 분석기 */
  youtube: {
    /** channelMode: 입력이 채널(URL/@핸들/채널명)로 해석되어 그 채널 영상 목록을 반환했는지 */
    search: (opts: YoutubeSearchOpts) => Promise<{ ok: boolean; items?: YoutubeVideo[]; channelMode?: boolean; quotaUsed?: number; message?: string }>
    analyzeChannel: (opts: YoutubeChannelOpts) => Promise<{ ok: boolean; analysis?: YoutubeChannelAnalysis; message?: string }>
    /** 영상 URL → 스크립트(자막) 추출. API 키/할당량 불필요 */
    transcript: (opts: YoutubeTranscriptOpts) => Promise<{ ok: boolean; result?: YoutubeTranscriptResult; message?: string }>
    /** 영상 URL → 로컬 캐시 다운로드(yt-dlp). 반환된 file 은 브릿지 /media/<file> 로 재생 */
    video: (url: string) => Promise<{ ok: boolean; file?: string; message?: string }>
  }
  xhs: {
    /** 검색 작업을 확장에 전달(크롬 샤오홍슈에서 스크래핑). 결과는 onResults 로 도착 */
    search: (opts: XhsSearchOpts) => Promise<{ ok: boolean; message?: string }>
    /** 노트 미디어(영상/이미지)를 갤러리에 다운로드 */
    download: (url: string) => Promise<{ ok: boolean; saved: number; message?: string }>
    /** 확장이 보낸 검색결과 카드 수신 */
    onResults: (cb: (cards: XhsCard[]) => void) => () => void
  }
}
