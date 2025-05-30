import { MongoClient, Db, Collection, ServerApi, ServerApiVersion, WithId } from 'mongodb';
import { promises as fs } from 'fs';
import dotenv from 'dotenv';
import { Token } from '../types/types';

dotenv.config();

// Types for better type safety
interface BondingCurveDocument {
  address: string;
}

// Token document interface (matches your Token type)
interface TokenDocument {
  bondingCurveAddress: string;
  tokenAddress: string;
  bondingCurveData: {
    discriminator: number[];
    virtualTokenReserves: string;
    virtualSolReserves: string;
    realTokenReserves: string;
    realSolReserves: string;
    tokenTotalSupply: string;
    complete: boolean;
    creator: string;
  };
  tokenData: {
    mint: string;
    name: string;
    symbol: string;
    uri: string;
    description: string;
    image: string;
  };
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
export async function initializeDbConnection(): Promise<boolean> {
  try {
    const db = getDbConnection();
    await _client!.db('admin').command({ ping: 1 });
    console.log('✅ MongoDB connection established');
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    return false;
  }
}

// Batch insert bonding curves with duplicate handling
export async function insertBondingCurvesBatch(addresses: string[]): Promise<{
  inserted: number;
  duplicates: number;
  errors: number;
}> {
  try {
    const db = getDbConnection();
    const collection: Collection<BondingCurveDocument> = db.collection('bonding-curves');

    // Prepare documents for insertion
    const documents: BondingCurveDocument[] = addresses.map(address => ({
      address,
    }));

    // Use ordered: false to continue inserting even if some fail (duplicates)
    const result = await collection.insertMany(documents, {
      ordered: false,
    });

    return {
      inserted: result.insertedCount,
      duplicates: addresses.length - result.insertedCount,
      errors: 0,
    };
  } catch (error: any) {
    // Handle bulk write errors (like duplicates)
    if (error.code === 11000 || error.name === 'MongoBulkWriteError') {
      const inserted = error.result?.insertedCount || 0;
      const duplicates = addresses.length - inserted;

      console.log(`✅ Inserted: ${inserted}, Duplicates skipped: ${duplicates}`);
      return {
        inserted,
        duplicates,
        errors: 0,
      };
    }

    console.error(`❌ Error in batch insert: ${error}`);
    return {
      inserted: 0,
      duplicates: 0,
      errors: addresses.length,
    };
  }
}

// Batch insert tokens with duplicate handling
export async function insertTokensBatch(tokens: Token[]): Promise<{
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
      tokenAddress: token.tokenAddress,
      bondingCurveData: {
        discriminator: Array.from(token.bondingCurveData.discriminator), // Convert Uint8Array to number[]
        virtualTokenReserves: token.bondingCurveData.virtualTokenReserves,
        virtualSolReserves: token.bondingCurveData.virtualSolReserves,
        realTokenReserves: token.bondingCurveData.realTokenReserves,
        realSolReserves: token.bondingCurveData.realSolReserves,
        tokenTotalSupply: token.bondingCurveData.tokenTotalSupply,
        complete: token.bondingCurveData.complete,
        creator: token.bondingCurveData.creator,
      },
      tokenData: token.tokenData,
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
  } catch (error: any) {
    // Handle bulk write errors (like duplicates)
    if (error.code === 11000 || error.name === 'MongoBulkWriteError') {
      const inserted = error.result?.insertedCount || 0;
      const duplicates = tokens.length - inserted;

      console.log(`✅ Inserted: ${inserted}, Duplicates skipped: ${duplicates}`);
      return {
        inserted,
        duplicates,
        errors: 0,
      };
    }

    console.error(`❌ Error in batch insert: ${error}`);
    return {
      inserted: 0,
      duplicates: 0,
      errors: tokens.length,
    };
  }
}

