import io 
path = r'E:\ghWork\deepseek_harness\deepseek-harness\packages\gaokao\tool-gaokao-query\src\index.ts' 
with io.open(path, encoding='utf-8') as f: c = f.read() 
idx = c.find('query_province_rule') 
s = c.rfind('ctx.tools.register', 0, idx) - 2 
e = c.find('))', idx + 30) + 3 
c = c[:s] + c[e:] 
print('removed broken tool') 
