import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { sql } from 'drizzle-orm';
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export const db = drizzle(pool, { schema });

// Test connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', err => {
  console.error('❌ PostgreSQL connection error:', err);
});

export async function testConnection() {
  try {
    // Test 1: Basic pool connection
    const client = await pool.connect();
    client.release();

    // Test 2: Test Drizzle query
    const result = await db.execute(
      sql`SELECT NOW() as current_time, version() as postgres_version`
    );
    console.log('✅ Drizzle query successful');
    console.log('📅 Database time:', result.rows[0]?.current_time);
    console.log('🔧 PostgreSQL version:', result.rows[0]?.postgres_version);

    return true;
  } catch (error) {
    console.error('❌ Connection test failed:', error);
    return false;
  }
}

// Test connection
// testConnection();
