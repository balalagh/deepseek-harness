with open("packages/gaokao/tool-gaokao-query/src/index.ts", "r", encoding="utf-8") as f:
    content = f.read()

old_render = """      render: (_args, value) => [{
        type: 'text',
        text: `院校录取数据（共 ${value.count} 条）：\n`
          + (value.data as Array<Record<string, unknown>>).map(r =>
            `${r.school_name} - ${r.major_name} | ${r.year}年 ${r.batch} | `
            + `录取分${r.admission_score} | 位次${r.admission_rank} | 招生${r.enrollment_plan}人`
          ).join('\n'),
      }],"""

new_render = """      render: (_args, value) => {
        const rows = value.data as Array<Record<string, unknown>>
        // Group by (school_name, major_code, major_name, year, batch, admission_score, admission_rank, enrollment_plan)
        const groups = new Map<string, { row: Record<string, unknown>; parsedNames: Set<string> }>()
        for (const r of rows) {
          const key = `${r.school_name}|${r.major_code}|${r.major_name}|${r.year}|${r.batch}|${r.admission_score}|${r.admission_rank}|${r.enrollment_plan}`
          const existing = groups.get(key)
          if (existing) {
            if (r.parsed_major_name) existing.parsedNames.add(String(r.parsed_major_name))
          } else {
            const names = new Set<string>()
            if (r.parsed_major_name) names.add(String(r.parsed_major_name))
            groups.set(key, { row: r, parsedNames: names })
          }
        }
        const lines: string[] = []
        for (const { row: r, parsedNames } of groups.values()) {
          let majorInfo = `${r.major_name}(${r.major_code})`
          if (parsedNames.size > 0) {
            const names = [...parsedNames].slice(0, 5)
            if (parsedNames.size > 5) names.push('...')
            majorInfo += ` [${names.join(', ')}]`
          }
          lines.push(`${r.school_name} - ${majorInfo} | ${r.year}年 ${r.batch} | `
            + `录取分${r.admission_score} | 位次${r.admission_rank} | 招生${r.enrollment_plan}人`)
        }
        return [{
          type: 'text',
          text: `院校录取数据（共 ${groups.size} 条）：\n` + lines.join('\n'),
        }]
      },"""

content = content.replace(old_render, new_render)

with open("packages/gaokao/tool-gaokao-query/src/index.ts", "w", encoding="utf-8") as f:
    f.write(content)

print("Done")
