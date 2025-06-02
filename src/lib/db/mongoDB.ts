// src/lib/db/mongoDB.ts
import { MongoClient, Db, Collection, ServerApiVersion, Filter } from 'mongodb';
import { promises as fs } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// Token document interface (matches your Token type)
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
}

// Global client variables
let _client: MongoClient | null = null;
let _db: Db | null = null;

// Get or create MongoDB connection
export function getDbConnection(): Db {
  if (_client === null) {
    const mongoUrl = process.env.MONGO_DB_URL;
    if (!mongoUrl) {
      throw new Error('MONGO_URL environment variable is not set');
    }

    _client = new MongoClient(mongoUrl, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: false,
      },
    });

    _db = _client.db('pumpfun-tokens');
  }

  return _db!;
}

// Initialize and test MongoDB connection
export async function initializeMongoDb(): Promise<boolean> {
  try {
    // establish connection to mongo
    getDbConnection();

    // Ping the db
    await _client!.db('admin').command({ ping: 1 });
    console.log('✅ MongoDB connection established');

    // Create the indexes
    await createMongoIndexes();
    return true;
  } catch {
    console.error('❌ MongoDB connection failed');
    return false;
  }
}

// Batch insert tokens with duplicate handling
export async function insertTokensBatchMongoDB(tokens: TokenDocument[]): Promise<{
  inserted: number;
  duplicates: number;
  errors: number;
}> {
  try {
    const db = getDbConnection();
    const collection: Collection<TokenDocument> = db.collection('tokens');

    // Convert Token[] to TokenDocument[] (handle Uint8Array -> number[] conversion)
    const documents: TokenDocument[] = tokens.map(token => ({
      bondingCurveAddress: token.bondingCurveAddress,
      complete: token.complete,
      creator: token.creator,
      tokenAddress: token.tokenAddress,
      name: token.name,
      symbol: token.symbol,
      uri: token.uri,
      description: token.description,
      image: token.image,
    }));

    // Use ordered: false to continue inserting even if some fail (duplicates)
    const result = await collection.insertMany(documents, {
      ordered: false,
    });

    return {
      inserted: result.insertedCount,
      duplicates: tokens.length - result.insertedCount,
      errors: 0,
    };
  } catch (error: unknown) {
    // Type guard to check if error has the properties we need
    if (error && typeof error === 'object' && 'code' in error) {
      const mongoError = error as {
        code?: number;
        name?: string;
        result?: { insertedCount?: number };
      };

      // Handle bulk write errors (like duplicates)
      if (mongoError.code === 11000 || mongoError.name === 'MongoBulkWriteError') {
        const inserted = mongoError.result?.insertedCount || 0;
        const duplicates = tokens.length - inserted;

        console.log(`✅ Inserted: ${inserted}, Duplicates skipped: ${duplicates}`);
        return {
          inserted,
          duplicates,
          errors: 0,
        };
      }
    }

    console.error(`❌ Error in batch insert:`, error);
    return {
      inserted: 0,
      duplicates: 0,
      errors: tokens.length,
    };
  }
}

// Load addresses from JSON file and insert into database
export async function loadTokenListFromFile(filePath: string): Promise<{
  total: number;
  inserted: number;
  duplicates: number;
  errors: number;
}> {
  try {
    console.log(`📂 Loading tokens from ${filePath}...`);

    const fileContent = await fs.readFile(filePath, 'utf8');
    const tokens: TokenDocument[] = JSON.parse(fileContent);

    console.log(`📊 Found ${tokens.length} tokens in file`);

    // Process in chunks to avoid memory issues and timeout
    const CHUNK_SIZE = 1000;
    let totalInserted = 0;
    let totalDuplicates = 0;
    let totalErrors = 0;

    for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
      const chunk = tokens.slice(i, i + CHUNK_SIZE);
      console.log(
        `🔄 Processing chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(
          tokens.length / CHUNK_SIZE
        )} (${chunk.length} tokens)`
      );

      const result = await insertTokensBatchMongoDB(chunk);
      totalInserted += result.inserted;
      totalDuplicates += result.duplicates;
      totalErrors += result.errors;

      // Small delay to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return {
      total: tokens.length,
      inserted: totalInserted,
      duplicates: totalDuplicates,
      errors: totalErrors,
    };
  } catch {
    console.error(`❌ Error loading tokens from file to mongodb`);
    return {
      total: 0,
      inserted: 0,
      duplicates: 0,
      errors: 0,
    };
  }
}

