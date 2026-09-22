/**
 * 高考数据查询工具：省份控制线、院校录取数据、一分一段表。
 * 通过 HTTP 调用本地 gaokao-api 微服务，不直连数据库。
 * @module @deepseek-ai/dsh-tool-gaokao-query
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-gaokao-query'
export const inject = ['tools']

export interface Config {
  apiUrl?: string
}

export const Config: z<Config> = z.object({
  apiUrl: z.string(),
})

async function apiGet(
  baseUrl: string,
  path: string,
  params: Record<string, string | number | undefined>,
  signal?: AbortSignal,
): Promise<any> {
  const url = new URL(path, baseUrl)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }
  const init: RequestInit = {}
  if (signal) init.signal = signal
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`gaokao-api ${res.status}: ${text}`)
  }
  return res.json()
}

export function apply(ctx: Context, config: Config): void {
  const base = config.apiUrl ?? 'http://127.0.0.1:8901'
  ctx.tools.register(defineTool({
    name: 'query_province_control_line',
    description:
      '查询某省份某年的高考各批次控制分数线。',
    parameters: {
      province: { type: 'string', required: true, description: '省份，如：浙江' },
      year: { type: 'integer', description: '年份，默认 2025' },
      subject: { type: 'string', description: '科目类型' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      province: { type: 'string' },
      year: { type: 'integer' },
      count: { type: 'integer' },
      data: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        province: { type: 'string' },
        year: { type: 'integer' },
        subject: { type: 'string' },
        batch: { type: 'string' },
        score: { type: 'integer' },
        rank: { type: 'integer' },
      } } },
    } } },
    render: (_args, value) => [{ type: 'text',
      text: `${value.province} ${value.year}年控制线：\n` + (value.data as any[]).map(r => `${r.subject} ${r.batch}: ${r.score}分 (${r.rank})`).join('\n'),
    }],
    async execute(args, exec) {
      return apiGet(base, '/api/province-control-line', { province: args.province, year: args.year ?? 2025 }, exec.signal)
    },
    presentCall: (args) => ({ card: 'generic', title: '省份控制线查询', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'query_college_admission_data',
    description:
      '查询院校专业录取数据，按省份、选科、院校专业组模式等筛选。',
    parameters: {
      exam_province: { type: 'string', required: true, description: '高考省份，如 浙江' },
      subject: { type: 'array', required: true, items: { type: 'string' }, description: '选科' },
      college_major_group: { type: 'integer', required: true, description: '0=专业+院校模式，1=院校专业组模式' },
      school_province: { type: 'array', items: { type: 'string' }, description: '学校所在省份' },
      school_city: { type: 'array', items: { type: 'string' }, description: '学校所在城市' },
      school_name: { type: 'array', items: { type: 'string' }, description: '学校名字' },
      year: { type: 'integer', description: '年份' },
      major_name: { type: 'array', items: { type: 'string' }, description: '专业名' },
      parsed_major_name: { type: 'array', items: { type: 'string' }, description: '解析后的专业名' },
      major_category: { type: 'array', items: { type: 'string' }, description: '专业类' },
      sino_foreign: { type: 'integer', description: '是否为中外合办' },
      admission_score_min: { type: 'integer', description: '分数最小值' },
      admission_score_max: { type: 'integer', description: '分数最大值' },
      admission_rank_min: { type: 'integer', description: '位次最小值' },
      admission_rank_max: { type: 'integer', description: '位次最大值' },
      fields: { type: 'array', items: { type: 'string' }, description: '需要返回的字段列表，不传则返回全部22个字段' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer' },
          data: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                school_province: { type: 'string' },
                school_city: { type: 'string' },
                school_name: { type: 'string' },
                school_code: { type: 'string' },
                year: { type: 'integer' },
                batch: { type: 'string' },
                undergraduate_type: { type: 'string' },
                major_group_code: { type: 'string' },
                major_code: { type: 'string' },
                major_name: { type: 'string' },
                parsed_major_name: { type: 'string' },
                major_category: { type: 'string' },
                campus: { type: 'string' },
                subject_requirement: { type: 'string' },
                study_duration: { type: 'number' },
                major_note: { type: 'string' },
                sino_foreign: { type: 'integer' },
                tuition_fee: { type: 'string' },
                parsed_tuition_fee: { type: 'number' },
                enrollment_plan: { type: 'integer' },
                admission_score: { type: 'integer' },
                admission_rank: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  }))
}