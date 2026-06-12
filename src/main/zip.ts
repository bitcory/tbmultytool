// 최소 ZIP 작성기 (store 방식, 무압축) — 외부 `zip` CLI 의존 제거(윈도우 호환).
// PNG/JPG/mp3 등은 이미 압축된 포맷이라 무압축 저장으로 충분하다.
import { promises as fs } from 'fs'
import zlib from 'zlib'

const DOS_DATE_1980 = 0x21 // 1980-01-01 (유효한 최소 DOS 날짜)

export async function writeZip(
  filePath: string,
  entries: { name: string; data: Buffer }[]
): Promise<void> {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const crc = zlib.crc32(e.data) >>> 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // general purpose flag: UTF-8 이름
    local.writeUInt16LE(0, 8) // method: store
    local.writeUInt16LE(0, 10) // mod time
    local.writeUInt16LE(DOS_DATE_1980, 12) // mod date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(e.data.length, 18) // compressed size (=원본, store)
    local.writeUInt32LE(e.data.length, 22) // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    chunks.push(local, nameBuf, e.data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0) // central directory signature
    cd.writeUInt16LE(20, 4) // version made by
    cd.writeUInt16LE(20, 6) // version needed
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(0, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(DOS_DATE_1980, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(e.data.length, 20)
    cd.writeUInt32LE(e.data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42) // local header offset
    central.push(Buffer.concat([cd, nameBuf]))

    offset += 30 + nameBuf.length + e.data.length
  }

  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // end of central directory signature
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)

  await fs.writeFile(filePath, Buffer.concat([...chunks, cdBuf, eocd]))
}
