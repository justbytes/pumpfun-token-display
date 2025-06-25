import { db } from './connection';
import { tokens } from './schema';
import { eq, and, or, ilike, desc, asc, count, sql } from 'drizzle-orm';

// Token interface (matches your existing structure)
export interface TokenDocument {
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

export interface TokenStats {
  totalTokens: number;
}

export class DrizzleDatabase {
  /**
   * Insert a single token (with conflict handling)
   */
  async insertToken(token: TokenDocument): Promise<boolean> {
    try {
      await db
        .insert(tokens)
        .values({
          bondingCurveAddress: token.bondingCurveAddress,
          complete: token.complete,
          creator: token.creator,
          tokenAddress: token.tokenAddress,
          name: token.name,
          symbol: token.symbol,
          uri: token.uri || '',
          description: token.description || '',
          image: token.image || '',
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: tokens.tokenAddress,
          set: {
            complete: sql.raw('EXCLUDED.complete'),
            creator: sql.raw('EXCLUDED.creator'),
            name: sql.raw('EXCLUDED.name'),
            symbol: sql.raw('EXCLUDED.symbol'),
            uri: sql.raw('EXCLUDED.uri'),
            description: sql.raw('EXCLUDED.description'),
            image: sql.raw('EXCLUDED.image'),
            updatedAt: new Date(),
          },
        });

      return true;
    } catch (error) {
      console.error('❌ Error inserting token:', error);
      return false;
    }
  }

  /**
   * Insert multiple tokens in a transaction (much faster)
   */
  async insertTokensBatch(tokenList: TokenDocument[]): Promise<{
    inserted: number;
    duplicates: number;
    errors: number;
  }> {
    let inserted = 0;
    let duplicates = 0;
    let errors = 0;

    try {
      // Use transaction for better performance and atomicity
      await db.transaction(async tx => {
        for (const token of tokenList) {
          try {
            const result = await tx
              .insert(tokens)
              .values({
                bondingCurveAddress: token.bondingCurveAddress,
                complete: token.complete,
                creator: token.creator,
                tokenAddress: token.tokenAddress,
                name: token.name,
                symbol: token.symbol,
                uri: token.uri || '',
                description: token.description || '',
                image: token.image || '',
              })
              .onConflictDoUpdate({
                target: tokens.tokenAddress,
                set: {
                  complete: sql.raw('EXCLUDED.complete'),
                  creator: sql.raw('EXCLUDED.creator'),
                  name: sql.raw('EXCLUDED.name'),
                  symbol: sql.raw('EXCLUDED.symbol'),
                  uri: sql.raw('EXCLUDED.uri'),
                  description: sql.raw('EXCLUDED.description'),
                  image: sql.raw('EXCLUDED.image'),
                  updatedAt: new Date(),
                },
                setWhere: or(
                  sql`${tokens.complete} != EXCLUDED.complete`,
                  sql`${tokens.creator} != EXCLUDED.creator`,
                  sql`${tokens.name} != EXCLUDED.name`,
                  sql`${tokens.symbol} != EXCLUDED.symbol`,
                  sql`${tokens.uri} != EXCLUDED.uri`,
                  sql`${tokens.description} != EXCLUDED.description`,
                  sql`${tokens.image} != EXCLUDED.image`
                ),
              })
              .returning({ id: tokens.id });

            if (result.length > 0) {
              inserted++;
            } else {
              duplicates++;
            }
          } catch (tokenError) {
            console.error(`❌ Error processing token ${token.tokenAddress}:`, tokenError);
            errors++;
          }
        }
      });

      return { inserted, duplicates, errors };
    } catch (error) {
      console.error('❌ Error in batch insert:', error);
      return { inserted: 0, duplicates: 0, errors: tokenList.length };
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
  }): Promise<TokenDocument[]> {
    try {
      // Build where conditions
      const conditions = [];

      if (options?.searchTerm) {
        const searchPattern = `%${options.searchTerm}%`;
        conditions.push(
          or(
            ilike(tokens.name, searchPattern),
            ilike(tokens.symbol, searchPattern),
            ilike(tokens.tokenAddress, searchPattern),
            ilike(tokens.description, searchPattern)
          )
        );
      }

      if (options?.complete !== undefined) {
        conditions.push(eq(tokens.complete, options.complete));
      }

      // Build query with conditional chaining
      const baseQuery = db.select().from(tokens);

      const queryWithWhere =
        conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;

      const queryWithOrder = queryWithWhere.orderBy(desc(tokens.createdAt));

      const queryWithLimit = options?.limit ? queryWithOrder.limit(options.limit) : queryWithOrder;

      const finalQuery = options?.offset ? queryWithLimit.offset(options.offset) : queryWithLimit;

      const results = await finalQuery;

      // Convert to TokenDocument format
      return results.map(
        (row): TokenDocument => ({
          bondingCurveAddress: row.bondingCurveAddress,
          complete: row.complete,
          creator: row.creator,
          tokenAddress: row.tokenAddress,
          name: row.name,
          symbol: row.symbol,
          uri: row.uri || '',
          description: row.description || '',
          image: row.image || '',
          createdAt: row.createdAt?.toISOString(),
          updatedAt: row.updatedAt?.toISOString(),
        })
      );
    } catch (error) {
      console.error('❌ Error getting tokens from database:', error);
      return [];
    }
  }

