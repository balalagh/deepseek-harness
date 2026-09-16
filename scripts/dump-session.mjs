#!/usr/bin/env node
/**
 * Dump a DSH session log: decompress a .jsonl.zstd file and print each event.
 *
 * Usage:
 *   node scripts/dump-session.mjs <session-file>
 *   node scripts/dump-session.mjs <session-file> --type system/message
 *   node scripts/dump-session.mjs <session-file> --summary
 */

import { zstdDecompress } from 'node:zlib'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'

const dec = promisify(zstdDecompress)
const ZSTD_MAGIC = 0xFD2FB528

function findFrames(buf) {
  const frames = []
  let offset = 0
  while (offset < buf.length) {
    if (buf.length - offset < 4) break
    if (buf.readUInt32LE(offset) !== ZSTD_MAGIC) break
    const start = offset
    offset += 4
    if (offset >= buf.length) break
    const desc = buf.readUInt8(offset); offset += 1
    const contentSizeFlag = desc >>> 6
    const singleSeg = (desc & 0x20) !== 0
    const checksum = (desc & 0x04) !== 0
    const dictFlag = desc & 0x03
    const dictBytes = dictFlag === 3 ? 4 : dictFlag
    const csBytes = contentSizeFlag === 0 ? (singleSeg ? 1 : 0) : (1 << contentSizeFlag)
    offset += (singleSeg ? 0 : 1) + dictBytes + csBytes
    let lastBlock = false
    while (!lastBlock && offset + 3 <= buf.length) {
      const bhdr = buf.readUInt8(offset) | (buf.readUInt8(offset + 1) << 8) | (buf.readUInt8(offset + 2) << 16)
      lastBlock = (bhdr & 1) === 1
      const blockSize = bhdr >>> 3
      offset += 3 + blockSize
    }
    if (checksum) offset += 4
    frames.push(buf.subarray(start, offset))
  }
  return frames
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: node dump-session.mjs <file> [--type <type>] [--summary]')
  process.exit(1)
}

const file = args[0]
const typeFilter = args.includes('--type') ? args[args.indexOf('--type') + 1] : null
const summary = args.includes('--summary')

const buf = readFileSync(file)
const frames = findFrames(buf)
const lines = []
for (const frame of frames) {
  try {
    const text = (await dec(frame)).toString('utf8')
    lines.push(...text.split('\n').filter(l => l.trim()))
  } catch {}
}

const events = lines.map(l => JSON.parse(l))
const filtered = typeFilter ? events.filter(e => e.type === typeFilter) : events

if (summary) {
  for (const evt of filtered) {
    const t = evt.type || '(header)'
    const d = evt.data || evt
    if (t === 'system/message' || t === 'user/message') {
      const content = d.message?.content || d.content || ''
      const text = typeof content === 'string' ? content : JSON.stringify(content)
      console.log(`[${t}] ${text.substring(0, 120).replace(/\n/g, ' ')}... (${text.length} chars)`)
    } else if (t === 'request/header') {
      const cfg = d.header?.config || {}
      console.log(`[${t}] ${cfg.provider}/${cfg.model} effort=${cfg.reasoningEffort} maxTokens=${cfg.maxTokens}`)
    } else {
      console.log(`[${t}]`)
    }
  }
} else {
  for (const evt of filtered) {
    console.log(JSON.stringify(evt, null, 2))
    console.log('---')
  }
}
