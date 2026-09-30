/**
 * 艺考数据查询工具：政策矩阵、投档明细、校考院校名单、可报考专业目录、招生模式总览。
 *
 * 五个工具查同一份外部数据集（`Config.dataPath` 指向的 JSON，由本包
 * `scripts/convert_art_xlsx.py` 从艺术类招生工作簿生成），不联网、不连库。
 * 数据集在第一次调用时按 mtime 载入并驻留内存：重跑转换脚本后无需重启进程。
 * @module @deepseek-ai/dsh-tool-art-query
 */

import { readFileSync, statSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import { defineTool, type InferValue } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'tool-art-query'
export const inject = ['tools']

/** 插件配置：数据集位置与单次返回行数上限。 */
export interface Config {
  /**
   * 数据集 JSON 的绝对路径，必填：数据随部署变化，包内不携带数据。
   * 缺失或指向非数据集文件在第一次工具调用时报错，而不是静默返回空结果。
   */
  dataPath: string
  /** 单个列表型工具最多返回多少行；超出的行计入 `count` 并在结果里标注截断。 */
  maxRows?: number
}

export const Config: z<Config> = z.object({
  dataPath: z.string().required(),
  maxRows: z.natural().default(200),
})

/** 数据集里的一行：表头名 → 已归一的值。 */
type Row = Record<string, unknown>

/** 数据集里承载行的五个集合名。 */
const COLLECTIONS = [
  'policy_matrix',
  'admission_detail',
  'school_exam',
  'major_catalog',
  'admission_mode_overview',
] as const

/** 集合名。 */
type Collection = typeof COLLECTIONS[number]

/** 数据集文件的结构；五个集合都必须存在。 */
type Dataset = Record<Collection, Row[]>

/**
 * 取出数据集的五个集合，逐个确认存在且是数组。
 * @param document - 解析出的 JSON 值。
 * @returns 五个集合都可作为行数组使用的数据集。
 * @throws when a collection is absent or is not an array.
 */
function collectionsOf(document: unknown): Dataset {
  const source = (document ?? {}) as Record<string, unknown>
  const rowsOf = (collection: Collection): Row[] => {
    const value = source[collection]
    if (!Array.isArray(value)) throw new TypeError(`数据集缺少集合 ${collection}`)
    return value as Row[]
  }
  return {
    policy_matrix: rowsOf('policy_matrix'),
    admission_detail: rowsOf('admission_detail'),
    school_exam: rowsOf('school_exam'),
    major_catalog: rowsOf('major_catalog'),
    admission_mode_overview: rowsOf('admission_mode_overview'),
  }
}

/** 可空字符串字段（每次新建，schema 对象不在工具之间共享）。 */
function nullableString() {
  return { oneOf: [{ type: 'string' }, { type: 'null' }] } as const
}

/** 可空数值字段。 */
function nullableNumber() {
  return { oneOf: [{ type: 'number' }, { type: 'null' }] } as const
}

/** 一行的文本字段：非字符串一律读作缺失。 */
function textOf(row: Row, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/** 一行的数值字段：非有限数值读作缺失。 */
function numberOf(row: Row, key: string): number | null {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 省份、院校名这类筛选值：允许简称命中全称。 */
function sameName(value: string | null, wanted: string): boolean {
  if (value === null) return false
  return value === wanted || value.includes(wanted) || wanted.includes(value)
}

/** 列表筛选：未传列表表示不过滤，否则命中任意一项即可。 */
function matchesAny(value: string | null, wanted: readonly string[] | undefined): boolean {
  if (wanted === undefined || wanted.length === 0) return true
  return wanted.some(entry => sameName(value, entry))
}

/** 分数区间筛选：未给的边界不过滤；给定边界时缺分值的行不参与。 */
function inScoreRange(score: number | null, min: number | undefined, max: number | undefined): boolean {
  if (min === undefined && max === undefined) return true
  if (score === null) return false
  if (min !== undefined && score < min) return false
  if (max !== undefined && score > max) return false
  return true
}

/** 科类筛选：原始科类名或归一后的统考类别命中任一请求值即可。 */
function matchesCategory(row: Row, wanted: readonly string[] | undefined): boolean {
  if (wanted === undefined || wanted.length === 0) return true
  const raw = textOf(row, '科类')
  const category = textOf(row, 'category')
  return wanted.some(entry => sameName(raw, foldParens(entry)) || category === foldParens(entry))
}

/** 全角括号折成半角：数据集里同一类别有多种括号写法。 */
function foldParens(value: string): string {
  return value.replaceAll('（', '(').replaceAll('）', ')')
}

/** 数值降序，缺分值的行排在最后。 */
function byScoreDesc(left: Row, right: Row): number {
  const a = numberOf(left, '投档最低综合分') ?? Number.NEGATIVE_INFINITY
  const b = numberOf(right, '投档最低综合分') ?? Number.NEGATIVE_INFINITY
  return b - a
}

/** 缺失值的模型可见写法：写明未收录，避免被读成 0 或空串。 */
function display(value: string | number | null): string {
  return value === null ? '（未收录）' : String(value)
}

/** 政策矩阵的 19 个输出字段，顺序即结果里的字段顺序。 */
const POLICY_FIELDS = [
  '统考科类设置',
  '2026统考时间（分科类）',
  '批次设置（录取顺序）',
  '志愿模式',
  '综合分模式归类',
  '美术与设计类综合分',
  '音乐类综合分',
  '舞蹈类综合分',
  '表(导)演类综合分',
  '播音与主持类综合分',
  '书法类综合分',
  '其他（戏曲联考等）',
  '专业统考满分与科目构成',
  '文化控制线政策',
  '校考政策',
  '特殊政策',
  '2026变化',
  '主要官方来源',
  '调研备注',
] as const

/** 投档明细的数值输出字段。 */
const DETAIL_NUMBER_FIELDS = [
  '投档最低综合分',
  '文化总分',
  '专业统考分',
  '语文',
  '数学',
  '外语',
  '三科选考合计',
  '投档/录取数',
  '计划数',
] as const

/** 投档明细的 17 个输出字段，顺序即结果里的字段顺序。 */
const DETAIL_FIELDS = [
  '批次',
  '科类',
  '院校代码',
  '院校',
  '专业组',
  '专业',
  '投档最低综合分',
  '文化总分',
  '专业统考分',
  '语文',
  '数学',
  '外语',
  '三科选考合计',
  '投档/录取数',
  '计划数',
  '分数口径',
  '备注',
] as const

/** 政策矩阵工具的输出 schema。 */
const policyOutput = {
  type: 'object',
  additionalProperties: true,
  properties: {
    count: { type: 'integer' },
    returned: { type: 'integer' },
    truncated: { type: 'boolean' },
    data: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: true,
        properties: ({
          省份: nullableString(),
          统考科类设置: nullableString(),
          '2026统考时间（分科类）': nullableString(),
          '批次设置（录取顺序）': nullableString(),
          志愿模式: nullableString(),
          综合分模式归类: nullableString(),
          美术与设计类综合分: nullableString(),
          音乐类综合分: nullableString(),
          舞蹈类综合分: nullableString(),
          '表(导)演类综合分': nullableString(),
          播音与主持类综合分: nullableString(),
          书法类综合分: nullableString(),
          '其他（戏曲联考等）': nullableString(),
          专业统考满分与科目构成: nullableString(),
          文化控制线政策: nullableString(),
          校考政策: nullableString(),
          特殊政策: nullableString(),
          '2026变化': nullableString(),
          主要官方来源: nullableString(),
          调研备注: nullableString(),
        }),
      },
    },
  },
} as const

/** 政策矩阵工具的值类型。 */
type PolicyValue = InferValue<typeof policyOutput>

/** 投档明细工具的输出 schema。 */
const detailOutput = {
  type: 'object',
  additionalProperties: true,
  properties: {
    count: { type: 'integer' },
    returned: { type: 'integer' },
    truncated: { type: 'boolean' },
    data: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: true,
        properties: ({
          批次: nullableString(),
          科类: nullableString(),
          院校代码: nullableString(),
          院校: nullableString(),
          专业组: nullableString(),
          专业: nullableString(),
          投档最低综合分: nullableNumber(),
          文化总分: nullableNumber(),
          专业统考分: nullableNumber(),
          语文: nullableNumber(),
          数学: nullableNumber(),
          外语: nullableNumber(),
          三科选考合计: nullableNumber(),
          '投档/录取数': nullableNumber(),
          计划数: nullableNumber(),
          分数口径: nullableString(),
          备注: nullableString(),
        }),
      },
    },
  },
} as const