// Get all tokens
export async function getAllTokensMongoDB(filter?: {
  name?: string;
  symbol?: string;
  complete?: boolean;
  limit?: number;
}): Promise<TokenDocument[]> {
  try {
    const db = getDbConnection();
    const collection: Collection<TokenDocument> = db.collection('tokens');

    const query: Filter<TokenDocument> = {};

    // Build query based on filters - updated for new structure
    if (filter?.name) {
      query.name = { $regex: filter.name, $options: 'i' };
    }
    if (filter?.symbol) {
      query.symbol = { $regex: filter.symbol, $options: 'i' };
    }
    if (filter?.complete !== undefined) {
      query.complete = filter.complete;
    }

    let cursor = collection.find(query);

    if (filter?.limit) {
      cursor = cursor.limit(filter.limit);
    }

    return await cursor.toArray();
  } catch {
    console.error(`❌ Error getting tokens from mongo db`);
    return [];
  }
}
// Get token by mint address
export async function getTokenByMint(mint: string): Promise<TokenDocument | null> {
  try {
    const db = getDbConnection();
    const collection: Collection<TokenDocument> = db.collection('tokens');

    return await collection.findOne({ 'tokenData.mint': mint });
  } catch {
    console.error(`❌ Error getting token by mint in mongodb`);
    return null;
  }
}

// Get token by bonding curve address
export async function getTokenByBondingCurve(
  bondingCurveAddress: string
): Promise<TokenDocument | null> {
  try {
    const db = getDbConnection();
    const collection: Collection<TokenDocument> = db.collection('tokens');

    return await collection.findOne({ bondingCurveAddress });
  } catch {
    console.error(`❌ Error getting token by bonding curve in mongodb`);
    return null;
  }
}

// Add a single token
export async function insertToken(token: TokenDocument): Promise<boolean> {
  try {
    const db = getDbConnection();
    const collection: Collection<TokenDocument> = db.collection('tokens');

    // Convert Token to TokenDocument
    const document: TokenDocument = {
      bondingCurveAddress: token.bondingCurveAddress,
      complete: token.complete,
      creator: token.creator,
      tokenAddress: token.tokenAddress,
      name: token.name,
      symbol: token.symbol,
      uri: token.uri,
      description: token.description,
      image: token.image,
    };

    const result = await collection.insertOne(document);
    return result.insertedId !== null;
  } catch (error: unknown) {
    // Type guard to check if error has the properties we need
    if (error && typeof error === 'object' && 'code' in error) {
      const mongoError = error as { code?: number };

      // Handle duplicate key error
      if (mongoError.code === 11000) {
        console.log(`⚠️ Token ${token.tokenAddress} already exists in database`);
        return true;
      }
    }

    console.error(`❌ Error adding token to mongodb`);
    return false;
  }
}

// Get token statistics
export async function getMongoTokenStats(): Promise<{
  totalTokens: number;
  completedBondingCurves: number;
  activeBondingCurves: number;
} | null> {
  try {
    const db = getDbConnection();
    const collection: Collection<TokenDocument> = db.collection('tokens');

    const [totalTokens, completedBondingCurves] = await Promise.all([
      collection.countDocuments({}),
      collection.countDocuments({ complete: true }), // Updated for new structure
    ]);

    return {
      totalTokens,
      completedBondingCurves,
      activeBondingCurves: totalTokens - completedBondingCurves,
    };
  } catch {
    console.error(`❌ Error getting token stats from mongodb`);
    return null;
  }
}

