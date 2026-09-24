path = r"E:\ghWork\deepseek_harness\deepseek-harness\packages\gaokao\tool-gaokao-query\src\index.ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Fix labels in FIELD_LABELS
content = content.replace("major_name: '专业名'", "major_name: '专业（类）'")
content = content.replace("parsed_major_name: '解析专业名'", "parsed_major_name: '专业（类）包含专业'")

# 2. Fix execute: when no fields, use all keys from FIELD_LABELS (all 21 fields)
# Currently when no fields, it uses just fixedFields.
# Need to pass ALL fields. Let me list all 21 keys as the default.
old = """: fixedFields
      return apiGet(base, '/api/college-admission', { ...args, fields: mergedFields }, exec.signal) as any"""

all_fields_str = "'school_province,school_city,school_name,school_code,year,undergraduate_type,major_group_code,major_code,major_name,parsed_major_name,major_category,campus,subject_requirement,study_duration,major_note,sino_foreign,tuition_fee,parsed_tuition_fee,enrollment_plan,admission_score,admission_rank'"

new = """: allFields
      return apiGet(base, '/api/college-admission', { ...args, fields: mergedFields }, exec.signal) as any"""

content = content.replace(old, new)

# Also need to add the allFields variable. Find "const fixedFields" line and replace the section
old_exec = """      const isGroup = args.college_major_group === 1
      const fixedFields = isGroup
        ? 'school_name,major_group_code,major_code,major_name,parsed_major_name,admission_score,admission_rank'
        : 'school_name,major_code,major_name,parsed_major_name,admission_score,admission_rank'
      const mergedFields = args.fields
        ? [...new Set([...fixedFields.split(','), ...(args.fields as string).split(',').map((s: string) => s.trim()).filter(Boolean)])].join(',')
        : allFields"""

new_exec = """      const isGroup = args.college_major_group === 1
      const fixedFields = isGroup
        ? 'school_name,major_group_code,major_code,major_name,parsed_major_name,admission_score,admission_rank'
        : 'school_name,major_code,major_name,parsed_major_name,admission_score,admission_rank'
      const allFields = """ + all_fields_str + """
      const mergedFields = args.fields
        ? [...new Set([...fixedFields.split(','), ...(args.fields as string).split(',').map((s: string) => s.trim()).filter(Boolean)])].join(',')
        : allFields"""

content = content.replace(old_exec, new_exec)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Done")