/** 投档明细工具的值类型。 */
type DetailValue = InferValue<typeof detailOutput>

/** 校考院校名单工具的输出 schema。 */
const examOutput = {
  type: 'object',
  additionalProperties: true,
  properties: {
    count: { type: 'integer' },
    returned: { type: 'integer' },
    truncated: { type: 'boolean' },
    data: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: true,
        properties: ({
          院校名称: nullableString(),
          所在地: nullableString(),
          院校性质: nullableString(),
          '2026年校考情况（专业增减）': nullableString(),
        }),
      },
    },
  },
} as const

/** 校考院校名单工具的值类型。 */
type ExamValue = InferValue<typeof examOutput>

/** 可报考专业目录工具的输出 schema。 */
const catalogOutput = {
  type: 'object',
  additionalProperties: true,
  properties: {
    count: { type: 'integer' },
    returned: { type: 'integer' },
    truncated: { type: 'boolean' },
    data: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: true,
        properties: ({
          '统考类别/录取方式': nullableString(),
          包含方向: nullableString(),
          对应本科专业: nullableString(),
          备注: nullableString(),
        }),
      },
    },
  },
} as const

/** 可报考专业目录工具的值类型。 */
type CatalogValue = InferValue<typeof catalogOutput>

/** 招生模式总览工具的输出 schema。 */
const modeOutput = {
  type: 'object',
  additionalProperties: true,
  properties: {
    count: { type: 'integer' },
    returned: { type: 'integer' },
    truncated: { type: 'boolean' },
    data: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: true,
        properties: ({
          招生模式: nullableString(),
          所属类型: nullableString(),
          考试形式: nullableString(),
          报考条件: nullableString(),
          录取规则要点: nullableString(),
          可报考专业: nullableString(),
          备注: nullableString(),
        }),
      },
    },
  },
} as const

