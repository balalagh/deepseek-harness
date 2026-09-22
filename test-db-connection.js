import mysql from 'mysql2/promise';

async function testConnection() {
  console.log('Testing database connection...');
  
  try {
    const pool = mysql.createPool({
      host: 'rm-bp1tt4013kj368djsvo.mysql.rds.aliyuncs.com',
      port: 3306,
      user: 'college_application_reader',
      password: 'Engma@123',
      database: 'college_application',
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