// Create database indexes for better performance
export async function createMongoIndexes(): Promise<boolean> {
  try {
    const db = getDbConnection();
    const collection: Collection<TokenDocument> = db.collection('tokens');

    // Drop old indexes first
    await collection.dropIndexes();

    // Create new indexes for the updated structure
    await Promise.all([
      // Unique index on tokenAddress
      collection.createIndex({ tokenAddress: 1 }, { unique: true }),

      // Unique index on bonding curve address
      collection.createIndex({ bondingCurveAddress: 1 }, { unique: true }),

      // Text index for searching name and symbol (updated paths)
      collection.createIndex(
        {
          name: 'text',
          symbol: 'text',
        },
        {
          name: 'token_search_index',
          weights: {
            name: 10,
            symbol: 5,
          },
        }
      ),

      // Index on complete status (updated path)
      collection.createIndex({ complete: 1 }),

      // Compound index for common queries (updated paths)
      collection.createIndex({
        symbol: 1,
        complete: 1,
      }),

      // Index on creator
      collection.createIndex({ creator: 1 }),
    ]);

    console.log('✅ Updated token collection indexes created successfully');
    return true;
  } catch {
    console.error(`❌ Error creating updated token indexes for mongodb`);
    return false;
  }
}

// Search tokens by name or symbol
export async function searchTokens(
  searchTerm: string,
  limit: number = 50
): Promise<TokenDocument[]> {
  try {
    const db = getDbConnection();
    const collection: Collection<TokenDocument> = db.collection('tokens');

    // Search in both name and symbol fields - updated for new structure
    const tokens = await collection
      .find({
        $or: [
          { name: { $regex: searchTerm, $options: 'i' } },
          { symbol: { $regex: searchTerm, $options: 'i' } },
        ],
      })
      .limit(limit)
      .toArray();

    return tokens;
  } catch {
    console.error(`❌ Error searching tokens in mongodb`);
    return [];
  }
}

//// IF YOU HAVE PUMPFUN TOKENS IN A FILE ////////

// async function loadTokenListToDatabase() {
//   console.log('🚀 Starting token loading process...');

//   try {
//     // Initialize database connection
//     const connected = await initializeMongoDb();
//     if (!connected) {
//       throw new Error('Failed to connect to MongoDB');
//     }

//     // Get current database stats
//     console.log('📊 Current database stats:');

//     // Get stats
//     const tokenStats = await getMongoTokenStats();

//     console.log(`   Total tokens: ${tokenStats?.totalTokens || 0}`);
//     console.log(`   Completed bonding curves: ${tokenStats?.completedBondingCurves || 0}`);
//     console.log(`   Active bonding curves: ${tokenStats?.activeBondingCurves || 0}`);

//     // Load tokens from your JSON file
//     const JSON_FILE_PATH = `${process.env.DATA_PATH}/pumpfun_token_list.json`;

//     console.log('\n🔄 Loading tokens from file...');
//     const result = await loadTokenListFromFile(JSON_FILE_PATH);

//     // Show results
//     console.log('\n✅ Loading completed!');
//     console.log(`   Total tokens in file: ${result.total}`);
//     console.log(`   Successfully inserted: ${result.inserted}`);
//     console.log(`   Duplicates skipped: ${result.duplicates}`);
//     console.log(`   Errors: ${result.errors}`);

//     // Get updated database stats
//     console.log('\n📊 Updated database stats:');
//     const updatedTokenStats = await getMongoTokenStats();
//     console.log(`   Total tokens: ${updatedTokenStats?.totalTokens || 0}`);
//     console.log(`   Completed bonding curves: ${updatedTokenStats?.completedBondingCurves || 0}`);
//     console.log(`   Active bonding curves: ${updatedTokenStats?.activeBondingCurves || 0}`);
//   } catch (error) {
//     console.error('❌ Error during loading process:', error);
//     process.exit(1);
//   } finally {
//     // Close the connection
//     if (_client) {
//       await _client.close();
//     }
//     process.exit(0);
//   }
// }

//// CHANGING THE STRUCTURE OF THE TOKEN DOCUMENT ////////

