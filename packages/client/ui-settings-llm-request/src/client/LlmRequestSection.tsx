/**
 * LLM Request Settings: shows the system prompt assembly mapping table.
 * Light theme, DSH style. Clicking a file path opens its parent folder
 * through the open-in-app system so the user can locate the source file
 * in the native file manager.
 */
import { useState, useCallback } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-host-open-in-app/shared'
import css from './LlmRequestSection.module.css'

export type LlmRequestSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.llmRequest'>

type RegistryRow = {
  order: number
  sectionName: string
  filePath: string
  customizability: 'yes' | 'partial' | 'no'
  note?: string
}

const ROOT = 'E:\\ghWork\\deepseek__harness\\deepseek-harness\\'

const SECTIONS_CORE: RegistryRow[] = [
  { order: -1000, sectionName: 'harness:identity', filePath: 'packages/core/system-prompt/src/index.ts', customizability: 'partial', note: 'includeHarnessIdentity' },
  { order: 0, sectionName: 'deployment:persona-prefix', filePath: 'packages/core/system-prompt/src/index.ts', customizability: 'yes', note: 'personaPrefix' },
  { order: 500, sectionName: 'plan:policy', filePath: 'packages/plan/plan-mode/src/index.ts', customizability: 'partial', note: 'plan-mode plugin' },
  { order: 600, sectionName: 'team:policy', filePath: 'packages/experimental/tool-agent-team/src/index.ts', customizability: 'partial' },
  { order: 900, sectionName: 'context:file-reference', filePath: 'packages/context/file-reference-local/src/index.ts', customizability: 'no' },
  { order: 9900, sectionName: '(structured output schema)', filePath: '', customizability: 'partial' },
  { order: 10000, sectionName: 'app:harness-source', filePath: 'packages/boot/app-boot/src/index.ts', customizability: 'partial', note: 'launch path' },
  { order: 10100, sectionName: 'app:web-surface', filePath: 'packages/bundle/web-app/src/index.ts', customizability: 'partial', note: 'runtime URL' },
  { order: 10200, sectionName: 'deployment:persona-suffix', filePath: 'packages/core/system-prompt/src/index.ts', customizability: 'yes', note: 'personaSuffix' },
]

const SECTIONS_TOOLS: RegistryRow[] = [
  { order: 1000, sectionName: 'tool:bash', filePath: 'packages/shell/tool-bash/src/index.ts', customizability: 'no' },
  { order: 1010, sectionName: 'tool:pwsh', filePath: 'packages/shell/tool-pwsh/src/index.ts', customizability: 'no' },
  { order: 1100, sectionName: 'tool:read', filePath: 'packages/fs/tool-fs/src/read.ts', customizability: 'no' },
  { order: 1200, sectionName: 'tool:write', filePath: 'packages/fs/tool-fs/src/write.ts', customizability: 'no' },
  { order: 1300, sectionName: 'tool:edit', filePath: 'packages/fs/tool-fs/src/edit.ts', customizability: 'no' },
  { order: 1400, sectionName: 'tool:glob', filePath: 'packages/fs/tool-fs-search/src/glob.ts', customizability: 'no' },
  { order: 1500, sectionName: 'tool:grep', filePath: 'packages/fs/tool-fs-search/src/grep.ts', customizability: 'no' },
  { order: 1600, sectionName: 'tool:jobs', filePath: 'packages/jobs/tool-jobs/src/index.ts', customizability: 'no' },
  { order: 1700, sectionName: 'tool:pty', filePath: 'packages/terminal/tool-terminal/src/index.ts', customizability: 'no' },
  { order: 2000, sectionName: 'tool:web_search', filePath: 'packages/web/tool-web/src/search.ts', customizability: 'no' },
  { order: 2100, sectionName: 'tool:web_fetch', filePath: 'packages/web/tool-web/src/fetch.ts', customizability: 'no' },
  { order: 2200, sectionName: 'tool:lsp', filePath: 'packages/lsp/tool-lsp/src/index.ts', customizability: 'no' },
  { order: 2300, sectionName: 'tool:session-query', filePath: 'packages/session-query/tool-session-query/src/index.ts', customizability: 'no' },
  { order: 2400, sectionName: 'tool:goal', filePath: 'packages/goal/tool-goal/src/index.ts', customizability: 'no' },
  { order: 2500, sectionName: 'tool:cordis', filePath: 'packages/extensions/tool-cordis/src/index.ts', customizability: 'no' },
  { order: 2600, sectionName: 'tool:workflow', filePath: 'packages/workflow/tool-workflow/src/index.ts', customizability: 'no' },
  { order: 2700, sectionName: 'tool:ralph', filePath: 'packages/workflow/tool-ralph/src/index.ts', customizability: 'no' },
  { order: 2800, sectionName: 'tool:subagent', filePath: 'packages/subagent/tool-subagent/src/index.ts', customizability: 'no' },
  { order: 5000, sectionName: 'tools:sdk', filePath: '', customizability: 'partial', note: 'by plan-mode or bundle' },
  { order: 9000, sectionName: 'ui:deliverable-file-references', filePath: 'packages/client/ui-deliverables/src/index.ts', customizability: 'no' },
]

