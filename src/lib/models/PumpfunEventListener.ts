// src/lib/models/PumpfunEventListener.ts

import { Connection, PublicKey } from '@solana/web3.js';
import { BorshCoder } from '@coral-xyz/anchor';
const fs = require('fs');
const path = require('path');
import dotenv from 'dotenv';
import { bondingCurveSchema } from './PumpfunTokenFetcher';
import { Token, TokenMetadata } from '../types/types';
import { insertToken } from '../db/mongoDB';
import { insertTokenToSQLite, initializeSQLiteDB } from '../db/sql';

dotenv.config();

// CreateEvent discriminator from your IDL
const CREATE_EVENT_DISCRIMINATOR = Buffer.from([27, 114, 169, 77, 222, 235, 99, 118]);

class PumpFunEventListener {
  private connection: Connection;
  private coder: BorshCoder;
  private logSubscriptionId: number | null = null;
  private newTokens: string[] = [];
  private sqliteInitialized: boolean = false;
  private mongoQueue: any[] = []; // Queue for MongoDB updates
  private mongoUpdateInterval: NodeJS.Timeout | null = null;

  /**
   * Constructor
   */
  constructor(idl: any) {
    // Create the connection
    this.connection = new Connection(`${process.env.HELIUS_API_URL}`, {
      commitment: 'confirmed',
    });
    // Decode the pumpfun idl
    this.coder = new BorshCoder(idl);

    // list for new tokens if its needed
    this.newTokens = [];
    this.mongoQueue = [];
  }

  /**
   * Initialize SQLite database
   */
  private async initializeSQLite(): Promise<void> {
    if (this.sqliteInitialized) return;

    const initialized = await initializeSQLiteDB();
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
      console.log('📊 MongoDB queue is empty, nothing to sync');
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
        (logs, context) => {
          // Look for event logs
          for (const log of logs.logs) {
            if (log.includes('Program data:')) {
              this.parseEventFromLog(log, logs.signature);
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
  private parseEventFromLog(logLine: string, signature: string) {
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
          console.log('\n🎉 CreateEvent discriminator matched!');
          console.log('📝 Signature:', signature);

          try {
            // Use the original base64 string for decoding
            const decodedEvent = this.coder.events.decode(base64Data);

            if (decodedEvent && decodedEvent.name === 'CreateEvent') {
              console.log('✅ Successfully decoded CreateEvent');
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
  private async processCreateEvent(event: any) {
    const {
      name,
      symbol,
      uri,
      mint,
      bonding_curve,
      user,
      creator,
      timestamp,
      virtual_token_reserves,
      virtual_sol_reserves,
      real_token_reserves,
      token_total_supply,
    } = event;

    console.log(`\n🚀 New token created: ${name} (${symbol})`);

    const uriMeta = await this.getTokenMetadataFromUri(uri);

    if (!uriMeta) {
      console.log("❌ Couldn't get metadata from the new token uri!");
      return;
    }

    const tokenDocument = {
      bondingCurveAddress: bonding_curve,
      complete: false,
      creator,
      tokenAddress: mint,
      name,
      symbol,
      uri,
      description: uriMeta.description,
      image: uriMeta.image,
    };

    try {
      // 1. Immediately write to SQLite for fast access
      console.log('💾 Writing token to SQLite...');
      const sqliteSuccess = await insertTokenToSQLite(tokenDocument);

      if (sqliteSuccess) {
        console.log('✅ Token successfully written to SQLite');

        // 2. Queue for MongoDB update
        this.mongoQueue.push(tokenDocument);
        console.log(`📝 Token queued for MongoDB (queue size: ${this.mongoQueue.length})`);

        // 3. Track new token
        this.newTokens.push(mint);
      } else {
        console.error('❌ Failed to write token to SQLite');
      }
    } catch (error) {
      console.error('❌ Error processing new token:', error);
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
          image: this.extractImageUrl(metadata),
        };

        return tokenMetadata;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`❌ Attempt ${attempt + 1} failed for URI ${uri}: ${errorMessage}`);

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

  /**
   * Extract image URL from metadata JSON, handling PumpFun format
   * @param {any} metadata - The parsed metadata JSON
   * @returns {string} - The image URL or empty string
   */
  private extractImageUrl(metadata: any): string {
    // PumpFun uses a simple 'image' field directly
    if (metadata.image && typeof metadata.image === 'string') {
      return metadata.image;
    }

    // Fallback: check other common image field names
    const imageFields = ['image_uri', 'logo', 'logoURI', 'icon'];

    for (const field of imageFields) {
      if (metadata[field] && typeof metadata[field] === 'string') {
        return metadata[field];
      }
    }

    // Check in nested properties object (some tokens store extra data here)
    if (metadata.properties) {
      for (const field of ['image', ...imageFields]) {
        if (metadata.properties[field] && typeof metadata.properties[field] === 'string') {
          return metadata.properties[field];
        }
      }
    }

    // Check in files array (common for NFT-style metadata)
    if (metadata.files && Array.isArray(metadata.files) && metadata.files.length > 0) {
      const firstFile = metadata.files[0];
      if (firstFile.uri || firstFile.url) {
        return firstFile.uri || firstFile.url;
      }
    }

    console.log('⚠️ No image URL found in metadata');
    return '';
  }
}

export const startCreateEventListener = async () => {
  const PUMPFUN_IDL_JSON = path.join(__dirname, '../idls/pumpfun_idl.json');
  const PUMPFUN_IDL_DATA = fs.readFileSync(PUMPFUN_IDL_JSON);
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

// Auto-start if this file is run directly
if (require.main === module) {
  startCreateEventListener().catch(console.error);
}
