import { useEffect, useState } from 'react'
import { Home as HomeIcon, ChevronRight, Film, Video, Music, Wand2, LayoutGrid, GalleryHorizontalEnd, ScrollText, Settings as SettingsIcon, PenLine, Scissors, ImageIcon, ShoppingBag, TrendingUp } from 'lucide-react'
import { useStore, type View } from './store'
import Home from './pages/Home'
import ShoppingShorts from './pages/ShoppingShorts'
import YoutubeAnalyzer from './pages/YoutubeAnalyzer'
import SourceFinder from './pages/SourceFinder'
import Wizard from './pages/Wizard'
import CardNews from './pages/CardNews'
import Settings from './pages/Settings'
import GalleryGrid from './pages/GalleryGrid'
import ImageGen from './pages/ImageGen'
import VideoGen from './pages/VideoGen'
import ImageEditor from './pages/ImageEditor'
import ScrollVideo from './pages/ScrollVideo'
import Frames from './pages/Frames'
import MusicGen from './pages/MusicGen'
import Blog from './pages/Blog'

type NavItem = { id: View; label: string; Icon: typeof HomeIcon }

// 사이드바 메뉴 — 성격별 섹션으로 그룹핑, 갤러리·설정은 하단 고정
const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: '제작',
    items: [
      { id: 'shoppingshorts', label: '쇼핑쇼츠', Icon: ShoppingBag },
      { id: 'scrollvideo', label: '스크롤영상', Icon: ScrollText },
      { id: 'cardnews', label: '카드뉴스', Icon: LayoutGrid },
      { id: 'blog', label: '블로그 자동화', Icon: PenLine }
    ]
  },
  {
    title: '생성',
    items: [
      { id: 'imagegen', label: '이미지', Icon: Wand2 },
      { id: 'videogen', label: '비디오', Icon: Video },
      { id: 'musicgen', label: '음악', Icon: Music }
    ]
  },
  {
    title: '도구',
    items: [
      { id: 'youtube', label: '유튜브 분석', Icon: TrendingUp },
      { id: 'sourcefinder', label: '소스 찾기', Icon: Film },
      { id: 'imageedit', label: '이미지 편집', Icon: ImageIcon },
      { id: 'frames', label: '프레임 추출', Icon: Scissors }
    ]
  }
]

const NAV_BOTTOM: NavItem[] = [
  { id: 'gallerygrid', label: '갤러리', Icon: GalleryHorizontalEnd },
  { id: 'settings', label: '설정', Icon: SettingsIcon }
]

export default function App() {
  const { view, setView } = useStore()
  const [version, setVersion] = useState('')
  // 접힘 상태 — 한 번에 한 섹션만 펼쳐진다 (다른 섹션을 열면 기존 섹션은 닫힘)
  const [openSection, setOpenSection] = useState<string | null>(null)
  useEffect(() => {
    window.electronAPI.getVersion().then(setVersion)
  }, [])
  // 홈 카드 등 사이드바 밖에서 이동했을 때 현재 메뉴가 속한 섹션을 자동으로 펼친다
  useEffect(() => {
    const section = NAV_SECTIONS.find((s) => s.items.some((i) => i.id === view))
    if (section) setOpenSection(section.title)
  }, [view])
  const toggleSection = (title: string) =>
    setOpenSection((cur) => (cur === title ? null : title))
  const renderItem = ({ id, label, Icon }: NavItem) => (
    <button
      key={id}
      className={`nav-item ${view === id ? 'active' : ''}`}
      onClick={() => setView(id)}
    >
      <Icon size={17} /> {label}
    </button>
  )
  return (
    <div className="app">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView('home')}>
          <Film size={18} /> TB MTOOL
        </button>
        <nav className="sidebar-nav">
          {renderItem({ id: 'home', label: '홈', Icon: HomeIcon })}
          {NAV_SECTIONS.map(({ title, items }) => {
            const isOpen = openSection === title
            return (
              <div key={title} className="nav-group">
                <button
                  className={`nav-section ${isOpen ? 'open' : ''}`}
                  onClick={() => toggleSection(title)}
                  aria-expanded={isOpen}
                >
                  <ChevronRight size={13} className="nav-chevron" /> {title}
                </button>
                {isOpen && items.map(renderItem)}
              </div>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          {NAV_BOTTOM.map(renderItem)}
          <div className="hint" style={{ padding: '0 12px' }}>
            {version ? `v${version}` : ''} Made by ToolB
          </div>
        </div>
      </aside>
      <main className={`main ${['wizard', 'cardnews', 'shoppingshorts', 'youtube', 'blog', 'sourcefinder'].includes(view) ? 'flush' : ''}`}>
        {view === 'home' ? (
          <Home />
        ) : view === 'shoppingshorts' ? (
          <ShoppingShorts />
        ) : view === 'youtube' ? (
          <YoutubeAnalyzer />
        ) : view === 'sourcefinder' ? (
          <SourceFinder />
        ) : view === 'imagegen' ? (
          <ImageGen />
        ) : view === 'videogen' ? (
          <VideoGen />
        ) : view === 'imageedit' ? (
          <ImageEditor />
        ) : view === 'scrollvideo' ? (
          <ScrollVideo />
        ) : view === 'frames' ? (
          <Frames />
        ) : view === 'musicgen' ? (
          <MusicGen />
        ) : view === 'cardnews' ? (
          <CardNews />
        ) : view === 'blog' ? (
          <Blog />
        ) : view === 'wizard' ? (
          <Wizard />
        ) : view === 'settings' ? (
          <Settings />
        ) : (
          <GalleryGrid />
        )}
      </main>
    </div>
  )
}
