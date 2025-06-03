// src/lib/models/PumpfunEventListener.ts

import { Connection, PublicKey } from '@solana/web3.js';
import { BorshCoder, Idl } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

import { TokenMetadata } from '../types/types';
import { insertToken } from '../db/mongoDB';
import { insertTokenToSQL, initializeSQLDB } from '../db/sqlite';

dotenv.config();

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

interface CreateEvent {
  name: string;
  symbol: string;
  uri: string;
  mint: string;
  bonding_curve: string;
  user: string;
  creator: string;
  timestamp: string;
  virtual_token_reserves: string;
  virtual_sol_reserves: string;
  real_token_reserves: string;
  token_total_supply: string;
}

// CreateEvent discriminator from your IDL
const CREATE_EVENT_DISCRIMINATOR = Buffer.from([27, 114, 169, 77, 222, 235, 99, 118]);

class PumpFunEventListener {
  private connection: Connection;
  private coder: BorshCoder;
  private logSubscriptionId: number | null = null;
  private newTokens: string[] = [];
  private sqliteInitialized: boolean = false;
  private mongoQueue: TokenDocument[] = []; // Queue for MongoDB updates
  private mongoUpdateInterval: NodeJS.Timeout | null = null;

  /**
   * Constructor
   */
  constructor(idl: Idl) {
    // Create the connection
    this.connection = new Connection(`${process.env.HELIUS_RPC_URL}`, {
      commitment: 'confirmed',
    });
    // Decode the pumpfun idl
    this.coder = new BorshCoder(idl);

    // list for new tokens if its needed
    this.newTokens = [];
    this.mongoQueue = [];
  }

  /**
   * Helper function to safely convert Solana/Anchor data types to strings
   */
  private safeStringify(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }

    // Handle PublicKey objects or any object with toString method
    if (
      value &&
      typeof value === 'object' &&
      'toString' in value &&
      typeof value.toString === 'function'
    ) {
      try {
        return value.toString();
      } catch (error) {
        console.warn('Failed to convert object to string:', error);
        return '';
      }
    }

    // Handle buffers
    if (Buffer.isBuffer(value)) {
      return value.toString('base64');
    }

    // Handle arrays
    if (Array.isArray(value)) {
      try {
        return JSON.stringify(value);
      } catch {
        return '';
      }
    }