// Migration function to flatten token document structure
export async function migrateTokenDocuments(): Promise<{
  total: number;
  migrated: number;
  alreadyMigrated: number;
  errors: number;
}> {
  console.log('🚀 Starting token document migration...');

  try {
    const db = getDbConnection();
    const collection = db.collection('tokens');

    // First, count total documents
    const totalCount = await collection.countDocuments({});
    console.log(`📊 Total documents in collection: ${totalCount}`);

    // Count documents that need migration (have nested structure)
    const needsMigrationCount = await collection.countDocuments({
      bondingCurveData: { $exists: true },
    });

    const alreadyMigratedCount = totalCount - needsMigrationCount;

    console.log(`📊 Documents needing migration: ${needsMigrationCount}`);
    console.log(`📊 Already migrated documents: ${alreadyMigratedCount}`);

    if (needsMigrationCount === 0) {
      console.log('✅ All documents are already migrated!');
      return {
        total: totalCount,
        migrated: 0,
        alreadyMigrated: alreadyMigratedCount,
        errors: 0,
      };
    }

    // Create backup collection first
    console.log('💾 Creating backup collection...');
    const backupCollectionName = `tokens_backup_${Date.now()}`;

    await collection
      .aggregate([
        { $match: { bondingCurveData: { $exists: true } } },
        { $out: backupCollectionName },
      ])
      .toArray();

    console.log(`✅ Backup created: ${backupCollectionName}`);

    // Perform migration using aggregation pipeline
    console.log('🔄 Starting migration...');

    const migrationResult = await collection.updateMany(
      { bondingCurveData: { $exists: true } }, // Only migrate documents with old structure
      [
        {
          $set: {
            complete: '$bondingCurveData.complete',
            creator: '$bondingCurveData.creator',
            name: '$tokenData.name',
            symbol: '$tokenData.symbol',
            uri: '$tokenData.uri',
            description: '$tokenData.description',
            image: '$tokenData.image',
          },
        },
        {
          $unset: ['bondingCurveData', 'tokenData'],
        },
      ]
    );

    console.log('✅ Migration completed!');
    console.log(`📊 Documents modified: ${migrationResult.modifiedCount}`);

    // Verify migration
    console.log('🔍 Verifying migration...');
    const remainingOldDocs = await collection.countDocuments({
      bondingCurveData: { $exists: true },
    });

    const newStructureDocs = await collection.countDocuments({
      complete: { $exists: true },
      creator: { $exists: true },
      name: { $exists: true },
    });

    console.log(`📊 Remaining old structure documents: ${remainingOldDocs}`);
    console.log(`📊 New structure documents: ${newStructureDocs}`);

    // Sample document check
    console.log('📋 Sample migrated document:');
    const sampleDoc = await collection.findOne({
      complete: { $exists: true },
    });
    console.log(JSON.stringify(sampleDoc, null, 2));

    return {
      total: totalCount,
      migrated: migrationResult.modifiedCount,
      alreadyMigrated: alreadyMigratedCount,
      errors: remainingOldDocs,
    };
  } catch {
    console.error('❌ Error during mongodb migration');
    return {
      total: 0,
      migrated: 0,
      alreadyMigrated: 0,
      errors: 0,
    };
  }
}

// Function to run the migration with proper connection handling
export async function runTokenMigration(): Promise<void> {
  try {
    // Initialize database connection
    const connected = await initializeMongoDb();
    if (!connected) {
      throw new Error('Failed to connect to MongoDB');
    }

    // Run migration
    const result = await migrateTokenDocuments();

    // Show final results
    console.log('\n🎉 Migration Summary:');
    console.log(`   Total documents: ${result.total}`);
    console.log(`   Migrated: ${result.migrated}`);
    console.log(`   Already migrated: ${result.alreadyMigrated}`);
    console.log(`   Errors: ${result.errors}`);

    if (result.errors === 0) {
      console.log('✅ Migration completed successfully!');
    } else {
      console.log('⚠️ Migration completed with some issues. Check the logs above.');
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    // Close connection
    if (_client) {
      await _client.close();
    }
  }
}

// Helper function to rollback migration if needed
export async function rollbackTokenMigration(backupCollectionName: string): Promise<void> {
  console.log('🔄 Starting rollback...');

  try {
    const db = getDbConnection();

    // Drop current tokens collection
    await db.collection('tokens').drop();
    console.log('🗑️ Dropped current tokens collection');

    // Rename backup collection back to tokens
    await db.collection(backupCollectionName).rename('tokens');
    console.log('✅ Restored from backup');
  } catch (error) {
    console.error('❌ Rollback failed:', error);
    throw error;
  }
}
