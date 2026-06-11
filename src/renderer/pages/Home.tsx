// 홈 — 앱 실행 시 첫 화면. 큰 카드들을 한 줄로 배치, 클릭 시 해당 페이지로 이동.
import { Wand2, Video, Music, LayoutGrid, Clapperboard, GalleryHorizontalEnd } from 'lucide-react'
import { useStore, type View } from '../store'

type Card = { id: View; title: string; desc: string; Icon: typeof Wand2; accent: string }

const CARDS: Card[] = [
  { id: 'imagegen', title: '이미지 생성기', desc: 'ChatGPT·Flow로\n이미지 생성', Icon: Wand2, accent: '#4f8cff' },
  { id: 'videogen', title: '비디오 생성기', desc: 'Grok 이미지→영상', Icon: Video, accent: '#8b5cf6' },
  { id: 'musicgen', title: '음악 만들기', desc: 'Suno로 BGM·테마곡', Icon: Music, accent: '#ec4899' },
  { id: 'cardnews', title: '카드뉴스 만들기', desc: '1080×1080 카드 PNG', Icon: LayoutGrid, accent: '#10b981' },
  { id: 'wizard', title: '멀티 영상 만들기', desc: '제안서 기반\n멀티 생성', Icon: Clapperboard, accent: '#f59e0b' },
  { id: 'gallerygrid', title: '갤러리', desc: '생성한 미디어 모아보기', Icon: GalleryHorizontalEnd, accent: '#06b6d4' }
]

export default function Home() {
  const setView = useStore((s) => s.setView)
  return (
    <div className="home">
      <div className="home-hero">
        <h1>무엇을 만들까요?</h1>
        <p>원하는 작업을 선택하세요.</p>
      </div>
      <div className="home-row">
        {CARDS.map(({ id, title, desc, Icon, accent }) => (
          <button key={id} className="home-card" onClick={() => setView(id)}>
            <div className="home-card-icon" style={{ background: accent }}>
              <Icon size={26} color="#fff" />
            </div>
            <div className="home-card-title">{title}</div>
            <div className="home-card-desc">{desc}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
