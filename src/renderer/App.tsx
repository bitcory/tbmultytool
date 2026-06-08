import { useEffect, useState } from 'react'
import { Clapperboard, Film, Video, Wand2, GalleryHorizontalEnd, Settings as SettingsIcon } from 'lucide-react'
import { useStore } from './store'
import Wizard from './pages/Wizard'
import Gallery from './pages/Gallery'
import GalleryGrid from './pages/GalleryGrid'
import ImageGen from './pages/ImageGen'
import VideoGen from './pages/VideoGen'

const NAV = [
  { id: 'imagegen', label: '이미지 생성기', Icon: Wand2 },
  { id: 'videogen', label: '비디오 생성기', Icon: Video },
  { id: 'wizard', label: '멀티 영상 만들기', Icon: Clapperboard },
  { id: 'gallerygrid', label: '갤러리', Icon: GalleryHorizontalEnd },
  { id: 'gallery', label: '설정', Icon: SettingsIcon }
] as const

export default function App() {
  const { view, setView } = useStore()
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.electronAPI.getVersion().then(setVersion)
  }, [])
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Film size={18} /> TB MTOOL
        </div>
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`nav-item ${view === id ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 9 }}
            onClick={() => setView(id)}
          >
            <Icon size={17} /> {label}
          </button>
        ))}
        <div className="spacer" />
        <div className="hint" style={{ padding: '0 12px' }}>
          {version ? `v${version}` : ''} Made by ToolB
        </div>
      </aside>
      <main className={`main ${view === 'wizard' ? 'flush' : ''}`}>
        {view === 'imagegen' ? (
          <ImageGen />
        ) : view === 'videogen' ? (
          <VideoGen />
        ) : view === 'wizard' ? (
          <Wizard />
        ) : view === 'gallery' ? (
          <Gallery />
        ) : (
          <GalleryGrid />
        )}
      </main>
    </div>
  )
}