// Load addresses from JSON file and insert into database
export async function loadBondingCurveAddressesFromFile(filePath: string): Promise<{
  total: number;
  inserted: number;
  duplicates: number;
  errors: number;
}> {
  try {
    console.log(`📂 Loading addresses from ${filePath}...`);

    const fileContent = await fs.readFile(filePath, 'utf8');
    const addresses: string[] = JSON.parse(fileContent);

    console.log(`📊 Found ${addresses.length} addresses in file`);

    // Process in chunks to avoid memory issues and timeout
    const CHUNK_SIZE = 1000;
    let totalInserted = 0;
    let totalDuplicates = 0;
    let totalErrors = 0;

    for (let i = 0; i < addresses.length; i += CHUNK_SIZE) {
      const chunk = addresses.slice(i, i + CHUNK_SIZE);
      console.log(
        `🔄 Processing chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(
          addresses.length / CHUNK_SIZE
        )} (${chunk.length} addresses)`
      );

      const result = await insertBondingCurvesBatch(chunk);
      totalInserted += result.inserted;
      totalDuplicates += result.duplicates;
      totalErrors += result.errors;

      // Small delay to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return {
      total: addresses.length,
      inserted: totalInserted,
      duplicates: totalDuplicates,
      errors: totalErrors,
    };
  } catch (error) {
    console.error(`❌ Error loading addresses from file: ${error}`);
    throw error;
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
    const tokens: Token[] = JSON.parse(fileContent);

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

      const result = await insertTokensBatch(chunk);
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
  } catch (error) {
    console.error(`❌ Error loading tokens from file: ${error}`);
    throw error;
  }
}

// Get all bonding curve addresses (for your update process)
export async function getAllBondingCurveAddresses(): Promise<string[]> {
  try {
    const db = getDbConnection();
    const collection: Collection<BondingCurveDocument> = db.collection('bonding-curves');

    // Only return the address field, exclude _id
    const documents = await collection
      .find(
        {},
        {
          projection: { address: 1, _id: 0 },
        }
      )
      .toArray();

    return documents.map(doc => doc.address);
  } catch (error) {
    console.error(`❌ Error getting bonding curve addresses: ${error}`);
    return [];
  }
}

// Add a single bonding curve
export async function insertBondingCurve(bondingCurve: string): Promise<boolean> {
  try {
    const db = getDbConnection();
    const collection: Collection<BondingCurveDocument> = db.collection('bonding-curves');

    const result = await collection.insertOne({
      address: bondingCurve,
    });

    return result.insertedId !== null;
  } catch (error: any) {
    // Handle duplicate key error
    if (error.code === 11000) {
      console.log(`⚠️ Address ${bondingCurve} already exists in database`);
      return true; // Consider it successful since the address is already there
    }
    console.error(`❌ Error adding bonding curve to db: ${error}`);
    return false;
  }
}

// Get all tokens (with optional filters)
export async function getAllTokens(filter?: {
  name?: string;
  symbol?: string;
  limit?: number;
}): Promise<TokenDocument[]> {
  try {
    const db = getDbConnection();
    const collection: Collection<TokenDocument> = db.collection('tokens');

    let query: any = {};

    // Build query based on filters
    if (filter?.name) {
      query['tokenData.name'] = { $regex: filter.name, $options: 'i' }; // Case insensitive search
    }
    if (filter?.symbol) {
      query['tokenData.symbol'] = { $regex: filter.symbol, $options: 'i' };
    }

    let cursor = collection.find(query);

    if (filter?.limit) {
      cursor = cursor.limit(filter.limit);
    }

    return await cursor.toArray();
  } catch (error) {
    console.error(`❌ Error getting tokens: ${error}`);
    return [];
  }
}

// Get token by mint address
export async function getTokenByMint(mint: string): Promise<TokenDocument | null> {
  try {
    const db = getDbConnection();
    const collection: Collection<TokenDocument> = db.collection('tokens');

    return await collection.findOne({ 'tokenData.mint': mint });
  } catch (error) {
    console.error(`❌ Error getting token by mint: ${error}`);
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
  } catch (error) {
    console.error(`❌ Error getting token by bonding curve: ${error}`);
    return null;
  }
}

