$f = "E:\ghWork\deepseek_harness\deepseek-harness\scripts\session-viewer-server.mjs"
$c = Get-Content $f -Raw

$fn = @'

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
    const personaMatch = sp.match(/^You are an AI agent powered by[^\n]*\.\n\n([\s\S]*?)(?=\n\nYou can |\n\nTwo planes|$)/);
    req.personaPrefix = personaMatch ? personaMatch[1].trim() : '';
  }
  return requests;
}
