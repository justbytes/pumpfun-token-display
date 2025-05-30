import bs58 from 'bs58';
import {
  address,
  createSolanaClient,
  getAddressEncoder,
  getProgramDerivedAddress,
  SolanaClient,
} from 'gill';
import * as borsh from '@coral-xyz/borsh';
import { TOKEN_PROGRAM_ADDRESS } from 'gill/programs/token';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import { TokenMetadata, BondingCurveData, Token } from '../types/types';

dotenv.config();

// Bonding curve schema
const bondingCurveSchema = borsh.struct([
  borsh.array(borsh.u8(), 8, 'discriminator'),
  borsh.u64('virtualTokenReserves'),
  borsh.u64('virtualSolReserves'),
  borsh.u64('realTokenReserves'),
  borsh.u64('realSolReserves'),
  borsh.u64('tokenTotalSupply'),
  borsh.bool('complete'),
  borsh.publicKey('creator'),
]);

// Constant variables
const PUMPFUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const BONDING_CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];

/**
 *
 */
class PumpFunTokenFetcher {
  // Initialize class variables
  private connection: SolanaClient<string>;
  private heliusUrl: string;

  /**
   * PumpfunTokenFetcher constructor setting the initial class variables
   * @param {SolanaClient<string>} connection - the gill connection
   * @param {string} heliusApiKey - api key
   */
  constructor(connection: SolanaClient<string>, heliusApiKey: string) {
    this.connection = connection;
    this.heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
  }

  /**
   * Get token mint address from bonding curve using the bonding curve ATA
   * @param {string} bondingCurveAddress - target bonding curve's we want a token mint for
   */
  async getMintFromBondingCurveATA(bondingCurveAddress: string): Promise<string | null> {
    try {
      // Get all token accounts owned by this bonding curve should only have one
      const tokenAccounts = await this.connection.rpc
        .getTokenAccountsByOwner(
          address(bondingCurveAddress),
          {
            programId: TOKEN_PROGRAM_ADDRESS,
          },
          {
            encoding: 'jsonParsed',
          }
        )
        .send();

      // Handle some cases where tokens aren't there or to many are there
      if (tokenAccounts.value.length === 0) {
        throw new Error('This bonding curve has more then one spl token!');
      } else if (tokenAccounts.value.length > 1) {
        throw new Error('This bonding curve has more then one spl token!');
      }

      // Returns the mint
      return tokenAccounts.value[0].account.data.parsed.info.mint;
    } catch (error) {
      // Type guard for error handling
      if (error && typeof error === 'object' && 'context' in error) {
        const contextError = error as { context?: { statusCode?: number } };

        // Handle retry
        if (contextError.context?.statusCode === 429) {
          console.log('Rate limit hit on getMintFromBondingCurveATA() function. Waiting 1 second');

          await new Promise(resolve => setTimeout(resolve, 1000));
          return await this.getMintFromBondingCurveATA(bondingCurveAddress);
        }
      }

      // Handle error message safely
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('There was an error getting mint from bonding curve ata', errorMessage);
      return null;
    }
  }

  /**
   * Uses the bonding curve address to getAccountInfo which then uses the borsh struct to decode
   * @param {string} bondingCurveAddress - target bonding curve
   * @returns
   */
  async getBondingCurveData(bondingCurveAddress: string): Promise<BondingCurveData | null> {
    try {
      // Get bonding curve account data
      const bondingCurveAccountInfo = await this.connection.rpc
        .getAccountInfo(address(bondingCurveAddress), {
          encoding: 'base64',
        })
        .send();

      // return if theres nothing
      if (!bondingCurveAccountInfo.value) {
        console.log('the bonding curve account info was false\n', bondingCurveAccountInfo);
        return null;
      }

      // Convert the data buffer
      const base64Data = bondingCurveAccountInfo.value.data[0];
      const dataBuffer = Buffer.from(base64Data, 'base64');

      // Decode the bonding curve account data using your schema
      return bondingCurveSchema.decode(dataBuffer);
    } catch (error) {
      // Type guard for error handling
      if (error && typeof error === 'object' && 'context' in error) {
        const contextError = error as { context?: { statusCode?: number } };

        // Handle retry
        if (contextError.context?.statusCode === 429) {
          console.log('Rate limit hit on getBondingCurveData() function. Waiting 1 second');

          await new Promise(resolve => setTimeout(resolve, 1000));
          return await this.getBondingCurveData(bondingCurveAddress);
        }
      }

      // Handle error message safely
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('There was an error getting mint from getBondingCurveData()', errorMessage);
      return null;
    }
  }

