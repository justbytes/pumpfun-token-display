// src/lib/utils/dataSyncUtility.ts - Updated for better-sqlite3
import {
  getAllTokensMongoDB,
  initializeDbConnection as initMongoDB,
  getMongoTokenStats as getMongoStats,
  insertTokensBatch,
} from '../db/mongoDB';
import { initializeSQLDB, insertTokensBatchToSQL, sqlDB, getTokenStatsFromSQL } from '../db/sql';

interface SyncResult {
  success: boolean;
  mongoTokens: number;
  sqliteTokensBefore: number;
  sqliteTokensAfter: number;
  inserted: number;
  duplicates: number;
  errors: number;
  duration: number;
}

/**
 * Convert MongoDB token to SQLite format (handles BigNumber objects)
 */
function format(token: any): any {
  // Helper function to safely convert values, especially BigNumber objects
  const safeString = (value: any): string => {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    // Handle BigNumber objects (they have a _bn property or words array)
    if (value && typeof value === 'object') {
      // If it's a BigNumber-like object, try to convert to string
      if (value._bn || value.words || value.toString) {
        try {
          return value.toString();
        } catch (error) {
          console.warn('Failed to convert BigNumber to string:', error);
          return '';
        }
      }

      // If it's any other object, stringify it
      try {
        return JSON.stringify(value);
      } catch (error) {
        return String(value);
      }
    }

    return String(value);
  };

  return {
    bondingCurveAddress: safeString(token.bondingCurveAddress),
    complete: Boolean(token.complete),
    creator: safeString(token.creator),
    tokenAddress: safeString(token.tokenAddress),
    name: safeString(token.name) || 'Unknown Token',
    symbol: safeString(token.symbol) || 'UNKNOWN',
    uri: safeString(token.uri),
    description: safeString(token.description),
    image: safeString(token.image),
  };
}

/**
 * Sync all tokens from SQLite to MongoDB
 */