    // Handle any other object
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }

    return String(value);
  }

  /**
   * Initialize SQLite database
   */
  private async initializeSQLite(): Promise<void> {
    if (this.sqliteInitialized) return;

    const initialized = await initializeSQLDB();
    if (!initialized) {
      throw new Error('Failed to initialize SQLite database');
    }

    this.sqliteInitialized = true;
    console.log('✅ SQLite database initialized for event listener');
  }

  /**
   * Start MongoDB update timer (every 5 minutes)
   */
  private startMongoUpdateTimer(): void {
    const MONGO_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes

    this.mongoUpdateInterval = setInterval(async () => {
      await this.flushMongoQueue();
    }, MONGO_UPDATE_INTERVAL);

    console.log('⏰ MongoDB update timer started (5 minute intervals)');
  }

  /**
   * Flush queued tokens to MongoDB
   */
  private async flushMongoQueue(): Promise<void> {
    if (this.mongoQueue.length === 0) {
      return;
    }

    console.log(`🔄 Syncing ${this.mongoQueue.length} tokens to MongoDB...`);

    const tokensToSync = [...this.mongoQueue];
    this.mongoQueue = []; // Clear queue immediately

    let successCount = 0;
    let errorCount = 0;

    for (const tokenDocument of tokensToSync) {
      try {
        await insertToken(tokenDocument);
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to sync token ${tokenDocument.tokenAddress} to MongoDB:`, error);
        errorCount++;
        // Re-add failed tokens back to queue for next attempt
        this.mongoQueue.push(tokenDocument);
      }
    }

    console.log(`✅ MongoDB sync complete: ${successCount} synced, ${errorCount} failed`);
  }

  /**
   * Starts the listener
   */
  async startListening() {
    try {
      // Initialize SQLite first
      await this.initializeSQLite();

      // Start MongoDB update timer
      this.startMongoUpdateTimer();

      const programId = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
      console.log('🎧 Starting log-based listener for:', programId.toString());

      this.logSubscriptionId = this.connection.onLogs(
        programId,
        logs => {
          // Look for event logs
          for (const log of logs.logs) {
            if (log.includes('Program data:')) {
              this.parseEventFromLog(log);
            }
          }
        },
        'confirmed'
      );

      console.log('✅ Log listener started with ID:', this.logSubscriptionId);
    } catch (error) {
      console.error('❌ Failed to start log listener:', error);
    }
  }

  /**
   * Parse event from log
   */
  private parseEventFromLog(logLine: string) {
    try {
      // Extract base64 data from log line
      const dataMatch = logLine.match(/Program data: (.+)/);
      if (!dataMatch) return;

      const base64Data = dataMatch[1];

      // First check if this is a CreateEvent by converting to Buffer and checking discriminator
      const eventData = Buffer.from(base64Data, 'base64');

      if (eventData.length >= 8) {
        const discriminator = eventData.subarray(0, 8);

        if (discriminator.equals(CREATE_EVENT_DISCRIMINATOR)) {
          try {
            // Use the original base64 string for decoding
            const decodedEvent = this.coder.events.decode(base64Data);

            if (decodedEvent && decodedEvent.name === 'CreateEvent') {
              this.processCreateEvent(decodedEvent.data);
            }
          } catch (decodeError) {
            console.log('❌ Failed to decode event:', decodeError);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error parsing event log:', error);
    }
  }

  /**
   * Stop listening and cleanup
   */
  async stopListening() {
    console.log('🛑 Stopping event listener...');

    // Stop log subscription
    if (this.logSubscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.logSubscriptionId);
      this.logSubscriptionId = null;
      console.log('🛑 Log listener stopped');
    }

    // Stop MongoDB update timer
    if (this.mongoUpdateInterval) {
      clearInterval(this.mongoUpdateInterval);
      this.mongoUpdateInterval = null;
      console.log('⏰ MongoDB update timer stopped');
    }

    // Final flush to MongoDB
    await this.flushMongoQueue();
    console.log('💾 Final MongoDB sync completed');
  }

  /**
   * Process CreateEvent - now writes immediately to SQLite and queues for MongoDB
   */
  private async processCreateEvent(event: CreateEvent) {
    const { name, symbol, uri, mint, bonding_curve, creator } = event;

    // Convert all Solana/Anchor types to safe strings
    const safeTokenData = {
      name: this.safeStringify(name),
      symbol: this.safeStringify(symbol),
      uri: this.safeStringify(uri),
      mint: this.safeStringify(mint),
      bonding_curve: this.safeStringify(bonding_curve),
      creator: this.safeStringify(creator),
    };

    // Get metadata (only if URI is valid)
    let uriMeta = null;
    if (safeTokenData.uri && safeTokenData.uri.trim() !== '') {
      uriMeta = await this.getTokenMetadataFromUri(safeTokenData.uri);
    }

    // Create token document with safe string values
    const tokenDocument = {
      bondingCurveAddress: safeTokenData.bonding_curve,
      complete: false,
      creator: safeTokenData.creator,
      tokenAddress: safeTokenData.mint,
      name: safeTokenData.name,
      symbol: safeTokenData.symbol,
      uri: safeTokenData.uri,
      description: uriMeta?.description || '',
      image: uriMeta?.image || '',
    };

    try {
      // 1. Immediately write to SQLite for fast access
      const sqliteSuccess = await insertTokenToSQL(tokenDocument);

      if (sqliteSuccess) {
        // 2. Queue for MongoDB update
        this.mongoQueue.push(tokenDocument);
        console.log(`📝 Token queued for MongoDB (queue size: ${this.mongoQueue.length})`);

        // 3. Track new token
        this.newTokens.push(safeTokenData.mint);
      } else {
        console.error('❌ Failed to write token to SQLite');
      }
    } catch (error) {
      console.error('❌ Error processing new token:', error);
      console.error('Token data that caused error:', tokenDocument);
    }
  }

  /**
   * Get new tokens count
   */
  getNewTokensCount(): number {
    return this.newTokens.length;
  }

  /**
   * Get MongoDB queue size
   */
  getMongoQueueSize(): number {
    return this.mongoQueue.length;
  }

  /**
   * Force MongoDB sync (for testing/manual trigger)
   */
  async forceMongSync(): Promise<void> {
    await this.flushMongoQueue();
  }

  /**
   * Fetch token metadata directly from URI (much faster than waiting for Helius indexing)
   * @param {string} uri - The metadata URI from the CreateEvent
   * @param {number} maxRetries - maximum number of retry attempts
   * @returns {Promise<TokenMetadata | null>}
   */
  async getTokenMetadataFromUri(
    uri: string,
    maxRetries: number = 5
  ): Promise<TokenMetadata | null> {
    if (!uri || uri.trim() === '') {
      console.warn('⚠️ Empty URI provided');
      return null;
    }

    // Validate URI format
    try {
      new URL(uri);
    } catch {
      console.warn(`⚠️ Invalid URI format: ${uri}`);
      return null;
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(uri, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'PumpFun-Token-Fetcher/1.0',
          },
          // Add timeout to prevent hanging
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type');
        if (!contentType?.includes('application/json')) {
          console.warn(`⚠️ Unexpected content type: ${contentType}`);
          break;
        }

        const metadata = await response.json();

        // Extract the metadata fields we need
        const tokenMetadata: TokenMetadata = {
          mint: '', // This will be set by the calling function
          name: metadata.name || 'Unknown Token',
          symbol: metadata.symbol || 'UNKNOWN',
          uri: uri,
          description: metadata.description || '', // PumpFun often has empty descriptions
          image: metadata.image,
        };

        return tokenMetadata;
      } catch {
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
          console.log(`⏱️ Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    console.error(`❌ Failed to fetch metadata from URI after ${maxRetries} attempts: ${uri}`);
    return null;
  }
}

export const startCreateEventListener = async () => {
  const PUMPFUN_IDL_JSON = path.join(__dirname, '../idls/pumpfun_idl.json');
  const PUMPFUN_IDL_DATA = fs.readFileSync(PUMPFUN_IDL_JSON, 'utf8');
  const PUMPFUN_IDL = JSON.parse(PUMPFUN_IDL_DATA);

  const listener = new PumpFunEventListener(PUMPFUN_IDL);

  await listener.startListening();

  // Enhanced shutdown handling
  const shutdown = async () => {
    console.log('\n🛑 Received shutdown signal, stopping listener...');
    await listener.stopListening();
    console.log('✅ Shutdown completed successfully');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return listener;
};

// Export the listener class
export { PumpFunEventListener };

startCreateEventListener().catch(console.error);
