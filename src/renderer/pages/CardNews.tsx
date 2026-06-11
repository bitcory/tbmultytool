// 카드뉴스 만들기 — card-news.html(자체 카드 생성기)을 임베드.
// 카드 클릭 시 우측 드로어로 편집, html2canvas 로 1080x1080 PNG 다운로드(브라우저 다운로드).
// 앱 다른 페이지와 달리 외부 통신 없이 iframe 안에서 독립 동작.
export default function CardNews() {
  return (
    <iframe
      src="card-news.html"
      title="카드뉴스 만들기"
      style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
    />
  )
}