/** 招生模式总览工具的值类型。 */
type ModeValue = InferValue<typeof modeOutput>

/** 政策矩阵一行的输出字段。 */
type PolicyItem = PolicyValue['data'][number]

/**
 * 政策矩阵一行的模型可见投影。
 * @param row - 数据集里的一行。
 * @returns 该行的 20 个输出字段，缺失读作 null。
 */
function policyItem(row: Row): PolicyItem {
  return {
    省份: textOf(row, '省份'),
    统考科类设置: textOf(row, '统考科类设置'),
    '2026统考时间（分科类）': textOf(row, '2026统考时间（分科类）'),
    '批次设置（录取顺序）': textOf(row, '批次设置（录取顺序）'),
    志愿模式: textOf(row, '志愿模式'),
    综合分模式归类: textOf(row, '综合分模式归类'),
    美术与设计类综合分: textOf(row, '美术与设计类综合分'),
    音乐类综合分: textOf(row, '音乐类综合分'),
    舞蹈类综合分: textOf(row, '舞蹈类综合分'),
    '表(导)演类综合分': textOf(row, '表(导)演类综合分'),
    播音与主持类综合分: textOf(row, '播音与主持类综合分'),
    书法类综合分: textOf(row, '书法类综合分'),
    '其他（戏曲联考等）': textOf(row, '其他（戏曲联考等）'),
    专业统考满分与科目构成: textOf(row, '专业统考满分与科目构成'),
    文化控制线政策: textOf(row, '文化控制线政策'),
    校考政策: textOf(row, '校考政策'),
    特殊政策: textOf(row, '特殊政策'),
    '2026变化': textOf(row, '2026变化'),
    主要官方来源: textOf(row, '主要官方来源'),
    调研备注: textOf(row, '调研备注'),
  }
}

/** 投档明细一行的输出字段。 */
type DetailItem = DetailValue['data'][number]

/**
 * 投档明细一行的模型可见投影：数值列读作数值，其余读作文本。
 * @param row - 数据集里的一行。
 * @returns 该行的 17 个输出字段。
 */
function detailItem(row: Row): DetailItem {
  return {
    批次: textOf(row, '批次'),
    科类: textOf(row, '科类'),
    院校代码: textOf(row, '院校代码'),
    院校: textOf(row, '院校'),
    专业组: textOf(row, '专业组'),
    专业: textOf(row, '专业'),
    投档最低综合分: numberOf(row, '投档最低综合分'),
    文化总分: numberOf(row, '文化总分'),
    专业统考分: numberOf(row, '专业统考分'),
    语文: numberOf(row, '语文'),
    数学: numberOf(row, '数学'),
    外语: numberOf(row, '外语'),
    三科选考合计: numberOf(row, '三科选考合计'),
    '投档/录取数': numberOf(row, '投档/录取数'),
    计划数: numberOf(row, '计划数'),
    分数口径: textOf(row, '分数口径'),
    备注: textOf(row, '备注'),
  }
}