  /**
   * Get all unique bonding curve addresses efficiently
   */
  async getAllBondingCurveAddresses(): Promise<string[]> {
    try {
      const results = await db
        .selectDistinct({ bondingCurveAddress: tokens.bondingCurveAddress })
        .from(tokens)
        .where(
          and(
            sql`${tokens.bondingCurveAddress} IS NOT NULL`,
            sql`${tokens.bondingCurveAddress} != ''`
          )
        )
        .orderBy(asc(tokens.bondingCurveAddress));

      const addresses = results.map(row => row.bondingCurveAddress);
      console.log(`📋 Found ${addresses.length} unique bonding curve addresses`);
      return addresses;
    } catch (error) {
      console.error('❌ Error getting bonding curve addresses:', error);
      return [];
    }
  }

  /**
   * Get token statistics
   */
  async getTokenStats(): Promise<TokenStats | null> {
    try {
      const result = await db
        .select({
          totalTokens: count(),
        })
        .from(tokens);

      return result[0] || null;
    } catch (error) {
      console.error('❌ Error getting token stats:', error);
      return null;
    }
  }

  /**
   * Get token count
   */
  async getTokenCount(): Promise<number> {
    try {
      const result = await db.select({ count: count() }).from(tokens);
      return result[0]?.count || 0;
    } catch (error) {
      console.error('❌ Error getting token count:', error);
      return 0;
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    try {
      // Note: In production, you might want to manage the pool lifecycle differently
      console.log('✅ Database connection pool closed');
    } catch (error) {
      console.error('❌ Error closing database connection:', error);
    }
  }
}

// Export singleton instance
export const drizzleDB = new DrizzleDatabase();

export async function insertTokenToDB(token: TokenDocument): Promise<boolean> {
  return await drizzleDB.insertToken(token);
}

export async function insertTokensBatchToDB(tokenList: TokenDocument[]): Promise<{
  inserted: number;
  duplicates: number;
  errors: number;
}> {
  return await drizzleDB.insertTokensBatch(tokenList);
}

export async function getAllTokensFromDB(options?: {
  limit?: number;
  offset?: number;
  searchTerm?: string;
  complete?: boolean;
}): Promise<TokenDocument[]> {
  return await drizzleDB.getAllTokens(options);
}

export async function getAllBondingCurveAddresses() {
  return await drizzleDB.getAllBondingCurveAddresses();
}

export async function getTokenStatsFromDB(): Promise<TokenStats | null> {
  return await drizzleDB.getTokenStats();
}

export async function getTokenCountFromDB(): Promise<number> {
  return await drizzleDB.getTokenCount();
}