function resolvePath(path: string): string {
  if (path.length > 2 && path[1] === ':') return path
  return ROOT + path.replace(/\//g, '\\\\')
}

/** Extract the parent directory from an absolute file path. */
function parentDir(abs: string): string {
  const idx = abs.lastIndexOf('\\')
  return idx >= 0 ? abs.slice(0, idx) : abs
}

/** Resolve the host origin for API calls, matching the open-in-app controller. */
function hostBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

/** File-manager app ids tried in platform order. */
const FILE_MANAGERS = ['explorer', 'finder', 'filemanager']

/**
 * Open one absolute directory in the OS file manager using the open-in-app
 * system. On failure the path remains on the clipboard.
 */
async function openInFolder(dir: string, showToast: (msg: string) => void): Promise<void> {
  try {
    const res = await fetch(new URL('/open-in-app/apps', hostBase()), {
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return
    const { apps } = (await res.json()) as { apps: readonly string[] }
    const appId = FILE_MANAGERS.find(id => apps.includes(id))
    if (!appId) return
    const openRes = await fetch(new URL('/open-in-app/open', hostBase()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: appId, path: dir }),
    })
    if (openRes.ok) {
      showToast('\u5df2\u6253\u6240\u5728\u6587\u4ef6\u5939')
      return
    }
  } catch {
    // Network or parse failure: fall through to clipboard fallback below.
  }
  showToast('\u5df2\u590d\u5236\u6587\u5939\u8def\u5f84')
}

export function LlmRequestSection({ t }: LlmRequestSectionProps) {
  const [toast, setToast] = useState('')

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }, [])

  const openFile = useCallback((path: string) => {
    const abs = resolvePath(path)
    const dir = parentDir(abs)
    // Copy the directory path to clipboard as a reliable fallback.
    navigator.clipboard.writeText(dir).catch(() => {})
    // Open the parent folder through the open-in-app system.
    openInFolder(dir, showToast)
  }, [showToast])

  return (
    <div className={css.section}>
      <div className={css.title}>{t('title')}</div>
      <p className={css.desc}>{t('description')}</p>
      <div className={css.notice}>{t('globalNotice')}</div>

      <div className={css.actions}>
        <button type="button" className={css.cordisBtn} onClick={() => openFile('packages/bundle/web-app/cordis.patch.yml')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          {t('openCordisCfg')}
        </button>
        <button type="button" className={css.cordisBtn} onClick={() => openFile('C:\\Users\\Engma\\.dsh\\profiles\\web\\cordis.patch.yml')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          {t('openCordisProfile')}
        </button>
      </div>

      <h3 className={css.groupTitle}>{t('sectionGroup.core')}</h3>
      <table className={css.table}>
        <thead>
          <tr>
            <th className={css.colOrder}>{t('table.order')}</th>
            <th className={css.colName}>{t('table.sectionName')}</th>
            <th className={css.colFile}>{t('table.regFile')}</th>
            <th className={css.colCustom}>{t('table.customizable')}</th>
          </tr>
        </thead>
        <tbody>
          {SECTIONS_CORE.map(r => <Row key={r.sectionName} row={r} t={t} openFile={openFile} />)}
        </tbody>
      </table>

      <h3 className={css.groupTitle}>{t('sectionGroup.tools')}</h3>
      <table className={css.table}>
        <thead>
          <tr>
            <th className={css.colOrder}>{t('table.order')}</th>
            <th className={css.colName}>{t('table.sectionName')}</th>
            <th className={css.colFile}>{t('table.regFile')}</th>
            <th className={css.colCustom}>{t('table.customizable')}</th>
          </tr>
        </thead>
        <tbody>
          {SECTIONS_TOOLS.map(r => <Row key={r.sectionName} row={r} t={t} openFile={openFile} />)}
        </tbody>
      </table>

      {toast && (
        <div style={{ position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',background:'#1a1a1a',color:'#fff',padding:'8px 16px',borderRadius:8,fontSize:13,zIndex:9999,transition:'all .3s',whiteSpace:'nowrap' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

type RowProps = { row: RegistryRow; t: (key: string) => string; openFile: (path: string) => void }

function Row({ row, t, openFile }: RowProps) {
  const customizableKey = 'customizable.' + row.customizability
  const hintKey = customizableKey + 'Hint'
  return (
    <tr>
      <td className={css.colOrder + ' ' + css.cell}>{row.order}</td>
      <td className={css.colName + ' ' + css.cell}>
        <code className={css.code}>{row.sectionName}</code>
        {row.note && <span className={css.note}>{row.note}</span>}
      </td>
      <td className={css.colFile + ' ' + css.cell}>
        {row.filePath ? (
          <button type="button" className={css.fileBtn} onClick={() => openFile(row.filePath)} title={t('openFile')}>
            {row.filePath}
          </button>
        ) : <span className={css.muted}>-</span>}
      </td>
      <td className={css.colCustom + ' ' + css.cell}>
        <span className={`${css.badge} ${css['badge' + row.customizability]}`} title={t(hintKey)}>
          {t(customizableKey)}
        </span>
      </td>
    </tr>
  )
}
