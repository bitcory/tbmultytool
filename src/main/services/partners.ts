// 쿠팡파트너스 Open API — 상품 URL 로 제휴 단축링크(딥링크) 발급.
// 인증은 CEA(HMAC-SHA256) 서명: signed-date(yyMMdd'T'HHmmss'Z' UTC) + method + path + query 를
// Secret Key 로 서명해 Authorization 헤더로 보낸다. 키는 파트너스 → 링크생성 → API 관리에서 발급.
import crypto from 'crypto'
import { loadKeys } from '../secrets'
import type { PartnersDeeplinkResult } from '@shared/types'

const DOMAIN = 'https://api-gateway.coupang.com'
const DEEPLINK_PATH = '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink'

function ceaAuth(method: string, path: string, query: string, accessKey: string, secretKey: string): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const datetime =
    String(d.getUTCFullYear()).slice(2) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  const message = datetime + method + path + query
  const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex')
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`
}

export async function createPartnersDeeplink(productUrl: string, subId?: string): Promise<PartnersDeeplinkResult> {
  const keys = await loadKeys()
  if (!keys.coupangAccess || !keys.coupangSecret) {
    return { ok: false, message: '설정에서 쿠팡파트너스 Access/Secret Key 를 먼저 입력하세요.' }
  }
  const url = (productUrl || '').trim().split('#')[0]
  if (!/^https?:\/\/(www\.)?coupang\.com\//.test(url)) {
    return { ok: false, message: '쿠팡 상품 URL 이 아닙니다: ' + (url || '(비어 있음)') }
  }
  try {
    const body: Record<string, unknown> = { coupangUrls: [url] }
    if (subId) body.subId = subId
    const res = await fetch(DOMAIN + DEEPLINK_PATH, {
      method: 'POST',
      headers: {
        Authorization: ceaAuth('POST', DEEPLINK_PATH, '', keys.coupangAccess, keys.coupangSecret),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    const j = (await res.json().catch(() => null)) as {
      rCode?: string
      rMessage?: string
      data?: { originalUrl?: string; shortenUrl?: string; landingUrl?: string }[]
    } | null
    if (!res.ok) {
      return { ok: false, message: `파트너스 API 오류 (HTTP ${res.status})${j?.rMessage ? ': ' + j.rMessage : ''}` }
    }
    if (!j || j.rCode !== '0' || !j.data?.length) {
      return { ok: false, message: j?.rMessage || '딥링크 발급 실패 (응답에 링크 없음)' }
    }
    return { ok: true, shortenUrl: j.data[0].shortenUrl, landingUrl: j.data[0].landingUrl }
  } catch (e) {
    return { ok: false, message: '파트너스 API 연결 실패: ' + String(e instanceof Error ? e.message : e) }
  }
}
