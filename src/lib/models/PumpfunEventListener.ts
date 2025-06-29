// src/lib/models/PumpfunEventListener.ts
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Connection, PublicKey } from '@solana/web3.js';
import { BorshCoder, Idl } from '@coral-xyz/anchor';
import { TokenMetadata } from '../types/types';
import { insertTokenToDB } from '../db/queries';

dotenv.config();

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

export class PumpFunEventListener {
  private connection: Connection;
  private coder: BorshCoder;
  private logSubscriptionId: number | null = null;
  private newTokens: string[] = [];

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
   * Starts the listener
   */
  async startListening() {
    try {
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
  }

  /**
   * Process CreateEvent - writes immediately to DB
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
      const postgreSuccess = await insertTokenToDB(tokenDocument);

      if (postgreSuccess) {
        // 2. Track new token
        this.newTokens.push(safeTokenData.mint);
      } else {
        console.error('❌ Failed to write token to DB');
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
          // console.log(`⏱️ Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    //console.error(`❌ Failed to fetch metadata from URI after ${maxRetries} attempts: ${uri}`);
    return null;
  }
}

/**
 * Starts the event listener
 */
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

startCreateEventListener().catch(console.error);