  /**
   * Get token metadata using Helius getAsset endpoint
   * @param {string} tokenAddress - address we want to get metadata for
   * @returns
   */
  async getTokenMetadata(tokenAddress: string): Promise<TokenMetadata | null> {
    if (!this.heliusUrl) {
      return null;
    }

    // Request headers setting all the options to false since they relate more to nfts
    const requestBody = {
      jsonrpc: '2.0',
      id: 'get-asset',
      method: 'getAsset',
      params: {
        id: tokenAddress.toString(),
        options: {
          showInscription: false,
          showFungible: false,
          showCollectionMetadata: false,
          showUnverifiedCollections: false,
        },
      },
    };

    try {
      // Send the request
      const response = await fetch(this.heliusUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      // get the data
      const data = await response.json();

      // If something went wrong
      if (data.error) {
        console.log('ERROR FROM getTokenMetadata data response\n', data.error);

        // Handle retry
        if (data.error.context.statusCode == 429) {
          console.log('Rate limit hit on getTokenMetadata() call. Waiting 1 second');

          await new Promise(resolve => setTimeout(resolve, 1000));
          return await this.getTokenMetadata(tokenAddress);
        }

        console.warn(`⚠️  Could not get metadata for ${tokenAddress}: ${data.error.message}`);
        return null;
      }

      // Parse the result
      const asset = data.result;
      return {
        mint: tokenAddress,
        name: asset.content?.metadata?.name,
        symbol: asset.content?.metadata?.symbol,
        uri: asset.content?.json_uri,
        description: asset.content?.metadata?.description,
        image: asset.content?.files?.[0]?.uri,
      };
    } catch (error) {
      // Type guard for error handling
      if (error && typeof error === 'object' && 'context' in error) {
        const contextError = error as { context?: { statusCode?: number } };

        // Handle retry
        if (contextError.context?.statusCode === 429) {
          console.log('Rate limit hit on getTokenMetadata() function. Waiting 1 second');

          await new Promise(resolve => setTimeout(resolve, 1000));
          return await this.getTokenMetadata(tokenAddress);
        }
      }

      // Handle error message safely
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn('There was an error getting mint from getTokenMetadata()', errorMessage);
      return null;
    }
  }

  /**
   * Get the token data using a token address
   * @param {string} tokenAddress - address we want to get metadata for
   * @returns
   */
  async getDataWithTokenAddress(tokenAddress: string) {
    console.log(`🔍 Getting token data for mint: ${tokenAddress}`);

    try {
      const mint = address(tokenAddress);

      // Use your existing pattern to get bonding curve
      const [bondingCurve, _bondingBump] = await getProgramDerivedAddress({
        seeds: ['bonding-curve', getAddressEncoder().encode(mint)],
        programAddress: address(PUMPFUN_PROGRAM_ID),
      });

      // Get bonding curve data using your existing function
      const bondingCurveData = await this.getBondingCurveData(bondingCurve);

      // Get metadata
      const metadata = await this.getTokenMetadata(mint);

      return {
        tokenAddress,
        bondingCurveAddress: bondingCurve.toString(),
        bondingCurveData,
        tokenData: metadata,
      };
    } catch (error) {
      console.error(`❌ Error getting token ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Gets the token data using a bonding curve address
   * @param {string} bondingCurveAddress - target bonding curve
   */
  async getDataWithBondingCurveAddress(bondingCurveAddress: string): Promise<Token> {
    // Get the bonding curve data
    const bondingCurveData = await this.getBondingCurveData(bondingCurveAddress);

    if (!bondingCurveData) {
      throw new Error(
        `There was a problem getting the bonding curve data for ${bondingCurveAddress}`
      );
    }

    // Get the token address using the bonding cruve address
    const tokenAddress = await this.getMintFromBondingCurveATA(bondingCurveAddress);

    if (!tokenAddress) {
      throw new Error(`There was a problem getting the token address for ${bondingCurveAddress}`);
    }

    // Get the token data with the token address
    const tokenData = await this.getTokenMetadata(tokenAddress);

    if (!tokenData) {
      throw new Error(`There was a problem getting the token data for ${tokenAddress}`);
    }

    return {
      bondingCurveAddress,
      tokenAddress,
      bondingCurveData,
      tokenData,
    };
  }

  /**
   * Uses the helius getProgramAccounts endpoint and filters by the bonding curve discriminator
   * which will return all of the bonding curve accounts
   */
  async getAllBondingCurves() {
    if (!this.heliusUrl) {
      throw new Error('Helius API key required for getProgramAccounts');
    }

    // Request body
    const requestBody = {
      jsonrpc: '2.0',
      id: 'get-bonding-curves',
      method: 'getProgramAccounts',
      params: [
        PUMPFUN_PROGRAM_ID,
        {
          encoding: 'base64',
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: bs58.encode(Buffer.from(BONDING_CURVE_DISCRIMINATOR)),
              },
            },
            {
              dataSize: 81, // Size of the bonding curve account
            },
          ],
          dataSlice: {
            offset: 0,
            length: 0, // Just get first 50 bytes to test
          },
        },
      ],
    };

    try {
      // Make the call to the helius endpoint
      const response = await fetch(this.heliusUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      // get the response data
      const data = await response.json();

      if (data.error) {
        console.log(data);

        return null;
      }

      return data.result;
    } catch (error) {
      console.warn('There was an error with the Helius getProgramAccounts call', error);
      return null;
    }
  }

  /**
   * Function that gets all of the bonding curves and writes them to file
   */
  async collectBondingCurves() {
    const allBondingAddress = await this.getAllBondingCurves();
    const bondingAddressList: any = [];

    allBondingAddress.forEach((bonding: { pubkey: string }) => {
      bondingAddressList.push(bonding.pubkey);
    });

    fs.writeFile('bonding.json', JSON.stringify(bondingAddressList, null, 2), 'utf-8');

    console.log('Data has been collected', bondingAddressList.length);
  }

  /**
   * This first gets all of the the bonding curve tokens from the pumpfun program id then it reads the current bonding curve list
   * after that we use that to get the new bonding curve tokens then process them and add them to the pumpfun_token_list.json file
   *
   * NOTE: The getAllBondingCurves() can fail so try running this a few times because eventually it will catch and get the bonding curves and process them
   * @returns
   */
  async updateTokenList() {
    // Process only the new bonding curves
    const CACHE_INTERVAL = 1000;
    const CACHE_FILE = 'pumpfun_token_list.json';

    console.log('🔄 Starting incremental update process...');

    // Get all current bonding curves from Helius
    const allCurrentBondingCurves = await this.getAllBondingCurves();
    if (!allCurrentBondingCurves) {
      throw new Error('Failed to fetch current bonding curves');
    }

    console.log(`📊 Found ${allCurrentBondingCurves.length} total bonding curves on-chain`);

    // Extract just the addresses from the current bonding curves
    const currentAddresses = allCurrentBondingCurves.map(
      (bonding: { pubkey: string }) => bonding.pubkey
    );

    // Read the existing processed bonding curves (if file exists)
    let existingAddresses: string[] = [];
    try {
      const existingFile = await fs.readFile('bonding_addresses.json', 'utf8');
      existingAddresses = JSON.parse(existingFile);
      console.log(`📋 Found ${existingAddresses.length} previously processed addresses`);
    } catch (error) {
      console.log('📋 No existing bonding_addresses.json file found, processing all addresses');
    }

    // Find new addresses that haven't been processed yet
    const newAddresses = currentAddresses.filter(
      (address: string) => !existingAddresses.includes(address)
    );

    console.log(`🆕 Found ${newAddresses.length} new bonding curves to process`);

    if (newAddresses.length === 0) {
      console.log('✅ No new bonding curves to process!');
      return;
    }

    // Update the bonding_addresses.json file with all addresses (existing + new)
    await fs.writeFile(
      'bonding_addresses.json',
      JSON.stringify(currentAddresses, null, 2),
      'utf-8'
    );

    console.log(
      `📝 Updated bonding_addresses.json with ${currentAddresses.length} total addresses`
    );

    let tokenBatch: any = [];
    let processedCount = 0;

    console.log(`🚀 Starting to process ${newAddresses.length} new bonding curves...`);

    for (let i = 0; i < newAddresses.length; i++) {
      try {
        console.log(`Processing ${i + 1}/${newAddresses.length} - Address: ${newAddresses[i]}`);

        const tokenData = await this.getDataWithBondingCurveAddress(newAddresses[i]);
        if (tokenData) {
          tokenBatch.push(tokenData);
          processedCount++;
        }

        // Cache every 1000 items or at the end
        if (tokenBatch.length >= CACHE_INTERVAL || i === newAddresses.length - 1) {
          if (tokenBatch.length > 0) {
            console.log(`🔄 Caching batch of ${tokenBatch.length} tokens...`);
            await this.appendToCache(tokenBatch, CACHE_FILE);
            tokenBatch = []; // Clear the batch for next round
          }

          console.log(`📊 Progress: ${processedCount}/${newAddresses.length} new tokens processed`);
        }
      } catch (error) {
        console.error(
          `❌ Error processing bonding curve at index ${i} (${newAddresses[i]}):`,
          error
        );
        // Continue processing even if one fails
      }
    }

    console.log(
      `✅ Completed incremental update! Processed ${processedCount} new tokens out of ${newAddresses.length} new bonding curves.`
    );
  }

  /**
   * Takes a list of bonding curve address and process each one writing it the
   * correct file once finished
   * @param data
   * @param CACHE_INTERVAL
   * @param CACHE_FILE
   */
  async processBondingCurves(data: string[], CACHE_INTERVAL: number, CACHE_FILE: string) {
    let tokenBatch: any = [];
    let processedCount = 0;

    console.log(`Starting to process ${data.length} public keys...`);

    for (let i = 0; i < data.length; i++) {
      try {
        console.log(`Processing ${i + 1}/${data.length} - COUNT: ${i}`);

        const tokenData = await this.getDataWithBondingCurveAddress(data[i]);
        tokenBatch.push(tokenData);
        processedCount++;

        // Cache every 1000 items or at the end
        if (tokenBatch.length >= CACHE_INTERVAL || i === data.length - 1) {
          console.log(`🔄 Caching batch of ${tokenBatch.length} tokens...`);
          await this.appendToCache(tokenBatch, CACHE_FILE);

          // Clear the batch for next round
          tokenBatch = [];

          console.log(`📊 Progress: ${processedCount}/${data.length} tokens processed`);
        }
      } catch (error) {
        console.error(`Error processing token at index ${i}:`, error);
        // Continue processing even if one fails
      }
    }

    console.log(`✅ Completed processing all ${processedCount} tokens!`);
  }

  // Helper function to append data to the cache file
  async appendToCache(tokens: any[], CACHE_FILE: string) {
    try {
      let existingData = [];

      // Try to read existing file
      try {
        const existingFile = await fs.readFile(CACHE_FILE, 'utf8');
        existingData = JSON.parse(existingFile);
      } catch (error) {
        // File doesn't exist or is empty, start with empty array
        console.log("Cache file doesn't exist or is empty, creating new one");
      }

      // Append new tokens to existing data
      const updatedData = [...existingData, ...tokens];

      // Write back to file
      await fs.writeFile(CACHE_FILE, JSON.stringify(updatedData, null, 2), 'utf-8');

      console.log(`✅ Cached ${tokens.length} tokens. Total cached: ${updatedData.length}`);
    } catch (error) {
      console.error('Error caching data:', error);
    }
  }
}

// This can be used to get all of the bonding curves, process each one to get the token data and then rights them
// to file. This can take a long time and is resource intensive
async function main() {
  const CACHE_INTERVAL = 1000;
  const CACHE_FILE = 'pumpfun_token_list.json';

  // Initialize connection (you would use your existing connection)
  const connection: SolanaClient<string> = createSolanaClient({
    urlOrMoniker: `${process.env.HELIUS_RPC_URL}`,
  });

  // Create an instance of the pumpfun token fetcher class
  const fetcher = new PumpFunTokenFetcher(connection, `${process.env.HELIUS_KEY}`);

  // const dataFile = await fs.readFile("bonding_addresses.json", "utf8");
  // const data = JSON.parse(dataFile);

  fetcher.updateTokenList();
}

export { PumpFunTokenFetcher, bondingCurveSchema };

main();
