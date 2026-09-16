/** Locale keys for the LLM Request settings section. */
export type LlmRequestKey =
  | 'openCordisCfg'
  | 'openCordisProfile'
  | 'nav'
  | 'title'
  | 'description'
  | 'table.order'
  | 'table.sectionName'
  | 'table.regFile'
  | 'table.customizable'
  | 'customizable.yes'
  | 'customizable.partial'
  | 'customizable.no'
  | 'customizable.yesHint'
  | 'customizable.partialHint'
  | 'customizable.noHint'
  | 'sectionGroup.core'
  | 'sectionGroup.tools'
  | 'globalNotice'
  | 'openFile'

export const en: Record<LlmRequestKey, string> = {
  nav: 'LLM Request',
  title: 'LLM Request Settings',
  description: 'Complete mapping of system prompt sections that compose the LLM input. Sections are assembled in order, lower numbers first.',
  'table.order': 'Order',
  'table.sectionName': 'Section Name',
  'table.regFile': 'Registration File',
  'table.customizable': 'Customizable',
  'customizable.yes': 'Yes',
  'customizable.partial': 'Partial',
  'customizable.no': 'No',
  'customizable.yesHint': 'Configurable via cordis.yml or environment',
  'customizable.partialHint': 'Changes with plugin or runtime flags',
  'customizable.noHint': 'Hardcoded, requires code changes',
  'sectionGroup.core': 'Core Prompt Sections',
  'sectionGroup.tools': 'Tool Description Sections',
  'globalNotice': 'These sections are assembled globally via ScopedLayers. Each agent preset can shadow (override) sections with the same name.',
  'openFile': 'Open file',
  'openCordisCfg': 'Edit cordis.yml (Web Config)',
  'openCordisProfile': 'Edit cordis.yml (User Profile)',
}

export const zh: Record<LlmRequestKey, string> = {
  nav: 'LLM 请求',
  title: 'LLM 请求设置',
  description: '组装成 LLM 输入的系统提示词各部分的完整映射。按顺序号从小到大拼接。',
  'table.order': '顺序',
  'table.sectionName': 'Section 名称',
  'table.regFile': '注册文件',
  'table.customizable': '可自定义',
  'customizable.yes': '是',
  'customizable.partial': '部分',
  'customizable.no': '否',
  'customizable.yesHint': '可通过 cordis.yml 或环境变量配置',
  'customizable.partialHint': '随插件或运行时标志变化',
  'customizable.noHint': '硬编码在源码中，需要修改代码',
  'sectionGroup.core': '核心提示词部分',
  'sectionGroup.tools': '工具描述部分',
  'globalNotice': '这些部分通过 ScopedLayers 全局组装。每个 agent preset 可以 shadow（覆盖）同名 section。',
  'openFile': '打开文件',
  'openCordisCfg': '编辑 cordis.yml（Web 配置）',
  'openCordisProfile': '编辑 cordis.yml（用户配置）',
}
