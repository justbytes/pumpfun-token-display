// src/lib/db/sql.ts
import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';

interface SQLiteTokenRow {
  bondingCurveAddress: string;
  complete: number; // SQLite stores boolean as integer
  creator: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  uri: string;
  description: string;
  image: string;
  createdAt?: string;
}

// Token interface (matches your existing structure)
interface TokenDocument {
  bondingCurveAddress: string;
  complete: boolean;
  creator: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  uri: string;
  description: string;
  image: string;
  createdAt?: string;
  updatedAt?: string;
}

interface TokenStats {
  totalTokens: number;
  completedBondingCurves: number;
  activeBondingCurves: number;
}

class SQLDatabase {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'pumpfun_tokens.db');
  }

  /**
   * Initialize SQLite database connection and create tables
   */
  async initialize(): Promise<boolean> {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      await fs.mkdir(dataDir, { recursive: true });

      // Create database connection
      this.db = new Database(this.dbPath);

      // Configure SQLite for better performance
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = 1000000');
      this.db.pragma('temp_store = memory');

      // Create tokens table
      await this.createTokensTable();

      // Create indexes for better performance
      await this.createSQliteIndexes();

      console.log('✅ SQLite database initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize SQLite database:', error);
      return false;
    }
  }

  /**
   * Create the tokens table
   */
  private async createTokensTable(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bondingCurveAddress TEXT UNIQUE NOT NULL,
        complete BOOLEAN NOT NULL DEFAULT FALSE,
        creator TEXT NOT NULL,
        tokenAddress TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        uri TEXT,
        description TEXT,
        image TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    this.db.exec(createTableSQL);
    console.log('✅ Tokens table created/verified');
  }

  /**
   * Create database indexes for better performance
   */
  private async createSQliteIndexes(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_tokens_bonding_curve ON tokens(bondingCurveAddress)',
      'CREATE INDEX IF NOT EXISTS idx_tokens_address ON tokens(tokenAddress)',
      'CREATE INDEX IF NOT EXISTS idx_tokens_symbol ON tokens(symbol)',
      'CREATE INDEX IF NOT EXISTS idx_tokens_name ON tokens(name)',
      'CREATE INDEX IF NOT EXISTS idx_tokens_complete ON tokens(complete)',
      'CREATE INDEX IF NOT EXISTS idx_tokens_creator ON tokens(creator)',
      'CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tokens(createdAt DESC)',
    ];

    for (const indexSQL of indexes) {
      this.db.exec(indexSQL);
    }

    console.log('✅ Database indexes created/verified');
  }

  /**
   * Insert a single token (with conflict handling)
   */
  async insertToken(token: TokenDocument): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const insertSQL = `
        INSERT OR REPLACE INTO tokens (
          bondingCurveAddress, complete, creator, tokenAddress,
          name, symbol, uri, description, image, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `;

      const stmt = this.db.prepare(insertSQL);
      stmt.run([
        token.bondingCurveAddress,
        token.complete ? 1 : 0,
        token.creator.toString(),
        token.tokenAddress,
        token.name,
        token.symbol,
        token.uri || '',
        token.description || '',
        token.image || '',
      ]);

      return true;
    } catch (error) {
      console.error('❌ Error inserting token:', error);
      return false;
    }
  }

  /**
   * Insert multiple tokens in a transaction (much faster)
   */
  async insertTokensBatch(tokens: TokenDocument[]): Promise<{
    inserted: number;
    duplicates: number;
    errors: number;
  }> {
    if (!this.db) throw new Error('Database not initialized');

    let inserted = 0;
    let duplicates = 0;
    let errors = 0;

    try {
      const insertSQL = `
        INSERT OR IGNORE INTO tokens (
          bondingCurveAddress, complete, creator, tokenAddress,
          name, symbol, uri, description, image
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const updateSQL = `
        UPDATE tokens SET
          complete = ?, creator = ?, name = ?, symbol = ?,
          uri = ?, description = ?, image = ?, updatedAt = datetime('now')
        WHERE tokenAddress = ? AND (
          complete != ? OR creator != ? OR name != ? OR symbol != ? OR
          uri != ? OR description != ? OR image != ?
        )
      `;

      // Use transaction for better performance
      const insertStmt = this.db.prepare(insertSQL);
      const updateStmt = this.db.prepare(updateSQL);
      this.db.prepare('SELECT COUNT(*) as count FROM tokens WHERE tokenAddress = ?');

      const transaction = this.db.transaction((tokens: TokenDocument[]) => {
        for (const token of tokens) {
          try {
            // Try to insert first
            const insertResult = insertStmt.run([
              token.bondingCurveAddress,
              token.complete ? 1 : 0,
              token.creator,
              token.tokenAddress,
              token.name,
              token.symbol,
              token.uri || '',
              token.description || '',
              token.image || '',
            ]);

            if (insertResult.changes > 0) {
              inserted++;
            } else {
              // Token exists, try to update if different
              const updateResult = updateStmt.run([
                token.complete ? 1 : 0,
                token.creator,
                token.name,
                token.symbol,
                token.uri || '',
                token.description || '',
                token.image || '',
                token.tokenAddress,
                token.complete ? 1 : 0,
                token.creator,
                token.name,
                token.symbol,
                token.uri || '',
                token.description || '',
                token.image || '',
              ]);

              if (updateResult.changes > 0) {
                inserted++;
              } else {
                duplicates++;
              }
            }
          } catch (tokenError) {
            console.error(`❌ Error processing token ${token.tokenAddress}:`, tokenError);
            errors++;
          }
        }
      });

      transaction(tokens);

      return { inserted, duplicates, errors };
    } catch (error) {
      console.error('❌ Error in batch insert:', error);
      return { inserted: 0, duplicates: 0, errors: tokens.length };
    }
  }

  /**
   * Get all tokens with optional filtering and pagination
   */
  async getAllTokensSQlite(options?: {
    limit?: number;
    offset?: number;
    searchTerm?: string;
    complete?: boolean;
    orderBy?: 'createdAt' | 'name' | 'symbol';
    orderDirection?: 'ASC' | 'DESC';
  }): Promise<TokenDocument[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      let sql: string = 'SELECT * FROM tokens';
      const params: (string | number)[] = [];
      const conditions: string[] = [];

      // Add search condition
      if (options?.searchTerm) {
        conditions.push(
          '(name LIKE ? OR symbol LIKE ? OR tokenAddress LIKE ? OR description LIKE ?)'
        );
        const searchPattern = `%${options.searchTerm}%`;
        params.push(searchPattern, searchPattern, searchPattern, searchPattern);
      }

      // Add complete filter
      if (options?.complete !== undefined) {
        conditions.push('complete = ?');
        params.push(options.complete ? 1 : 0);
      }

      // Add WHERE clause if there are conditions
      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      // Add ORDER BY
      const orderBy = options?.orderBy || 'createdAt';
      const orderDirection = options?.orderDirection || 'DESC';
      sql += ` ORDER BY ${orderBy} ${orderDirection}`;

      // Add pagination
      if (options?.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);

        if (options?.offset) {
          sql += ' OFFSET ?';
          params.push(options.offset);
        }
      }

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(params) as SQLiteTokenRow[];

      // Convert boolean fields back from integers
      return rows.map(
        (row: SQLiteTokenRow): TokenDocument => ({
          ...row,
          complete: Boolean(row.complete),
        })
      );
    } catch {
      console.error('❌ Error getting tokens getting tokens from sqlite db');
      return [];
    }
  }

  /**
   * Get all unique bonding curve addresses efficiently using SQL
   */
  async getAllBondingCurveAddresses(): Promise<string[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      // SQL query to get distinct bonding curve addresses
      const sql = `
      SELECT DISTINCT bondingCurveAddress
      FROM tokens
      WHERE bondingCurveAddress IS NOT NULL
        AND bondingCurveAddress != ''
      ORDER BY bondingCurveAddress
    `;

      const stmt = this.db.prepare(sql);
      const rows = stmt.all() as { bondingCurveAddress: string }[];

      // Extract just the addresses into an array
      const addresses = rows.map(row => row.bondingCurveAddress);

      console.log(`📋 Found ${addresses.length} unique bonding curve addresses`);
      return addresses;
    } catch (error) {
      console.error('❌ Error getting bonding curve addresses:', error);
      return [];
    }
  }

  /**
   * Get recent tokens (for frontend polling)
   */
  async getRecentTokens(limit: number = 50): Promise<TokenDocument[]> {
    return this.getAllTokensSQlite({
      limit,
      orderBy: 'createdAt',
      orderDirection: 'DESC',
    });
  }

  /**
   * Get token statistics
   */
  async getTokenStats(): Promise<TokenStats | null> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const sql = `
        SELECT
          COUNT(*) as totalTokens,
          COUNT(CASE WHEN complete = 1 THEN 1 END) as completedBondingCurves,
          COUNT(CASE WHEN complete = 0 THEN 1 END) as activeBondingCurves
        FROM tokens
      `;

      const stmt = this.db.prepare(sql);
      const result = stmt.get() as TokenStats;

      return result;
    } catch (error) {
      console.error('❌ Error getting token stats:', error);
      return null;
    }
  }

  /**
   * Get token count
   */
  async getTokenCount(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const sql = 'SELECT COUNT(*) as count FROM tokens';
      const stmt = this.db.prepare(sql);
      const result = stmt.get() as { count: number };

      return result.count || 0;
    } catch (error) {
      console.error('❌ Error getting token count:', error);
      return 0;
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('✅ SQLite database connection closed');
    }
  }
}

// Export singleton instance
export const sqlDB = new SQLDatabase();

// Export convenience functions
export async function initializeSQLDB(): Promise<boolean> {
  return await sqlDB.initialize();
}

export async function insertTokenToSQL(token: TokenDocument): Promise<boolean> {
  return await sqlDB.insertToken(token);
}

export async function insertTokensBatchToSQL(tokens: TokenDocument[]): Promise<{
  inserted: number;
  duplicates: number;
  errors: number;
}> {
  return await sqlDB.insertTokensBatch(tokens);
}

export async function getAllTokensFromSQL(options?: {
  limit?: number;
  offset?: number;
  searchTerm?: string;
  complete?: boolean;
}): Promise<TokenDocument[]> {
  return await sqlDB.getAllTokensSQlite(options);
}

export async function getRecentTokensFromSQL(limit: number = 50): Promise<TokenDocument[]> {
  return await sqlDB.getRecentTokens(limit);
}

export async function getTokenStatsFromSQL(): Promise<TokenStats | null> {
  return await sqlDB.getTokenStats();
}

export async function getTokenCountFromSQL(): Promise<number> {
  return await sqlDB.getTokenCount();
}

export { SQLDatabase };