/** 校考院校一行的输出字段。 */
type ExamItem = ExamValue['data'][number]

/**
 * 校考院校一行的模型可见投影。
 * @param row - 数据集里的一行。
 * @returns 该行的 4 个输出字段。
 */
function examItem(row: Row): ExamItem {
  return {
    院校名称: textOf(row, '院校名称'),
    所在地: textOf(row, '所在地'),
    院校性质: textOf(row, '院校性质'),
    '2026年校考情况（专业增减）': textOf(row, '2026年校考情况（专业增减）'),
  }
}

/** 可报考专业目录一行的输出字段。 */
type CatalogItem = CatalogValue['data'][number]

/**
 * 可报考专业目录一行的模型可见投影。
 * @param row - 数据集里的一行。
 * @returns 该行的 4 个输出字段。
 */
function catalogItem(row: Row): CatalogItem {
  return {
    '统考类别/录取方式': textOf(row, '统考类别/录取方式'),
    包含方向: textOf(row, '包含方向'),
    对应本科专业: textOf(row, '对应本科专业'),
    备注: textOf(row, '备注'),
  }
}

/** 招生模式一行的输出字段。 */
type ModeItem = ModeValue['data'][number]

/**
 * 招生模式一行的模型可见投影。
 * @param row - 数据集里的一行。
 * @returns 该行的 7 个输出字段。
 */
function modeItem(row: Row): ModeItem {
  return {
    招生模式: textOf(row, '招生模式'),
    所属类型: textOf(row, '所属类型'),
    考试形式: textOf(row, '考试形式'),
    报考条件: textOf(row, '报考条件'),
    录取规则要点: textOf(row, '录取规则要点'),
    可报考专业: textOf(row, '可报考专业'),
    备注: textOf(row, '备注'),
  }
}

/**
 * 注册五个艺考数据查询工具。
 * @param ctx - 插件上下文。
 * @param config - 已校验的配置。
 */