// Add a single token
export async function insertToken(token: Token): Promise<boolean> {
  try {
    const db = getDbConnection();
    const collection: Collection<TokenDocument> = db.collection('tokens');

    // Convert Token to TokenDocument
    const document: TokenDocument = {
      bondingCurveAddress: token.bondingCurveAddress,
      tokenAddress: token.tokenAddress,
      bondingCurveData: {
        discriminator: Array.from(token.bondingCurveData.discriminator),
        virtualTokenReserves: token.bondingCurveData.virtualTokenReserves,
        virtualSolReserves: token.bondingCurveData.virtualSolReserves,
        realTokenReserves: token.bondingCurveData.realTokenReserves,
        realSolReserves: token.bondingCurveData.realSolReserves,
        tokenTotalSupply: token.bondingCurveData.tokenTotalSupply,
        complete: token.bondingCurveData.complete,
        creator: token.bondingCurveData.creator,
      },
      tokenData: token.tokenData,
    };

    const result = await collection.insertOne(document);
    return result.insertedId !== null;
  } catch (error: any) {
    // Handle duplicate key error
    if (error.code === 11000) {
      console.log(`⚠️ Token ${token.tokenAddress} already exists in database`);
      return true;
    }
    console.error(`❌ Error adding token to db: ${error}`);
    return false;
  }
}

// Get database statistics
export async function getDatabaseStats(): Promise<number | null> {
  try {
    const db = getDbConnection();
    const collection: Collection<BondingCurveDocument> = db.collection('bonding-curves');

    const [total] = await Promise.all([collection.countDocuments({})]);

    return total;
  } catch (error) {
    console.error(`❌ Error getting database stats: ${error}`);
    return null;
  }
}

// Get token statistics
export async function getTokenStats(): Promise<{
  totalTokens: number;
  completedBondingCurves: number;
  activeBondingCurves: number;
} | null> {
  try {
    const db = getDbConnection();
    const collection: Collection<TokenDocument> = db.collection('tokens');

    const [totalTokens, completedBondingCurves] = await Promise.all([
      collection.countDocuments({}),
      collection.countDocuments({ 'bondingCurveData.complete': true }),
    ]);

    return {
      totalTokens,
      completedBondingCurves,
      activeBondingCurves: totalTokens - completedBondingCurves,
    };
  } catch (error) {
    console.error(`❌ Error getting token stats: ${error}`);
    return null;
  }
}

// Create database indexes for better performance
export async function createIndexes(): Promise<boolean> {
  try {
    const db = getDbConnection();
    const collection: Collection<BondingCurveDocument> = db.collection('bonding-curves');

    // Create unique index on address to prevent duplicates
    await collection.createIndex({ address: 1 }, { unique: true });

    console.log('✅ Database indexes created successfully');
    return true;
  } catch (error) {
    console.error(`❌ Error creating indexes: ${error}`);
    return false;
  }
}

// Create indexes for the tokens collection
export async function createTokenIndexes(): Promise<boolean> {
  try {
    const db = getDbConnection();
    const collection: Collection<TokenDocument> = db.collection('tokens');

    // Create indexes for efficient queries
    await Promise.all([
      // Unique index on tokenAddress (mint)
      collection.createIndex({ tokenAddress: 1 }, { unique: true }),

      // Unique index on bonding curve address
      collection.createIndex({ bondingCurveAddress: 1 }, { unique: true }),

      // Index on mint for fast lookups
      collection.createIndex({ 'tokenData.mint': 1 }),

      // Text index for searching name and symbol
      collection.createIndex(
        {
          'tokenData.name': 'text',
          'tokenData.symbol': 'text',
        },
        {
          name: 'token_search_index',
          weights: {
            'tokenData.name': 10,
            'tokenData.symbol': 5,
          },
        }
      ),

      // Index on bonding curve complete status
      collection.createIndex({ 'bondingCurveData.complete': 1 }),

      // Compound index for common queries
      collection.createIndex({
        'tokenData.symbol': 1,
        'bondingCurveData.complete': 1,
      }),
    ]);

    console.log('✅ Token collection indexes created successfully');
    return true;
  } catch (error) {
    console.error(`❌ Error creating token indexes: ${error}`);
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

    // Search in both name and symbol fields
    const tokens = await collection
      .find({
        $or: [
          { 'tokenData.name': { $regex: searchTerm, $options: 'i' } },
          { 'tokenData.symbol': { $regex: searchTerm, $options: 'i' } },
        ],
      })
      .limit(limit)
      .toArray();

    return tokens;
  } catch (error) {
    console.error(`❌ Error searching tokens: ${error}`);
    return [];
  }
}

