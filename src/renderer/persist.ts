// 페이지 입력 폼(프롬프트·설정·첨부 이미지)을 IndexedDB에 저장/복원.
// 사이드바로 다른 메뉴에 갔다 와도 입력 내용이 초기화되지 않게 한다.
// 첨부 이미지(base64)는 커서 localStorage 대신 IndexedDB 를 쓴다 — 위저드 영상과 동일한 이유.
import { useEffect, useRef, useState } from 'react'

// ISO 시각이 (로컬 기준) 오늘인지 — 생성기 페이지가 "오늘 만든 것"만 보여줄 때 사용.
export function isToday(iso: string | undefined): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (isNaN(d.getTime())) return false
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

const DB = 'avs-forms'

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('forms')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

export async function formGet<T = unknown>(key: string): Promise<T | null> {
  try {
    const db = await open()
    return await new Promise<T | null>((res) => {
      const tx = db.transaction('forms', 'readonly')
      const rq = tx.objectStore('forms').get(key)
      rq.onsuccess = () => res((rq.result as T) ?? null)
      rq.onerror = () => res(null)
    })
  } catch {
    return null
  }
}

export async function formSet(key: string, val: unknown): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('forms', 'readwrite')
      tx.objectStore('forms').put(val, key)
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch {
    /* 용량 초과 등은 무시 — 저장 실패해도 앱 동작엔 영향 없음 */
  }
}

/**
 * 입력 폼을 IndexedDB 에 영구 저장한다.
 * - 마운트 시 1회 복원(restore) → 이후 snapshot 이 바뀔 때마다 디바운스 저장.
 * - 언마운트(페이지 이동) 시 마지막 값을 즉시 flush 해서 디바운스 구간 손실을 막는다.
 *
 * @param key      페이지별 고유 키 (예: 'imagegen')
 * @param snapshot 저장할 직렬화 가능한 값 (ephemeral blob URL 등은 페이지에서 제외해 전달)
 * @param restore  복원 콜백 — 저장된 값으로 setter 들을 호출 (비동기 재구성은 내부에서 처리)
 * @returns hydrated  복원 완료 여부
 */
export function usePersistedForm(
  key: string,
  snapshot: unknown,
  restore: (saved: Record<string, unknown>) => void
): boolean {
  const [hydrated, setHydrated] = useState(false)
  const hydratedRef = useRef(false)
  const latest = useRef(snapshot)
  latest.current = snapshot
  const restoreRef = useRef(restore)
  restoreRef.current = restore

  // 마운트: 복원 1회
  useEffect(() => {
    let alive = true
    formGet<Record<string, unknown>>(key).then((v) => {
      if (alive && v && typeof v === 'object') {
        try {
          restoreRef.current(v)
        } catch {
          /* 복원 중 일부 필드 실패는 무시 */
        }
      }
      if (alive) {
        hydratedRef.current = true
        setHydrated(true)
      }
    })
    return () => {
      alive = false
    }
  }, [key])

  // 변경 시 디바운스 저장
  const sig = (() => {
    try {
      return JSON.stringify(snapshot)
    } catch {
      return ''
    }
  })()
  useEffect(() => {
    if (!hydrated) return
    const id = setTimeout(() => formSet(key, latest.current), 400)
    return () => clearTimeout(id)
  }, [hydrated, key, sig])

  // 언마운트 시 마지막 값 flush (디바운스 대기 중 페이지 이동 대비)
  useEffect(() => {
    return () => {
      if (hydratedRef.current) formSet(key, latest.current)
    }
  }, [key])

  return hydrated
}
