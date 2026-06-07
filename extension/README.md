# TB MULTY TOOL Companion (크롬 확장)

ChatGPT / Google Flow에서 만든 이미지를 데스크톱 앱 **TB MULTY TOOL**로 가져오는 로컬 전용 확장입니다.

## 설치 (개발자 모드)

1. Chrome 주소창에 `chrome://extensions` 입력
2. 우측 상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드** 클릭 → 이 `extension/` 폴더 선택

## 사용법

1. **TB MULTY TOOL 앱을 먼저 실행** (앱이 `127.0.0.1`에서 이미지를 받습니다)
2. ChatGPT(`chatgpt.com`) 또는 Google Flow(`labs.google`)에서 이미지 생성
3. 이미지 위에 마우스를 올리면 뜨는 **“📥 앱으로 보내기”** 버튼 클릭
4. 앱의 **이미지 가져오기** 탭에 들어옵니다

## 동작 방식

```
content.js  : 페이지 이미지에 전송 버튼을 붙임
background.js: 이미지를 받아 http://127.0.0.1:<포트>/import 로 POST (포트 47321~ 자동 탐색)
앱(main)    : 받은 이미지를 로컬 폴더에 저장 + 갤러리에 표시
```

외부 서버로 나가는 통신은 없습니다. 모두 같은 PC 안(localhost)에서만 오갑니다.

## 한계 / 참고

- ChatGPT·Flow의 화면 구조가 바뀌면 이미지 인식이 안 될 수 있습니다(가끔 업데이트 필요).
- 보안 강화(연결 토큰)는 추후 추가 예정 — 현재는 localhost 전용이라 외부 접근은 불가합니다.
