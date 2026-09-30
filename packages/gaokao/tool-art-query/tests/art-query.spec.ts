/**
 * 艺考查询工具的行为：模型可见 schema、筛选语义、截断、失败路径，以及数据集被改写后的重新载入。
 * 数据集是外部文件边界的替身：每个用例在临时目录里写一份小数据集，不依赖真实工作簿。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as toolArtQuery from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/** 一份覆盖五个集合的小数据集：一条缺分值的行与一条 2025 行用于验证筛选。 */
function sampleDataset() {
  return {
    policy_matrix: [
      { 省份: '浙江', 统考科类设置: '省统考分 6 个科类', 综合分模式归类: '两类公式' },
      { 省份: '北京', 统考科类设置: '美术与设计类等 6 类' },
    ],
    admission_detail: [
      {
        年份: 2026,
        省份: '浙江',
        批次: '艺术类统考批第一段',
        科类: '美术与设计类',
        category: '美术与设计类',
        院校代码: '1033',
        院校: '中国美术学院',
        专业组: null,
        专业: '美术学',
        投档最低综合分: 620,
        文化总分: 540,
        专业统考分: 268,
        语文: 110,
        数学: 120,
        外语: 130,
        三科选考合计: 240,
        '投档/录取数': 12,
        计划数: 15,
        分数口径: '综合分',
        备注: 'demo-a',
      },
      {
        年份: 2026,
        省份: '浙江',
        批次: '艺术类统考批第一段',
        科类: '音乐类音乐表演器乐方向',
        category: '音乐类',
        院校代码: '0198',
        院校: '浙江音乐学院',
        专业组: null,
        专业: '艺术与科技',
        投档最低综合分: 560,
        文化总分: 500,
        专业统考分: 250,
        语文: 100,
        数学: 110,
        外语: 120,
        三科选考合计: 250,
        '投档/录取数': 17,
        计划数: 20,
        分数口径: '综合分',
        备注: 'demo-b',
      },
      {
        年份: 2026,
        省份: '浙江',
        批次: '艺术类统考批第二段',
        科类: '音乐类音乐教育声乐主项',
        category: '音乐类',
        院校: '浙江师范大学',
        投档最低综合分: null,
        分数口径: '综合分',
      },
      {
        年份: 2025,
        省份: '浙江',
        批次: '艺术类统考批第一段(2025·兜底)',
        科类: '美术与设计类',
        category: '美术与设计类',
        院校: '浙江大学',
        投档最低综合分: 640,
      },
    ],
    school_exam: [
      {
        院校名称: '清华大学',
        所在地: '北京',
        院校性质: '参照独立设置',
        '2026年校考情况（专业增减）': '美术学类与设计学类继续校考',
      },
      {
        院校名称: '浙江音乐学院',
        所在地: '浙江',
        院校性质: '独立设置',
        '2026年校考情况（专业增减）': '校考专业稳定',
      },
    ],
    major_catalog: [
      {
        '统考类别/录取方式': '音乐类',
        包含方向: '音乐教育、音乐表演（声乐）',
        对应本科专业: '音乐表演、音乐学',
        备注: '使用省级统考成绩录取',
      },
      {
        '统考类别/录取方式': '美术与设计类',
        包含方向: '美术与设计类统考',
        对应本科专业: '美术学、绘画',
        备注: '使用省级统考成绩录取',
      },
    ],
    admission_mode_overview: [
      {
        招生模式: '艺术类专业省级统考',
        所属类型: '艺术类',
        考试形式: '全省统一组织专业考试',
        报考条件: '完成高考报名并参加艺术类报名',
        录取规则要点: '按综合分平行志愿投档',
        可报考专业: '见可报考专业目录',
        备注: '全国 31 省全面实施',
      },
    ],
  }
}

/** 在临时目录里写一份数据集并挂载插件。 */
async function harness(options: { readonly maxRows?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-art-query-'))
  cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })
  const dataPath = join(dir, 'art-tools.json')
  await writeFile(dataPath, JSON.stringify(sampleDataset()))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(toolArtQuery, { dataPath, ...options })
  cleanups.push(async () => { await ctx.fiber.dispose() })
  return { ctx, dataPath }
}

/** 调用一个工具并取回它的模型可见文本。 */
async function call(
  ctx: Context,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('art-test'),
    name,
    arguments: args,
  })
  const text = result.content
    .map(block => (block.type === 'text' ? block.text : ''))
    .join('')
  return { isError: result.isError, text }
}