async function loadBondingCurveAddressesToDatabase() {
  console.log('🚀 Starting address loading process...');

  try {
    // Initialize database connection
    const connected = await initializeDbConnection();
    if (!connected) {
      throw new Error('Failed to connect to MongoDB');
    }

    // Create indexes (run this once, or it will skip if indexes already exist)
    console.log('📝 Creating database indexes...');
    await createIndexes();

    // Get current database stats
    console.log('📊 Current database stats:');
    const statsBefore = await getDatabaseStats();
    console.log(`   Total addresses: ${statsBefore}`);

    // Load addresses from your JSON file
    const JSON_FILE_PATH =
      '/Users/xtox/Coding/pumpfun-token-display/src/lib/data/bonding_addresses.json'; // Update this path

    console.log('\n🔄 Loading addresses from file...');
    const result = await loadBondingCurveAddressesFromFile(JSON_FILE_PATH);

    // Show results
    console.log('\n✅ Loading completed!');
    console.log(`   Total addresses in file: ${result.total}`);
    console.log(`   Successfully inserted: ${result.inserted}`);
    console.log(`   Duplicates skipped: ${result.duplicates}`);
    console.log(`   Errors: ${result.errors}`);

    // Get updated database stats
    console.log('\n📊 Updated database stats:');
    const statsAfter = await getDatabaseStats();
    console.log(`   Total addresses: ${statsAfter}`);
  } catch (error) {
    console.error('❌ Error during loading process:', error);
    process.exit(1);
  } finally {
    // Close the connection
    process.exit(0);
  }
}
// Function to load token list to database
async function loadTokenListToDatabase() {
  console.log('🚀 Starting token loading process...');

  try {
    // Initialize database connection
    const connected = await initializeDbConnection();
    if (!connected) {
      throw new Error('Failed to connect to MongoDB');
    }

    // Create indexes for both collections
    console.log('📝 Creating database indexes...');
    await Promise.all([
      createIndexes(), // Bonding curve indexes
      createTokenIndexes(), // Token indexes
    ]);

    // Get current database stats
    console.log('📊 Current database stats:');
    const [bondingCurveStats, tokenStats] = await Promise.all([
      getDatabaseStats(),
      getTokenStats(),
    ]);

    console.log(`   Bonding curve addresses: ${bondingCurveStats}`);
    console.log(`   Total tokens: ${tokenStats?.totalTokens || 0}`);
    console.log(`   Completed bonding curves: ${tokenStats?.completedBondingCurves || 0}`);
    console.log(`   Active bonding curves: ${tokenStats?.activeBondingCurves || 0}`);

    // Load tokens from your JSON file
    const JSON_FILE_PATH =
      '/Users/xtox/Coding/pumpfun-token-display/src/lib/data/pumpfun_token_list.json';

    console.log('\n🔄 Loading tokens from file...');
    const result = await loadTokenListFromFile(JSON_FILE_PATH);

    // Show results
    console.log('\n✅ Loading completed!');
    console.log(`   Total tokens in file: ${result.total}`);
    console.log(`   Successfully inserted: ${result.inserted}`);
    console.log(`   Duplicates skipped: ${result.duplicates}`);
    console.log(`   Errors: ${result.errors}`);

    // Get updated database stats
    console.log('\n📊 Updated database stats:');
    const updatedTokenStats = await getTokenStats();
    console.log(`   Total tokens: ${updatedTokenStats?.totalTokens || 0}`);
    console.log(`   Completed bonding curves: ${updatedTokenStats?.completedBondingCurves || 0}`);
    console.log(`   Active bonding curves: ${updatedTokenStats?.activeBondingCurves || 0}`);
  } catch (error) {
    console.error('❌ Error during loading process:', error);
    process.exit(1);
  } finally {
    // Close the connection
    if (_client) {
      await _client.close();
    }
    process.exit(0);
  }
}

// loadTokenListToDatabase();
createTokenIndexes();
//loadBondingCurveAddressesToDatabase();
