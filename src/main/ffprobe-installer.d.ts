// @ffprobe-installer/ffprobe 는 타입 정의를 제공하지 않아 직접 선언.
declare module '@ffprobe-installer/ffprobe' {
  const ffprobe: { path: string; version: string }
  export default ffprobe
}
