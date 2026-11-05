// PeerJS's JSON channel rejects a single message at 16,300 bytes. Encoding
// 6 KiB at a time keeps every JSON message well below that limit, including
// when one question contains multi-byte characters or is itself very long.
export const TRANSFER_PROTOCOL = 2
export const CHUNK_BYTES = 6 * 1024
export const MAX_TRANSFER_BYTES = 32 * 1024 * 1024
export const MAX_CHUNK_TEXT = Math.ceil(CHUNK_BYTES / 3) * 4

// Detect accidental corruption or mixed chunks; this is not an authentication code.
function checksum(bytes) {
  let hash = 2166136261
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function encodeQuestions(questions) {
  const bytes = new TextEncoder().encode(JSON.stringify(questions))
  if (!bytes.length || bytes.length > MAX_TRANSFER_BYTES) throw new Error('Paket soal terlalu besar untuk dikirim. Coba gunakan soal yang lebih singkat.')
  const chunks = []
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const part = bytes.subarray(offset, offset + CHUNK_BYTES)
    chunks.push(btoa(String.fromCharCode(...part)))
  }
  return { bytes: bytes.length, checksum: checksum(bytes), chunks }
}

export function isValidTransferSize(bytes, chunks) {
  return Number.isInteger(bytes) && bytes > 0 && bytes <= MAX_TRANSFER_BYTES &&
    Number.isInteger(chunks) && chunks === Math.ceil(bytes / CHUNK_BYTES)
}

export function isValidChunkText(text) {
  return typeof text === 'string' && text.length > 0 && text.length <= MAX_CHUNK_TEXT && /^[A-Za-z0-9+/]*={0,2}$/.test(text)
}

export function decodeQuestions(chunks, byteLength, expectedChecksum) {
  if (!Array.isArray(chunks) || !isValidTransferSize(byteLength, chunks.length) || !/^[0-9a-f]{8}$/.test(expectedChecksum)) throw new Error('Invalid transfer size')
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    if (!isValidChunkText(chunk)) throw new Error('Invalid transfer chunk')
    const binary = atob(chunk)
    const expected = Math.min(CHUNK_BYTES, byteLength - offset)
    if (binary.length !== expected) throw new Error('Incomplete transfer chunk')
    for (let i = 0; i < binary.length; i += 1) bytes[offset + i] = binary.charCodeAt(i)
    offset += binary.length
  }
  if (checksum(bytes) !== expectedChecksum) throw new Error('Transfer checksum mismatch')
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}
