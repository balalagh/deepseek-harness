import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

// 数据库连接信息与高考微服务共用同一份 .env，避免凭据在多处重复。
const ENV_FILE = join(dirname(fileURLToPath(import.meta.url)), 'packages/gaokao/gaokao-api/.env');

if (!existsSync(ENV_FILE)) {
  throw new Error(`缺少 ${ENV_FILE}：请复制 packages/gaokao/gaokao-api/.env.example 为 .env 并填入数据库配置`);
}
process.loadEnvFile(ENV_FILE);

for (const name of ['GAOKAO_DB_HOST', 'GAOKAO_DB_PORT', 'GAOKAO_DB_USER', 'GAOKAO_DB_PASSWORD', 'GAOKAO_DB_NAME']) {
  if (!process.env[name]) throw new Error(`缺少环境变量 ${name}：请在 ${ENV_FILE} 中配置`);
}

async function testConnection() {
  console.log('Testing database connection...');
  
  try {
    const pool = mysql.createPool({
      host: process.env.GAOKAO_DB_HOST,
      port: Number(process.env.GAOKAO_DB_PORT),
      user: process.env.GAOKAO_DB_USER,
      password: process.env.GAOKAO_DB_PASSWORD,
      database: process.env.GAOKAO_DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    // Test 1: Query province control line
    console.log('\n=== Test 1: Province Control Line ===');
    const [controlLines] = await pool.execute(
      'SELECT province, year, subject, batch, score FROM col_province_control_line WHERE province = ? AND year = ? LIMIT 5',
      ['浙江', 2024]
    );
    console.log('Control lines:', JSON.stringify(controlLines, null, 2));

    // Test 2: Query college admission data
    console.log('\n=== Test 2: College Admission Data ===');
    const [admissions] = await pool.execute(
      'SELECT college, major, province, year, min_score, max_score, avg_score, min_rank, enrolled, batch FROM col_college_admission WHERE province = ? AND year = ? LIMIT 5',
      ['浙江', 2024]
    );
    console.log('Admissions:', JSON.stringify(admissions, null, 2));

    // Test 3: Query score distribution
    console.log('\n=== Test 3: Score Distribution ===');
    const [scores] = await pool.execute(
      'SELECT score, segment_count, cumulative_count FROM member_score_distribution WHERE province = ? AND year = ? ORDER BY score DESC LIMIT 10',
      ['浙江', 2024]
    );
    console.log('Score distribution:', JSON.stringify(scores, null, 2));

    await pool.end();
    console.log('\n✅ All tests passed! Database connection successful.');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
}

testConnection();
