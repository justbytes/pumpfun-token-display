import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';
dotenv.config();

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: `${process.env.DB_HOST}`,
    port: Number(process.env.DB_PORT),
    database: `${process.env.DB_NAME}`,
    user: `${process.env.DB_USER}`,
    password: `${process.env.DB_PASSWORD}`,
  },
});
