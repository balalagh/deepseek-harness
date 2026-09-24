/**
 * 高考数据查询工具：省份控制线、院校录取数据、一分一段表、志愿填报规则。
 * 通过 HTTP 调用本地 gaokao-api 微服务，不直连数据库。
 * @module @deepseek-ai/dsh-tool-gaokao-query
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

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
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          province: { type: 'string' },
          year: { type: 'integer' },
          count: { type: 'integer' },
          data: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                province: { type: 'string' },
                year: { type: 'integer' },
                subject: { type: 'string' },
                batch: { type: 'string' },
                score: { type: 'integer' },
                rank: { type: 'integer' },
              },
            },
          },
        },
      },
      render(_args: unknown, value: any): ContentBlock[] {
        return [{ type: 'text',
          text: `${value.province} ${value.year}年控制线：\n`
            + (value.data as any[]).map((r: any) =>
              `${r.subject} ${r.batch}: ${r.score}分 (${r.rank})`,
            ).join('\n'),
        }]
      },
    },
    async execute(args: any, exec: any) {
      return apiGet(base, '/api/province-control-line',
        { province: args.province, year: args.year ?? 2025 }, exec.signal) as any
    },
    presentCall: (args: any) =>
      ({ card: 'generic' as const, title: '省份控制线查询', kind: 'other' as const, rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'query_college_admission_data',
    description:
      '查询院校专业录取数据，按省份、选科、院校专业组模式等筛选。',
    parameters: {
      exam_province: { type: 'string', required: true, description: '高考省份，如 浙江' },
      subject: { type: 'string', required: true, description: '选科，逗号分隔，如：物理,化学,生物' },
      college_major_group: { type: 'integer', required: true, description: '0=专业+院校模式，1=院校专业组模式' },
      school_province: { type: 'string', description: '学校所在省份，多个用逗号分隔' },
      school_city: { type: 'string', description: '学校所在城市，多个用逗号分隔' },
      school_name: { type: 'string', description: '学校名字，多个用逗号分隔' },
      year: { type: 'integer', description: '年份，仅支持2024/2025' },
      major_name: { type: 'string', description: '专业名，多个用逗号分隔' },
      parsed_major_name: { type: 'string', description: '解析后的专业名，多个用逗号分隔' },
      major_category: { type: 'string', description: '专业类，多个用逗号分隔' },
      sino_foreign: { type: 'integer', description: '是否为中外合办' },
      admission_score_min: { type: 'integer', description: '分数最小值' },
      admission_score_max: { type: 'integer', description: '分数最大值' },
      admission_rank_min: { type: 'integer', description: '位次最小值' },
      admission_rank_max: { type: 'integer', description: '位次最大值' },
      fields: { type: 'string', description: '可选字段，逗号分隔，不传则返回全部。可选：school_province(学校省份),school_city(学校城市),school_name(学校),school_code(学校代码),year(年份)undergraduate_type(大学类型),major_group_code(专业组代码),major_code(专业代码),major_name(专业名),parsed_major_name(解析专业名),major_category(专业类),campus(校区),subject_requirement(选科要求)study_duration(学制),major_note(备注),sino_foreign(中外合办),tuition_fee(学费),parsed_tuition_fee(解析学费),enrollment_plan(招生计划),admission_score(录取分数),admission_rank(录取位次)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {
        count: { type: 'integer' },
        data: { type: 'array', required: true, items: { type: 'object', additionalProperties: true, properties: {
          school_name: { type: 'string' },
          major_name: { type: 'string' },
          admission_score: { type: 'integer' },
          admission_rank: { type: 'integer' },
        } } },
      } },
      render(_args: unknown, value: any): ContentBlock[] {
        const args = _args as any
        const isGroup = args.college_major_group === 1
        const FIELD_LABELS: Record<string, string> = {
          school_province: '学校省份',
          school_city: '学校城市',
          school_name: '学校',
          school_code: '学校代码',
          year: '年份',
          undergraduate_type: '大学类型',
          major_group_code: '专业组',
          major_code: '专业代码',
          major_name: '专业（类）',
          parsed_major_name: '专业（类）包含专业',
          major_category: '专业类',
          campus: '校区',
          subject_requirement: '选科要求',
          study_duration: '学制',
          major_note: '备注',
          sino_foreign: '中外合办',
          tuition_fee: '学费',
          parsed_tuition_fee: '解析学费',
          enrollment_plan: '招生计划',
          admission_score: '分数',
          admission_rank: '位次',
        }
        const fixedKeys = isGroup
          ? ['school_name', 'major_group_code', 'major_code', 'major_name', 'parsed_major_name', 'admission_score', 'admission_rank']
          : ['school_name', 'major_code', 'major_name', 'parsed_major_name', 'admission_score', 'admission_rank']
        const requested: string[] = args.fields ? args.fields.split(',').map((s: string) => s.trim()).filter(Boolean) : []
        const keys = requested.length > 0 ? [...new Set([...fixedKeys, ...requested])] : Object.keys(FIELD_LABELS)
        const columns = keys.filter((k: string) => k in FIELD_LABELS).map((k: string) => ({ key: k, label: FIELD_LABELS[k] }))
        const header = columns.map(c => c.label).join(' | ')
        const rows = (value.data as any[]).map((r: any) =>
          columns.map(c => r[c.key] ?? '').join(' | '))
        const queryInfo = `查询条件: 省份=${args.exam_province} 选科=${args.subject} 模式=${isGroup ? '院校专业组' : '专业类+院校'} 年份=${args.year ?? '不限'}`
        return [{ type: 'text', text: `${queryInfo}\n共 ${value.count} 条结果\n${header}\n${rows.join('\n')}` }]
      },
    },
    async execute(args: any, exec: any) {
      const isGroup = args.college_major_group === 1
      const fixedFields = isGroup
        ? 'school_name,major_group_code,major_code,major_name,parsed_major_name,admission_score,admission_rank'
        : 'school_name,major_code,major_name,parsed_major_name,admission_score,admission_rank'
      const allFields = 'school_province,school_city,school_name,school_code,year,undergraduate_type,major_group_code,major_code,major_name,parsed_major_name,major_category,campus,subject_requirement,study_duration,major_note,sino_foreign,tuition_fee,parsed_tuition_fee,enrollment_plan,admission_score,admission_rank'
      const mergedFields = args.fields
        ? [...new Set([...fixedFields.split(','), ...(args.fields as string).split(',').map((s: string) => s.trim()).filter(Boolean)])].join(',')
        : allFields
      return apiGet(base, '/api/college-admission', { ...args, fields: mergedFields }, exec.signal) as any
    },
    presentCall: (args: any) =>
      ({ card: 'generic' as const, title: '院校录取数据查询', kind: 'other' as const, rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'query_yifenyiduan',
    description:
      '查询一分一段表数据，返回每个分数对应的本段人数和累计人数。',
    parameters: {
      province: { type: 'string', required: true, description: '省份，如：浙江' },
      year: { type: 'integer', required: true, description: '年份' },
      subject_combination: { type: 'string', required: true, description: '选科：物理、历史、或总' },
      score: { type: 'integer', required: true, description: '要查询的分数' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {
        province: { type: 'string' },
        year: { type: 'integer' },
        count: { type: 'integer' },
        data: { type: 'array', required: true, items: { type: 'object', additionalProperties: true, properties: {
          score: { type: 'integer' },
          segment_count: { type: 'integer' },
          cumulative_count: { type: 'integer' },
          province: { type: 'string' },
          year: { type: 'integer' },
          subject_combination: { type: 'string' },
        } } },
      } },
      render(_args: unknown, value: any): ContentBlock[] {
        const rows = (value.data as any[]).map((r: any) =>
          `${r.score}分: 本段${r.segment_count}人 / 累计${r.cumulative_count}人`)
        return [{ type: 'text', text: `${value.province} ${value.year}年 一分一段：\n${rows.join('\n')}` }]
      },
    },
    async execute(args: any, exec: any) {
      return apiGet(base, '/api/score-segment', {
        province: args.province,
        year: args.year,
        subject_combination: args.subject_combination,
        score: args.score,
      }, exec.signal) as any
    },
    presentCall: (args: any) =>
      ({ card: 'generic' as const, title: '一分一段表查询', kind: 'other' as const, rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'query_province_rule',
    description:
      '查询省份高考志愿填报规则，支持选科模式、填报模式、志愿数量等信息。',
    parameters: {
      province: { type: 'string', required: true, description: '省份，如：浙江' },
      year: { type: 'integer', required: true, description: '年份，仅支持 2026、2027' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {
        province: { type: 'string' },
        year: { type: 'integer' },
        subject_mode: { type: 'integer' },
        fill_mode: { type: 'string' },
        fill_count: { type: 'integer' },
        group_major_count: { type: 'integer' },
      } },
      render(_args: unknown, value: any): ContentBlock[] {
        return [{ type: 'text',
          text: value.province + ' ' + value.year + '年志愿填报规则：\n'
            + '选科模式：' + (value.subject_mode === 1 ? '3+1+2模式' : '3+3模式') + '\n'
            + '填报模式：' + (value.fill_mode === 'GROUP' ? '院校专业组模式' : '专业（类）+院校模式') + '\n'
            + '志愿数量：' + value.fill_count
            + (value.fill_mode === 'GROUP' && value.group_major_count !== undefined ? '\n专业组内可填志愿数量：' + value.group_major_count : ''),
        }]
      },
    },
    async execute(args: any, exec: any) {
      return apiGet(base, '/api/province-fill-rule',
        { province: args.province, year: args.year }, exec.signal) as any
    },
    presentCall: (args: any) =>
      ({ card: 'generic' as const, title: '省份填报规则查询', kind: 'other' as const, rawInput: args }),
  }))
}
