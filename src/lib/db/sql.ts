// src/lib/db/sqlite.ts
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { promises as fs } from 'fs';
import path from 'path';

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

class SQLiteDatabase {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private SQL: any = null;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'pumpfun_tokens.db');
  }

  /**
   * Initialize SQLite database connection and create tables
   */
  async initialize(): Promise<boolean> {
    try {
      // Initialize sql.js
      this.SQL = await initSqlJs();

      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      await fs.mkdir(dataDir, { recursive: true });

      // Try to load existing database file
      let fileBuffer: Buffer | null = null;
      try {
        fileBuffer = await fs.readFile(this.dbPath);
        console.log('📂 Loading existing SQLite database...');
      } catch (error) {
        console.log('📝 Creating new SQLite database...');
      }

      // Create database connection
      this.db = new this.SQL.Database(fileBuffer);

      // Configure SQLite for better performance
      this.db?.run('PRAGMA journal_mode = WAL');
      this.db?.run('PRAGMA synchronous = NORMAL');
      this.db?.run('PRAGMA cache_size = 1000000');
      this.db?.run('PRAGMA temp_store = memory');

      // Create tokens table
      await this.createTokensTable();

      // Create indexes for better performance
      await this.createIndexes();

      // Save initial state
      await this.saveToFile();

      console.log('✅ SQLite database initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize SQLite database:', error);
      return false;
    }
  }

  /**
   * Save database to file
   */
  private async saveToFile(): Promise<void> {
    if (!this.db) return;

    try {
      const data = this.db.export();
      await fs.writeFile(this.dbPath, data);
    } catch (error) {
      console.error('❌ Error saving database to file:', error);
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

    this.db.run(createTableSQL);
    console.log('✅ Tokens table created/verified');
  }

  /**
   * Create database indexes for better performance
   */
  private async createIndexes(): Promise<void> {
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
      this.db.run(indexSQL);
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;

      const stmt = this.db.prepare(insertSQL);
      stmt.run([
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
      stmt.free();

      // Save to file after insert
      await this.saveToFile();

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
          uri = ?, description = ?, image = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE tokenAddress = ? AND (
          complete != ? OR creator != ? OR name != ? OR symbol != ? OR
          uri != ? OR description != ? OR image != ?
        )
      `;

      // Use transaction for better performance
      this.db.run('BEGIN TRANSACTION');

      try {
        const insertStmt = this.db.prepare(insertSQL);
        const updateStmt = this.db.prepare(updateSQL);

        for (const token of tokens) {
          try {
            // Try to insert first
            insertStmt.run([
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

            // Check if insert was successful by checking if token exists
            const checkStmt = this.db.prepare(
              'SELECT COUNT(*) as count FROM tokens WHERE tokenAddress = ?'
            );
            checkStmt.bind([token.tokenAddress]);
            checkStmt.step();
            const checkResult = checkStmt.getAsObject() as { count: number };
            checkStmt.free();

            if (checkResult.count > 0) {
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

              inserted++; // Count updates as inserts for reporting
            }
          } catch (tokenError) {
            console.error(`❌ Error processing token ${token.tokenAddress}:`, tokenError);
            errors++;
          }
        }

        insertStmt.free();
        updateStmt.free();
        this.db.run('COMMIT');

        // Save to file after batch insert
        await this.saveToFile();
      } catch (transactionError) {
        this.db.run('ROLLBACK');
        throw transactionError;
      }

      return { inserted, duplicates, errors };
    } catch (error) {
      console.error('❌ Error in batch insert:', error);
      return { inserted: 0, duplicates: 0, errors: tokens.length };
    }
  }

  /**
   * Get all tokens with optional filtering and pagination
   */
  async getAllTokens(options?: {
    limit?: number;
    offset?: number;
    searchTerm?: string;
    complete?: boolean;
    orderBy?: 'createdAt' | 'name' | 'symbol';
    orderDirection?: 'ASC' | 'DESC';
  }): Promise<TokenDocument[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      let sql = 'SELECT * FROM tokens';
      const params: any[] = [];
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
      const rows: any[] = [];

      stmt.bind(params);
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();

      // Convert boolean fields back from integers
      return rows.map(row => ({
        ...row,
        complete: Boolean(row.complete),
      }));
    } catch (error) {
      console.error('❌ Error getting tokens:', error);
      return [];
    }
  }

  /**
   * Get recent tokens (for frontend polling)
   */
  async getRecentTokens(limit: number = 50): Promise<TokenDocument[]> {
    return this.getAllTokens({
      limit,
      orderBy: 'createdAt',
      orderDirection: 'DESC',
    });
  }

  /**
   * Get tokens created after a specific timestamp
   */
  async getTokensAfter(timestamp: string): Promise<TokenDocument[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const sql = 'SELECT * FROM tokens WHERE createdAt > ? ORDER BY createdAt DESC';
      const stmt = this.db.prepare(sql);
      const rows: any[] = [];

      stmt.bind([timestamp]);
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();

      return rows.map(row => ({
        ...row,
        complete: Boolean(row.complete),
      }));
    } catch (error) {
      console.error('❌ Error getting tokens after timestamp:', error);
      return [];
    }
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
      stmt.step();
      const result = stmt.getAsObject() as unknown as TokenStats;
      stmt.free();

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
      stmt.step();
      const result = stmt.getAsObject();
      stmt.free();

      return (result as any).count || 0;
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
      await this.saveToFile();
      this.db.close();
      this.db = null;
      console.log('✅ SQLite database connection closed');
    }
  }
}

// Export singleton instance
export const sqliteDB = new SQLiteDatabase();

// Export convenience functions
export async function initializeSQLiteDB(): Promise<boolean> {
  return await sqliteDB.initialize();
}

export async function insertTokenToSQLite(token: TokenDocument): Promise<boolean> {
  return await sqliteDB.insertToken(token);
}

export async function insertTokensBatchToSQLite(tokens: TokenDocument[]): Promise<{
  inserted: number;
  duplicates: number;
  errors: number;
}> {
  return await sqliteDB.insertTokensBatch(tokens);
}

export async function getAllTokensFromSQLite(options?: {
  limit?: number;
  offset?: number;
  searchTerm?: string;
  complete?: boolean;
}): Promise<TokenDocument[]> {
  return await sqliteDB.getAllTokens(options);
}

export async function getRecentTokensFromSQLite(limit: number = 50): Promise<TokenDocument[]> {
  return await sqliteDB.getRecentTokens(limit);
}

export async function getTokensAfterFromSQLite(timestamp: string): Promise<TokenDocument[]> {
  return await sqliteDB.getTokensAfter(timestamp);
}

export async function getTokenStatsFromSQLite(): Promise<TokenStats | null> {
  return await sqliteDB.getTokenStats();
}

export async function getTokenCountFromSQLite(): Promise<number> {
  return await sqliteDB.getTokenCount();
}

export { SQLiteDatabase };
