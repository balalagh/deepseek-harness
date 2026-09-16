const fs = require('fs');
const path = require('path');

const serverCode = #!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { zstdDecompress } from 'node:zlib';
import { promisify } from 'node:util';

const dec = promisify(zstdDecompress);
const ZSTD_MAGIC = 0xFD2FB528;
const DSH_HOME = join(homedir(), '.dsh');
const SESSIONS_DIR = join(DSH_HOME, 'sessions');
const PORT = 3100;

function findFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset < buf.length) {
    if (buf.length - offset < 4) break;
    if (buf.readUInt32LE(offset) !== ZSTD_MAGIC) break;
    const start = offset;
    offset += 4;
    if (offset >= buf.length) break;
    const desc = buf.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = desc >>> 6;
    const singleSeg = (desc & 0x20) !== 0;
    const checksum = (desc & 0x04) !== 0;
    const dictFlag = desc & 0x03;
    const dictBytes = dictFlag === 3 ? 4 : dictFlag;
    const csBytes = contentSizeFlag === 0 ? (singleSeg ? 1 : 0) : (1 << contentSizeFlag);
    offset += (singleSeg ? 0 : 1) + dictBytes + csBytes;
    let lastBlock = false;
    while (!lastBlock && offset + 3 <= buf.length) {
      const bhdr = buf.readUInt8(offset) | (buf.readUInt8(offset + 1) << 8) | (buf.readUInt8(offset + 2) << 16);
      lastBlock = (bhdr & 1) === 1;
      const blockSize = bhdr >>> 3;
      offset += 3 + blockSize;
    }
    if (checksum) offset += 4;
    frames.push(buf.subarray(start, offset));
  }
  return frames;
}

async function parseSessionLog(filePath) {
  const buf = await readFile(filePath);
  const frames = findFrames(buf);
  const events = [];
  for (const frame of frames) {
    try {
      const text = (await dec(frame)).toString('utf8');
      for (const line of text.split('\n').filter(l => l.trim())) {
        events.push(JSON.parse(line));
      }
    } catch (err) {}
  }
  return events;
}

async function listSessions() {
  try {
    const workspaces = await readdir(SESSIONS_DIR, { withFileTypes: true });
    const sessions = [];
    for (const workspace of workspaces) {
      if (!workspace.isDirectory()) continue;
      const workspacePath = join(SESSIONS_DIR, workspace.name);
      const sessionDirs = await readdir(workspacePath, { withFileTypes: true });
      for (const sessionDir of sessionDirs) {
        if (!sessionDir.isDirectory()) continue;
        const sessionPath = join(workspacePath, sessionDir.name);
        const files = await readdir(sessionPath);
        const logFile = files.find(f => f.endsWith('.jsonl.zstd'));
        if (logFile) {
          const filePath = join(sessionPath, logFile);
          const stats = await stat(filePath);
          sessions.push({
            workspace: workspace.name,
            sessionId: sessionDir.name,
            file: logFile,
            path: filePath,
            size: stats.size,
            modified: stats.mtime.toISOString()
          });
        }
      }
    }
    return sessions.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  } catch (err) {
    console.error('Error listing sessions:', err);
    return [];
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (url.pathname === '/api/sessions') {
    try {
      const sessions = await listSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/session') {
    const path = url.searchParams.get('path');
    if (!path) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path parameter' }));
      return;
    }
    try {
      const events = await parseSessionLog(path);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(events));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log('Session Log Viewer API running at http://localhost:' + PORT);
  console.log('Sessions directory: ' + SESSIONS_DIR);
});
;

fs.writeFileSync(path.join(__dirname, 'session-viewer-server.mjs'), serverCode);
console.log('Created session-viewer-server.mjs');
