# TB MULTY TOOL

주제 한 줄 → AI 대본 → TTS 음성 → 이미지 → FFmpeg 합성으로 영상을 자동 생성하는 데스크톱 앱.
(Electron + React + TypeScript, 본인 API 키 사용)

## 파이프라인

```
주제 입력 ─▶ LLM 대본 생성(씬별 나레이션+이미지 프롬프트)
        ─▶ 씬마다: 이미지 생성 + TTS 음성 생성
        ─▶ FFmpeg: 정지영상+자막+음성 클립 → concat → 최종 mp4
```

## 지원 공급자 (본인 키 필요, 설정 화면에서 입력)

| 단계 | 공급자 |
|------|--------|
| 대본 | Anthropic Claude / OpenAI / Google Gemini |
| 음성 | OpenAI TTS / ElevenLabs |
| 이미지 | fal.ai (FLUX) / OpenAI (gpt-image-1) |

키는 Electron `safeStorage`로 암호화되어 로컬에만 저장됩니다.

## 개발 실행

```bash
npm install
npm run dev        # 개발 모드 (HMR)
npm run typecheck  # 타입 체크
npm run build      # 프로덕션 빌드
```

FFmpeg/FFprobe는 `ffmpeg-static`/`ffprobe-static`로 번들됩니다 (시스템 설치 불필요).

## 구조

```
src/
├── main/                 Electron 메인 프로세스
│   ├── index.ts          앱 생명주기/윈도우
│   ├── preload.ts        contextBridge API
│   ├── ipc.ts            IPC 핸들러
│   ├── secrets.ts        API 키 암호화 저장
│   ├── ffmpeg.ts         ffmpeg/ffprobe 실행 유틸
│   └── services/         script · image · tts · render
├── shared/types.ts       main↔renderer 공유 타입
└── renderer/             React UI (마법사 + 설정)
```

## 한계 / TODO (MVP 이후)

- 프로젝트 저장/불러오기, 목록 화면
- 배경음악(BGM), 트랜지션, 켄번스(줌/팬) 효과
- 자막 자동 정렬(Whisper), 타이밍 미세조정
- YouTube 업로드, 썸네일 생성
- 리서치(YouTube Data API) 모듈
