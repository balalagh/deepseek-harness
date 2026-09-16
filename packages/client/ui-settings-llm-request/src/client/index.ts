/**
 * LLM Request settings plugin: displays information about system prompt,
 * persona, runtime context, skills, and tools configuration.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LlmRequestSection } from './LlmRequestSection.tsx'
import { en, zh, type LlmRequestKey } from './locales.ts'

export type { LlmRequestSectionProps } from './LlmRequestSection.tsx'
export type { LlmRequestKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.llmRequest': LlmRequestKey
  }
}

const NS = 'settings.llmRequest'

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-llm-request: dictionaries')

  const t = ctx.locale.bind(NS)

  const injected = () => ({ t })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'llm-request',
    order: 25,
    label: () => t('nav'),
    inject: injected,
  }, LlmRequestSection))
}