describe('art-query tool package', () => {
  it('registers the five model-facing tools with their declared parameters', async () => {
    const { ctx } = await harness()
    const schemas = ctx.tools.schemas()
    expect(schemas.map(schema => schema.name).sort()).toEqual([
      'query_admission_detail_2026',
      'query_admission_mode_overview',
      'query_art_policy_matrix',
      'query_major_catalog',
      'query_school_exam_list',
    ])
    const detail = schemas.find(schema => schema.name === 'query_admission_detail_2026')
    expect(detail?.parameters).toMatchObject({
      type: 'object',
      properties: {
        year: { type: 'integer' },
        province: { type: 'string' },
        category: { type: 'array', items: { type: 'string' } },
        school_name: { type: 'array', items: { type: 'string' } },
        admission_min_score: { type: 'number' },
        admission_max_score: { type: 'number' },
      },
      required: ['year', 'province'],
    })
  })

  it('answers a policy lookup and names the covered provinces when one is absent', async () => {
    const { ctx } = await harness()
    const found = await call(ctx, 'query_art_policy_matrix', { province: '浙江' })
    expect(found.isError).toBe(false)
    expect(found.text).toContain('浙江 艺术类政策矩阵：')
    expect(found.text).toContain('- 统考科类设置：省统考分 6 个科类')
    expect(found.text).toContain('- 志愿模式：（未收录）')

    const missing = await call(ctx, 'query_art_policy_matrix', { province: '广东' })
    expect(missing.isError).toBe(false)
    expect(missing.text).toContain('未收录该省份的政策矩阵')
    expect(missing.text).toContain('浙江、北京')
  })

  it('matches a normalized exam category, a school substring, and a score range', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'query_admission_detail_2026', {
      year: 2026,
      province: '浙江',
      category: ['音乐类'],
      admission_min_score: 500,
    })
    expect(result.isError).toBe(false)
    // 归一类别命中原始科类写法；美术与设计类与 2025 年的行都不出现。
    expect(result.text).toContain('音乐类音乐表演器乐方向')
    expect(result.text).not.toContain('美术与设计类')
    expect(result.text).not.toContain('兜底')
    // 缺投档最低综合分的行在给定分数边界时不参与。
    expect(result.text).not.toContain('浙江师范大学')

    const bySchool = await call(ctx, 'query_admission_detail_2026', {
      year: 2026,
      province: '浙江',
      school_name: ['中国美术'],
    })
    expect(bySchool.text).toContain('中国美术学院')
    expect(bySchool.text).not.toContain('浙江音乐学院')
  })

  it('sorts by admission score descending with missing scores last', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'query_admission_detail_2026', { year: 2026, province: '浙江' })
    const rows = result.text.split('\n').slice(2)
    expect(rows[0]).toContain('中国美术学院')
    expect(rows[1]).toContain('浙江音乐学院')
    expect(rows[2]).toContain('浙江师范大学')
    expect(rows[2]).toContain('（未收录）')
  })

  it('caps the returned rows and reports the truncation', async () => {
    const { ctx } = await harness({ maxRows: 1 })
    const result = await call(ctx, 'query_admission_detail_2026', { year: 2026, province: '浙江' })
    expect(result.text).toContain('共 3 条，返回 1 条')
    expect(result.text).toContain('已截断')
    expect(result.text.split('\n').slice(2)).toHaveLength(1)
  })

  it('rejects a year the dataset does not carry', async () => {
    const { ctx } = await harness()
    const result = await call(ctx, 'query_admission_detail_2026', { year: 2025, province: '浙江' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('只支持 year=2026')
  })

  it('fails loud when the dataset file is missing', async () => {
    const { ctx, dataPath } = await harness()
    await rm(dataPath, { force: true })
    const result = await call(ctx, 'query_school_exam_list', {})
    expect(result.isError).toBe(true)
    expect(result.text).toContain('艺考数据集不可用')
  })

  it('picks up a rewritten dataset without a restart', async () => {
    const { ctx, dataPath } = await harness()
    const before = await call(ctx, 'query_school_exam_list', {})
    expect(before.text).toContain('清华大学')

    const rewritten = sampleDataset()
    rewritten.school_exam = [{
      院校名称: '中央美术学院',
      所在地: '北京',
      院校性质: '独立设置',
      '2026年校考情况（专业增减）': '美术学校考取消',
    }]
    await writeFile(dataPath, JSON.stringify(rewritten))
    const after = await call(ctx, 'query_school_exam_list', {})
    expect(after.text).toContain('中央美术学院')
    expect(after.text).not.toContain('清华大学')
  })
})