export function apply(ctx: Context, config: Config): void {
  const dataPath = config.dataPath
  const maxRows = config.maxRows ?? 200

  let dataset: Dataset | undefined
  let loadedAt = 0

  /**
   * 当前数据集，按文件 mtime 失效。
   * @returns 已校验顶层结构的数据集。
   * @throws when the file is missing, unparsable, or not a dataset document.
   */
  const data = (): Dataset => {
    try {
      const mtime = statSync(dataPath).mtimeMs
      if (dataset === undefined || mtime !== loadedAt) {
        const parsed: unknown = JSON.parse(readFileSync(dataPath, 'utf8'))
        dataset = collectionsOf(parsed)
        loadedAt = mtime
      }
    } catch (error) {
      throw new Error(
        `艺考数据集不可用：${dataPath}；请用本包 scripts/convert_art_xlsx.py 生成它（${String(error)}）`,
      )
    }
    return dataset
  }

  /**
   * 截断到 maxRows 并给出计数与截断标记。
   * @param rows - 候选行，已按工具自己的顺序排好并投影成输出字段。
   * @returns 计数与截断后的行。
   */
  const cap = <T extends Row>(rows: readonly T[]) => ({
    count: rows.length,
    returned: Math.min(rows.length, maxRows),
    truncated: rows.length > maxRows,
    data: rows.slice(0, maxRows),
  })

  ctx.tools.register(defineTool({
    name: 'query_art_policy_matrix',
    description:
      '查询某个省份的艺术类招生政策矩阵：统考科类设置、统考时间、批次设置与录取顺序、志愿模式、综合分模式归类与各科类综合分公式、专业统考满分与科目构成、文化控制线政策、校考政策、特殊政策、年度变化与官方来源。按省份查询，一次返回该省的全部政策条目。',
    parameters: {
      province: { type: 'string', required: true, description: '省份，如：北京、浙江（可用简称）' },
    },
    output: {
      schema: policyOutput,
      render(_args, value: PolicyValue): ContentBlock[] {
        if (value.data.length === 0) {
          const covered = data().policy_matrix.map(row => textOf(row, '省份') ?? '').filter(name => name !== '')
          return [{ type: 'text', text: `未收录该省份的政策矩阵（数据集覆盖：${covered.join('、')}）` }]
        }
        const blocks = value.data.map((row) => {
          const lines = POLICY_FIELDS.map((field) => {
            const value = textOf(row, field)
            return `- ${field}：${value ?? '（未收录）'}`
          })
          return `${textOf(row, '省份') ?? ''} 艺术类政策矩阵：\n${lines.join('\n')}`
        })
        return [{ type: 'text', text: blocks.join('\n\n') }]
      },
    },
    async execute(args) {
      const rows = data().policy_matrix.filter(row => sameName(textOf(row, '省份'), args.province))
      return { count: rows.length, returned: rows.length, truncated: false, data: rows.map(policyItem) }
    },
    presentCall: args =>
      ({ card: 'generic' as const, title: '艺术类政策矩阵查询', kind: 'search' as const, rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'query_admission_detail_2026',
    description:
      '查询艺术类本科批次投档明细（省份与年份必填）：院校专业组的投档最低综合分、文化总分、专业统考分、三科成绩、投档/录取数与计划数，按投档最低综合分从高到低排列。可按统考类别、院校名与投档最低综合分区间进一步筛选。category 既接受数据集中的原始科类名，也接受归一的统考类别：美术与设计类、音乐类、舞蹈类、表(导)演类、播音与主持类、书法类、戏曲类（传归类名会覆盖该类别下音乐表演、音乐教育等各方向）。',
    parameters: {
      year: { type: 'integer', required: true, description: '年份，目前仅支持 2026' },
      province: { type: 'string', required: true, description: '省份，如：浙江（可用简称）' },
      category: {
        type: 'array',
        items: { type: 'string' },
        description: '科类，可多个；如 ["美术与设计类"] 或 ["音乐类(器乐)"]',
      },
      school_name: {
        type: 'array',
        items: { type: 'string' },
        description: '院校名，可多个，按包含匹配；如 ["中央戏剧学院"]',
      },
      admission_max_score: { type: 'number', description: '投档最低综合分上限（含）' },
      admission_min_score: { type: 'number', description: '投档最低综合分下限（含）' },
    },
    output: {
      schema: detailOutput,
      render(args, value: DetailValue): ContentBlock[] {
        if (value.data.length === 0) {
          return [{
            type: 'text',
            text: `${String(args.year)} 年 ${args.province} 没有匹配的投档明细`
              + '（可先用 query_art_policy_matrix 确认该省的科类与批次设置）',
          }]
        }
        const scope = [
          `年份=${String(args.year)}`,
          `省份=${args.province}`,
          args.category === undefined ? '' : `科类=${args.category.join('/')}`,
          args.school_name === undefined ? '' : `院校=${args.school_name.join('/')}`,
          args.admission_min_score === undefined ? '' : `分数≥${String(args.admission_min_score)}`,
          args.admission_max_score === undefined ? '' : `分数≤${String(args.admission_max_score)}`,
        ].filter(entry => entry !== '').join(' ')
        const header = DETAIL_FIELDS.join(' | ')
        const lines = value.data.map(row => DETAIL_FIELDS.map((field) => {
          if ((DETAIL_NUMBER_FIELDS as readonly string[]).includes(field)) return display(numberOf(row, field))
          return textOf(row, field) ?? ''
        }).join(' | '))
        return [{
          type: 'text',
          text: `投档明细（${scope}）：共 ${String(value.count)} 条，返回 ${String(value.returned)} 条`
            + (value.truncated ? '（已截断，可用 category、院校或分数区间收窄）' : '')
            + `\n${header}\n${lines.join('\n')}`,
        }]
      },
    },
    async execute(args) {
      if (args.year !== 2026) {
        throw new Error(`query_admission_detail_2026 目前只支持 year=2026，收到 ${String(args.year)}`)
      }
      const rows = data().admission_detail
        .filter(row => numberOf(row, '年份') === args.year)
        .filter(row => sameName(textOf(row, '省份'), args.province))
        .filter(row => matchesCategory(row, args.category))
        .filter(row => matchesAny(textOf(row, '院校'), args.school_name))
        .filter(row => inScoreRange(
          numberOf(row, '投档最低综合分'), args.admission_min_score, args.admission_max_score))
        .sort(byScoreDesc)
      return cap(rows.map(detailItem))
    },
    presentCall: args =>
      ({ card: 'generic' as const, title: `投档明细查询（${args.province}）`, kind: 'search' as const, rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'query_school_exam_list',
    description:
      '查询可组织艺术类专业校考的院校名单：院校名称、所在地、院校性质（独立设置、参照独立设置等）与校考专业增减情况。不带条件返回全部，也可按院校所在省份或院校名筛选。',
    parameters: {
      school_province: {
        type: 'array',
        items: { type: 'string' },
        description: '院校所在省份，可多个；如 ["北京"]',
      },
      school_name: {
        type: 'array',
        items: { type: 'string' },
        description: '院校名，可多个，按包含匹配；如 ["中央"]',
      },
    },
    output: {
      schema: examOutput,
      render(_args, value: ExamValue): ContentBlock[] {
        if (value.data.length === 0) return [{ type: 'text', text: '没有匹配的校考院校' }]
        const lines = value.data.map(row =>
          `${textOf(row, '院校名称') ?? ''}（${textOf(row, '所在地') ?? ''}，${textOf(row, '院校性质') ?? ''}）：`
          + `${textOf(row, '2026年校考情况（专业增减）') ?? ''}`)
        return [{ type: 'text', text: `校考院校：共 ${String(value.count)} 所\n${lines.join('\n')}` }]
      },
    },
    async execute(args) {
      const rows = data().school_exam
        .filter(row => matchesAny(textOf(row, '所在地'), args.school_province))
        .filter(row => matchesAny(textOf(row, '院校名称'), args.school_name))
      return cap(rows.map(examItem))
    },
    presentCall: args =>
      ({ card: 'generic' as const, title: '校考院校名单查询', kind: 'search' as const, rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'query_major_catalog',
    description:
      '查询艺术类可报考专业目录：统考类别/录取方式、包含方向、对应本科专业与备注。可按统考类别或方向筛选（按包含匹配），不带条件返回全部条目。',
    parameters: {
      exam_category: {
        type: 'array',
        items: { type: 'string' },
        description: '统考类别或方向，可多个；如 ["美术与设计类"]、["音乐表演"]',
      },
    },
    output: {
      schema: catalogOutput,
      render(_args, value: CatalogValue): ContentBlock[] {
        if (value.data.length === 0) return [{ type: 'text', text: '没有匹配的专业目录条目' }]
        const lines = value.data.map(row =>
          `${textOf(row, '统考类别/录取方式') ?? ''}（方向：${textOf(row, '包含方向') ?? ''}）`
          + `\n  对应本科专业：${textOf(row, '对应本科专业') ?? ''}`
          + `\n  备注：${textOf(row, '备注') ?? ''}`)
        return [{ type: 'text', text: `可报考专业目录：共 ${String(value.count)} 条\n${lines.join('\n')}` }]
      },
    },
    async execute(args) {
      const wanted = args.exam_category
      const rows = data().major_catalog.filter((row) => {
        if (wanted === undefined || wanted.length === 0) return true
        const category = textOf(row, '统考类别/录取方式')
        const directions = textOf(row, '包含方向')
        return wanted.some(entry => sameName(category, entry) || sameName(directions, entry))
      })
      return cap(rows.map(catalogItem))
    },
    presentCall: args =>
      ({ card: 'generic' as const, title: '可报考专业目录查询', kind: 'search' as const, rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'query_admission_mode_overview',
    description:
      '查询艺术类招生模式总览：每种招生模式（省级统考、校考、省际联考等）的所属类型、考试形式、报考条件、录取规则要点、可报考专业与备注。无需参数，一次返回全部模式。',
    parameters: {},
    output: {
      schema: modeOutput,
      render(_args, value: ModeValue): ContentBlock[] {
        const blocks = value.data.map((row) => {
          const lines = (['招生模式', '所属类型', '考试形式', '报考条件', '录取规则要点', '可报考专业', '备注'] as const)
            .map(field => `- ${field}：${textOf(row, field) ?? '（未收录）'}`)
          return `${textOf(row, '招生模式') ?? ''}\n${lines.join('\n')}`
        })
        return [{ type: 'text', text: `艺术类招生模式总览：共 ${String(value.count)} 种\n\n${blocks.join('\n\n')}` }]
      },
    },
    async execute() {
      return cap(data().admission_mode_overview.map(modeItem))
    },
    presentCall: args =>
      ({ card: 'generic' as const, title: '招生模式总览查询', kind: 'search' as const, rawInput: args }),
  }))

  ctx.logger.info('tool-art-query: 已注册 5 个艺考查询工具，数据集 %s', dataPath)
}