export async function syncSQLiteToMongo(): Promise<SyncResult> {
  console.log('🔄 Starting SQLite to MongoDB sync...');
  const startTime = performance.now();

  let result: SyncResult = {
    success: false,
    mongoTokens: 0,
    sqliteTokensBefore: 0,
    sqliteTokensAfter: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    duration: 0,
  };

  try {
    // Initialize both databases
    console.log('🔌 Initializing database connections...');

    const [mongoConnected, sqliteConnected] = await Promise.all([initMongoDB(), initializeSQLDB()]);

    if (!mongoConnected) {
      throw new Error('Failed to connect to MongoDB');
    }

    if (!sqliteConnected) {
      throw new Error('Failed to initialize SQLite');
    }

    // Get current MongoDB stats (before sync)
    const mongoStatsBefore = await getMongoStats();
    result.mongoTokens = mongoStatsBefore?.totalTokens || 0;

    console.log(`📊 Current MongoDB tokens: ${result.mongoTokens}`);

    // Fetch all tokens from SQLite
    console.log('📥 Fetching all tokens from SQLite...');
    const sqliteTokens = await sqlDB.getAllTokensSQlite();
    result.sqliteTokensBefore = sqliteTokens.length;

    console.log(`📊 SQLite tokens fetched: ${result.sqliteTokensBefore}`);

    if (sqliteTokens.length === 0) {
      console.log('⚠️ No tokens found in SQLite');
      result.success = true;
      result.duration = performance.now() - startTime;
      return result;
    }

    // Convert SQLite format to MongoDB format (simple conversion)
    console.log('🔧 Converting SQLite tokens to MongoDB format...');
    const tokensForMongoDB = sqliteTokens.map(token => format(token));

    console.log(`✅ Converted ${tokensForMongoDB.length} tokens`);

    // Insert tokens in batches to MongoDB
    console.log('💾 Inserting tokens into MongoDB...');
    const BATCH_SIZE = 1000;
    let totalInserted = 0;
    let totalDuplicates = 0;
    let totalErrors = 0;

    for (let i = 0; i < tokensForMongoDB.length; i += BATCH_SIZE) {
      const batch = tokensForMongoDB.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(tokensForMongoDB.length / BATCH_SIZE);

      console.log(`🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} tokens)`);

      try {
        const batchResult = await insertTokensBatch(batch);
        totalInserted += batchResult.inserted;
        totalDuplicates += batchResult.duplicates;
        totalErrors += batchResult.errors;

        console.log(
          `   Batch result: +${batchResult.inserted} inserted, ${batchResult.duplicates} duplicates, ${batchResult.errors} errors`
        );
      } catch (batchError) {
        console.error(`❌ Batch ${batchNumber} failed:`, batchError);
        totalErrors += batch.length;
      }

      // Small delay to prevent overwhelming the system
      if (i + BATCH_SIZE < tokensForMongoDB.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    result.inserted = totalInserted;
    result.duplicates = totalDuplicates;
    result.errors = totalErrors;

    // Get final MongoDB stats
    const mongoStatsAfter = await getMongoStats();
    result.sqliteTokensAfter = mongoStatsAfter?.totalTokens || 0;

    result.success = true;
    result.duration = performance.now() - startTime;

    console.log('\n✅ Sync completed successfully!');
    console.log(`📊 Results:`);
    console.log(`   SQLite tokens: ${result.sqliteTokensBefore}`);
    console.log(`   MongoDB before: ${result.mongoTokens}`);
    console.log(`   MongoDB after: ${result.sqliteTokensAfter}`);
    console.log(`   Inserted: ${result.inserted}`);
    console.log(`   Duplicates: ${result.duplicates}`);
    console.log(`   Errors: ${result.errors}`);
    console.log(`   Duration: ${Math.round(result.duration)}ms`);

    return result;
  } catch (error) {
    console.error('❌ Sync failed:', error);
    result.success = false;
    result.duration = performance.now() - startTime;
    throw error;
  }
}

/**
 * Sync all tokens from MongoDB to SQLite
 */
export async function syncMongoToSQLite(): Promise<SyncResult> {
  console.log('🔄 Starting MongoDB to SQLite sync...');
  const startTime = performance.now();

  let result: SyncResult = {
    success: false,
    mongoTokens: 0,
    sqliteTokensBefore: 0,
    sqliteTokensAfter: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    duration: 0,
  };

  try {
    // Initialize both databases
    console.log('🔌 Initializing database connections...');

    const [mongoConnected, sqliteConnected] = await Promise.all([initMongoDB(), initializeSQLDB()]);

    if (!mongoConnected) {
      throw new Error('Failed to connect to MongoDB');
    }

    if (!sqliteConnected) {
      throw new Error('Failed to initialize SQLite');
    }

    // Get current SQLite stats
    const sqliteStatsBefore = await getTokenStatsFromSQL();
    result.sqliteTokensBefore = sqliteStatsBefore?.totalTokens || 0;

    console.log(`📊 Current SQLite tokens: ${result.sqliteTokensBefore}`);

    // Fetch all tokens from MongoDB
    console.log('📥 Fetching all tokens from MongoDB...');
    const mongoTokens = await getAllTokensMongoDB();
    result.mongoTokens = mongoTokens.length;

    console.log(`📊 MongoDB tokens fetched: ${result.mongoTokens}`);

    if (mongoTokens.length === 0) {
      console.log('⚠️ No tokens found in MongoDB');
      result.success = true;
      result.duration = performance.now() - startTime;
      return result;
    }

    // Convert MongoDB format to SQLite format (simple conversion)
    console.log('🔧 Converting MongoDB tokens to SQLite format...');
    const tokensForSQLite = mongoTokens.map((token: any) => format(token));

    console.log(`✅ Converted ${tokensForSQLite.length} tokens`);

    // Insert tokens in batches
    console.log('💾 Inserting tokens into SQLite...');
    const BATCH_SIZE = 1000;
    let totalInserted = 0;
    let totalDuplicates = 0;
    let totalErrors = 0;

    for (let i = 0; i < tokensForSQLite.length; i += BATCH_SIZE) {
      const batch = tokensForSQLite.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(tokensForSQLite.length / BATCH_SIZE);

      console.log(`🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} tokens)`);

      try {
        const batchResult = await insertTokensBatchToSQL(batch);
        totalInserted += batchResult.inserted;
        totalDuplicates += batchResult.duplicates;
        totalErrors += batchResult.errors;

        console.log(
          `   Batch result: +${batchResult.inserted} inserted, ${batchResult.duplicates} duplicates, ${batchResult.errors} errors`
        );
      } catch (batchError) {
        console.error(`❌ Batch ${batchNumber} failed:`, batchError);
        totalErrors += batch.length;
      }

      // Small delay to prevent overwhelming the system
      if (i + BATCH_SIZE < tokensForSQLite.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    result.inserted = totalInserted;
    result.duplicates = totalDuplicates;
    result.errors = totalErrors;

    // Get final SQLite stats
    const sqliteStatsAfter = await getTokenStatsFromSQL();
    result.sqliteTokensAfter = sqliteStatsAfter?.totalTokens || 0;

    result.success = true;
    result.duration = performance.now() - startTime;

    console.log('\n✅ Sync completed successfully!');
    console.log(`📊 Results:`);
    console.log(`   MongoDB tokens: ${result.mongoTokens}`);
    console.log(`   SQLite before: ${result.sqliteTokensBefore}`);
    console.log(`   SQLite after: ${result.sqliteTokensAfter}`);
    console.log(`   Inserted: ${result.inserted}`);
    console.log(`   Duplicates: ${result.duplicates}`);
    console.log(`   Errors: ${result.errors}`);
    console.log(`   Duration: ${Math.round(result.duration)}ms`);

    return result;
  } catch (error) {
    console.error('❌ Sync failed:', error);
    result.success = false;
    result.duration = performance.now() - startTime;
    throw error;
  }
}

/**
 * Check sync status - compare MongoDB and SQLite counts
 */
export async function checkSyncStatus(): Promise<{
  mongoTokens: number;
  sqliteTokens: number;
  inSync: boolean;
  difference: number;
}> {
  try {
    // Initialize connections
    await Promise.all([initMongoDB(), initializeSQLDB()]);

    // Get stats from both databases
    const [mongoStats, sqliteStats] = await Promise.all([getMongoStats(), getTokenStatsFromSQL()]);

    const mongoTokens = mongoStats?.totalTokens || 0;
    const sqliteTokens = sqliteStats?.totalTokens || 0;
    const difference = Math.abs(mongoTokens - sqliteTokens);
    const inSync = difference === 0;

    return {
      mongoTokens,
      sqliteTokens,
      inSync,
      difference,
    };
  } catch (error) {
    console.error('❌ Error checking sync status:', error);
    throw error;
  }
}

/**
 * CLI function for manual sync
 */
export async function runManualSync(transferToo: string): Promise<void> {
  try {
    let result;
    console.log('🚀 Starting manual sync...');

    if (transferToo == 'cloud') {
      result = await syncSQLiteToMongo();
    } else {
      result = await syncMongoToSQLite();
    }

    if (result.success) {
      console.log('✅ Manual sync completed successfully');

      if (result.errors > 0) {
        console.log(`⚠️ Completed with ${result.errors} errors`);
      }

      process.exit(0);
    } else {
      console.error('❌ Manual sync failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Manual sync error:', error);
    process.exit(1);
  }
}
/**
 *  transferTo can be either "cloud" or "sqlite"
 *
 *  "cloud" send the data from sqlite -> mongodb
 *  "sqlite" sends data from mongodb -> sqlite
 */
async function main(command: string, transferTo?: string) {
  if (command === 'sync') {
    if (!transferTo) return;

    // Sync to a database
    runManualSync(transferTo);
  } else if (command === 'status') {
    checkSyncStatus()
      .then(status => {
        console.log('📊 Sync Status:');
        console.log(`   MongoDB: ${status.mongoTokens} tokens`);
        console.log(`   SQLite: ${status.sqliteTokens} tokens`);
        console.log(`   In Sync: ${status.inSync ? '✅' : '❌'}`);
        if (!status.inSync) {
          console.log(`   Difference: ${status.difference} tokens`);
        }
        process.exit(0);
      })
      .catch(error => {
        console.error('❌ Error:', error);
        process.exit(1);
      });
  } else {
    console.log('Usage:');
    console.log('  npm run sync          - Run one-time sync');
    console.log('  npm run sync status   - Check sync status');
    process.exit(1);
  }
}

main('sync', 'cloud');
