#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { zstdDecompress } from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dec = promisify(zstdDecompress);
const ZSTD_MAGIC = 0xFD2FB528;
const DSH_HOME = join(homedir(), '.dsh');
const SESSIONS_DIR = join(DSH_HOME, 'sessions');
const PORT = 3100;

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, 'session-viewer.html');

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

function extractLlmRequests(events) {
  const requests = [];
  let current = null;
  for (const e of events) {
    if (e.type === 'request/header') {
      if (current) requests.push(current);
      const cfg = e.data?.header?.config || {};
      const tools = (e.data?.header?.tools || []).map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));
      current = { seq: e.seq, provider: cfg.provider, model: cfg.model, reason: e.data?.reason, effort: cfg.reasoningEffort, maxTokens: cfg.maxTokens, tools, systemPrompt: '', personaPrefix: '', runtimeContext: '', skillsList: '', messages: [] };
    }
    if (!current) continue;
    if (e.type === 'system/message') {
      current.systemPrompt = (e.data?.message?.content || []).map(b => b.text || '').join('');
    } else if (e.type === 'user/message') {
      const src = e.data?.message?.source;
      const text = (e.data?.message?.content || []).map(b => b.text || '').join('');
      if (src?.kind === 'plugin' && src?.plugin === '@deepseek-ai/dsh-system-prompt' && text.startsWith('Current runtime context')) {
        current.runtimeContext = text;
      } else if (src?.kind === 'agent-instructions') {
        current.skillsList = text;
      } else if (src?.kind === 'user') {
        current.messages.push({ role: 'user', text });
      } else if (src?.kind === 'plugin' && src?.form === 'snapshot') {
        current.runtimeContext = text;
      }
    } else if (e.type === 'assistant/message') {
      const text = (e.data?.message?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      const toolCalls = (e.data?.message?.content || []).filter(b => b.type === 'tool-call').map(b => ({ name: b.name, args: b.arguments }));
      if (text || toolCalls.length) current.messages.push({ role: 'assistant', text, toolCalls });
    } else if (e.type === 'tool/call') {
      current.messages.push({ role: 'tool_call', name: e.data?.name, args: e.data?.arguments });
    } else if (e.type === 'tool/result') {
      const blocks = e.data?.message?.content || [];
      let text = '';
      for (const b of blocks) {
        if (b.type === 'text') text += b.text;
        else if (b.type === 'tool-result' && b.content) for (const c of b.content) if (c.type === 'text') text += c.text;
      }
      current.messages.push({ role: 'tool_result', text });
    }
  }
  if (current) requests.push(current);
  for (const req of requests) {
    const sp = req.systemPrompt;
    const personaMatch = sp.match(/^You are an AI agent powered by[^
]*\.

([\s\S]*?)(?=

You can |

Two planes|$)/);
    req.personaPrefix = personaMatch ? personaMatch[1].trim() : sp.split(/

(?!$)/)[0]?.trim() || '';
  }
  return requests;
}
function parseSessionLog(filePath) {
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

  if (url.pathname === '/' || url.pathname === '/index.html') {
    try {
      const html = await readFile(HTML_PATH, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Failed to load HTML: ' + err.message);
    }
    return;
  }

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


  if (url.pathname === '/api/llm-request') {
    const path = url.searchParams.get('path');
    if (!path) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing path' })); return; }
    try { const events = await parseSessionLog(path); const requests = extractLlmRequests(events); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(requests)); } catch (err) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
    return;
  }
  if (url.pathname === '/llm-request.html') {
    try { const htmlPath = join(__dirname, 'llm-request-viewer.html'); const html = await readFile(htmlPath, 'utf8'); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); } catch (err) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Failed: ' + err.message); }
    return;
  }
  if (url.pathname === '/llm-request-settings' || url.pathname === '/llm-request-settings.html') {
    try { const htmlPath = join(__dirname, 'llm-request-settings.html'); const html = await readFile(htmlPath, 'utf8'); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); } catch (err) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Failed: ' + err.message); }
    return;
  }
  if (url.pathname === '/api/open-file') {
    const filePath = url.searchParams.get('path');
    if (filePath) {
      try {
        const { exec } = await import('node:child_process');
        exec("explorer /select," + filePath, () => {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path' }));
    }
    return;
  }
  if (url.pathname === '/api/open-file') {
    const filePath = url.searchParams.get('path');
    if (filePath) {
      try {
        const { exec } = await import('node:child_process');
        exec("explorer /select," + filePath, () => {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path' }));
    }
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log('Session Log Viewer running at http://localhost:' + PORT);
  console.log('Sessions directory: ' + SESSIONS_DIR);
  console.log('HTML page: ' + HTML_PATH);
});
