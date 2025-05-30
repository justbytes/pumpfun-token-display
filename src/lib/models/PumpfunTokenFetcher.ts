import bs58 from "bs58";
import {
  address,
  createSolanaClient,
  getAddressEncoder,
  getProgramDerivedAddress,
  SolanaClient,
} from "gill";
import * as borsh from "@coral-xyz/borsh";
import { TOKEN_PROGRAM_ADDRESS } from "gill/programs/token";
import dotenv from "dotenv";
import { TokenMetadata, BondingCurveData, Token } from "../types/types";
import {
  initializeDbConnection,
  createIndexes,
  createTokenIndexes,
  getAllBondingCurveAddresses,
  insertBondingCurvesBatch,
  insertTokensBatch,
  getDatabaseStats,
  getTokenStats,
  insertBondingCurve,
  insertToken,
} from "../db/connection";

dotenv.config();

// Bonding curve schema
const bondingCurveSchema = borsh.struct([
  borsh.array(borsh.u8(), 8, "discriminator"),
  borsh.u64("virtualTokenReserves"),
  borsh.u64("virtualSolReserves"),
  borsh.u64("realTokenReserves"),
  borsh.u64("realSolReserves"),
  borsh.u64("tokenTotalSupply"),
  borsh.bool("complete"),
  borsh.publicKey("creator"),
]);

// Constant variables
const PUMPFUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const BONDING_CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];

/**
 * PumpFun Token Fetcher with MongoDB Integration
 */
class PumpFunTokenFetcher {
  // Initialize class variables
  private connection: SolanaClient<string>;
  private heliusUrl: string;
  private dbInitialized: boolean = false;

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
   * Initialize the database connection and create indexes
   */
  async initializeDatabase(): Promise<void> {
    if (this.dbInitialized) return;

    console.log("🔄 Initializing database connection...");
    const connected = await initializeDbConnection();
    if (!connected) {
      throw new Error("Failed to connect to MongoDB");
    }

    console.log("📝 Creating database indexes...");
    await Promise.all([
      createIndexes(), // Bonding curve indexes
      createTokenIndexes(), // Token indexes
    ]);

    this.dbInitialized = true;
    console.log("✅ Database initialized successfully");
  }

  /**
   * Get token mint address from bonding curve using the bonding curve ATA
   * @param {string} bondingCurveAddress - target bonding curve's we want a token mint for
   */
  async getMintFromBondingCurveATA(
    bondingCurveAddress: string
  ): Promise<string | null> {
    try {
      // Get all token accounts owned by this bonding curve should only have one
      const tokenAccounts = await this.connection.rpc
        .getTokenAccountsByOwner(
          address(bondingCurveAddress),
          {
            programId: TOKEN_PROGRAM_ADDRESS,
          },
          {
            encoding: "jsonParsed",
          }
        )
        .send();

      // Handle some cases where tokens aren't there or to many are there
      if (tokenAccounts.value.length === 0) {
        throw new Error("This bonding curve has no spl tokens!");
      } else if (tokenAccounts.value.length > 1) {
        throw new Error("This bonding curve has more then one spl token!");
      }

      // Returns the mint
      return tokenAccounts.value[0].account.data.parsed.info.mint;
    } catch (error) {
      // Type guard for error handling
      if (error && typeof error === "object" && "context" in error) {
        const contextError = error as { context?: { statusCode?: number } };

        // Handle retry
        if (contextError.context?.statusCode === 429) {
          console.log(
            "Rate limit hit on getMintFromBondingCurveATA() function. Waiting 1 second"
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return await this.getMintFromBondingCurveATA(bondingCurveAddress);
        }
      }

      // Handle error message safely
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.warn(
        "There was an error getting mint from bonding curve ata",
        errorMessage
      );
      return null;
    }
  }

  /**
   * Uses the bonding curve address to getAccountInfo which then uses the borsh struct to decode
   * @param {string} bondingCurveAddress - target bonding curve
   * @returns
   */
  async getBondingCurveData(
    bondingCurveAddress: string
  ): Promise<BondingCurveData | null> {
    try {
      // Get bonding curve account data
      const bondingCurveAccountInfo = await this.connection.rpc
        .getAccountInfo(address(bondingCurveAddress), {
          encoding: "base64",
        })
        .send();

      // return if theres nothing
      if (!bondingCurveAccountInfo.value) {
        console.log(
          "the bonding curve account info was false\n",
          bondingCurveAccountInfo
        );
        return null;
      }

      // Convert the data buffer
      const base64Data = bondingCurveAccountInfo.value.data[0];
      const dataBuffer = Buffer.from(base64Data, "base64");

      // Decode the bonding curve account data using your schema
      return bondingCurveSchema.decode(dataBuffer);
    } catch (error) {
      // Type guard for error handling
      if (error && typeof error === "object" && "context" in error) {
        const contextError = error as { context?: { statusCode?: number } };

        // Handle retry
        if (contextError.context?.statusCode === 429) {
          console.log(
            "Rate limit hit on getBondingCurveData() function. Waiting 1 second"
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return await this.getBondingCurveData(bondingCurveAddress);
        }
      }

      // Handle error message safely
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.warn(
        "There was an error getting mint from getBondingCurveData()",
        errorMessage
      );
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
      jsonrpc: "2.0",
      id: "get-asset",
      method: "getAsset",
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      // get the data
      const data = await response.json();

      // If something went wrong
      if (data.error) {
        console.log("ERROR FROM getTokenMetadata data response\n", data.error);

        // Handle retry
        if (data.error.context?.statusCode == 429) {
          console.log(
            "Rate limit hit on getTokenMetadata() call. Waiting 1 second"
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return await this.getTokenMetadata(tokenAddress);
        }

        console.warn(
          `⚠️  Could not get metadata for ${tokenAddress}: ${data.error.message}`
        );
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
      if (error && typeof error === "object" && "context" in error) {
        const contextError = error as { context?: { statusCode?: number } };

        // Handle retry
        if (contextError.context?.statusCode === 429) {
          console.log(
            "Rate limit hit on getTokenMetadata() function. Waiting 1 second"
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return await this.getTokenMetadata(tokenAddress);
        }
      }

      // Handle error message safely
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.warn(
        "There was an error getting mint from getTokenMetadata()",
        errorMessage
      );
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
        seeds: ["bonding-curve", getAddressEncoder().encode(mint)],
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
  async getDataWithBondingCurveAddress(
    bondingCurveAddress: string
  ): Promise<Token | null> {
    try {
      // Get the bonding curve data
      const bondingCurveData = await this.getBondingCurveData(
        bondingCurveAddress
      );

      if (!bondingCurveData) {
        console.warn(
          `Could not get bonding curve data for ${bondingCurveAddress}`
        );
        return null;
      }

      // Get the token address using the bonding curve address
      const tokenAddress = await this.getMintFromBondingCurveATA(
        bondingCurveAddress
      );

      if (!tokenAddress) {
        console.warn(`Could not get token address for ${bondingCurveAddress}`);
        return null;
      }

      // Get the token data with the token address
      const tokenData = await this.getTokenMetadata(tokenAddress);

      if (!tokenData) {
        console.warn(`Could not get token data for ${tokenAddress}`);
        return null;
      }

      return {
        bondingCurveAddress,
        tokenAddress,
        bondingCurveData,
        tokenData,
      };
    } catch (error) {
      console.error(
        `❌ Error processing bonding curve ${bondingCurveAddress}:`,
        error
      );
      return null;
    }
  }

  /**
   * Uses the helius getProgramAccounts endpoint and filters by the bonding curve discriminator
   * which will return all of the bonding curve accounts
   */
  async getAllBondingCurves() {
    if (!this.heliusUrl) {
      throw new Error("Helius API key required for getProgramAccounts");
    }

    // Request body
    const requestBody = {
      jsonrpc: "2.0",
      id: "get-bonding-curves",
      method: "getProgramAccounts",
      params: [
        PUMPFUN_PROGRAM_ID,
        {
          encoding: "base64",
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      console.warn(
        "There was an error with the Helius getProgramAccounts call",
        error
      );
      return null;
    }
  }

  /**
   * Store all bonding curve addresses to the database
   */
  async collectAndStoreBondingCurves(): Promise<void> {
    await this.initializeDatabase();

    console.log("🔄 Fetching all bonding curves from Helius...");
    const allBondingCurves = await this.getAllBondingCurves();

    if (!allBondingCurves) {
      throw new Error("Failed to fetch bonding curves from Helius");
    }

    // Extract addresses
    const bondingAddresses = allBondingCurves.map(
      (bonding: { pubkey: string }) => bonding.pubkey
    );

    console.log(`📊 Found ${bondingAddresses.length} bonding curve addresses`);

    // Store in database using batch insert
    const result = await insertBondingCurvesBatch(bondingAddresses);

    console.log("✅ Bonding curves stored in database:");
    console.log(`   Inserted: ${result.inserted}`);
    console.log(`   Duplicates: ${result.duplicates}`);
    console.log(`   Errors: ${result.errors}`);
  }

  /**
   * Update token list using database instead of file system
   * This processes only new bonding curves that haven't been processed yet
   */
  async updateTokenList(): Promise<void> {
    await this.initializeDatabase();

    console.log("🔄 Starting incremental update process...");

    // Get all current bonding curves from Helius
    const allCurrentBondingCurves = await this.getAllBondingCurves();
    if (!allCurrentBondingCurves) {
      throw new Error("Failed to fetch current bonding curves");
    }

    console.log(
      `📊 Found ${allCurrentBondingCurves.length} total bonding curves on-chain`
    );

    // Extract just the addresses from the current bonding curves
    const currentAddresses = allCurrentBondingCurves.map(
      (bonding: { pubkey: string }) => bonding.pubkey
    );

    // Get existing addresses from database
    const existingAddresses = await getAllBondingCurveAddresses();
    console.log(
      `📋 Found ${existingAddresses.length} previously processed addresses in database`
    );

    // Find new addresses that haven't been processed yet
    const newAddresses = currentAddresses.filter(
      (address: string) => !existingAddresses.includes(address)
    );

    console.log(
      `🆕 Found ${newAddresses.length} new bonding curves to process`
    );

    if (newAddresses.length === 0) {
      console.log("✅ No new bonding curves to process!");
      return;
    }

    // First, store all the new bonding curve addresses
    console.log("📝 Storing new bonding curve addresses...");
    const bondingCurveResult = await insertBondingCurvesBatch(newAddresses);
    console.log(
      `   Inserted: ${bondingCurveResult.inserted} bonding curve addresses`
    );

    // Process tokens in batches
    const BATCH_SIZE = 100;
    let processedCount = 0;
    let tokenBatch: Token[] = [];

    console.log(
      `🚀 Starting to process ${newAddresses.length} new bonding curves...`
    );

    for (let i = 0; i < newAddresses.length; i++) {
      try {
        console.log(
          `Processing ${i + 1}/${newAddresses.length} - Address: ${
            newAddresses[i]
          }`
        );

        const tokenData = await this.getDataWithBondingCurveAddress(
          newAddresses[i]
        );
        if (tokenData) {
          tokenBatch.push(tokenData);
          processedCount++;
        }

        // Process batch when it reaches BATCH_SIZE or at the end
        if (tokenBatch.length >= BATCH_SIZE || i === newAddresses.length - 1) {
          if (tokenBatch.length > 0) {
            console.log(
              `💾 Storing batch of ${tokenBatch.length} tokens to database...`
            );
            const result = await insertTokensBatch(tokenBatch);
            console.log(
              `   Inserted: ${result.inserted}, Duplicates: ${result.duplicates}, Errors: ${result.errors}`
            );
            tokenBatch = []; // Clear the batch for next round
          }

          console.log(
            `📊 Progress: ${processedCount}/${newAddresses.length} new tokens processed`
          );
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

    // Show updated database stats
    await this.showDatabaseStats();
  }

  /**
   * Process a specific list of bonding curve addresses and store tokens to database
   * @param addresses - Array of bonding curve addresses to process
   */
  async processBondingCurvesToDatabase(addresses: string[]): Promise<void> {
    await this.initializeDatabase();

    const BATCH_SIZE = 100;
    let tokenBatch: Token[] = [];
    let processedCount = 0;

    console.log(`🚀 Starting to process ${addresses.length} bonding curves...`);

    for (let i = 0; i < addresses.length; i++) {
      try {
        console.log(
          `Processing ${i + 1}/${addresses.length} - Address: ${addresses[i]}`
        );

        const tokenData = await this.getDataWithBondingCurveAddress(
          addresses[i]
        );
        if (tokenData) {
          tokenBatch.push(tokenData);
          processedCount++;
        }

        // Process batch when it reaches BATCH_SIZE or at the end
        if (tokenBatch.length >= BATCH_SIZE || i === addresses.length - 1) {
          if (tokenBatch.length > 0) {
            console.log(
              `💾 Storing batch of ${tokenBatch.length} tokens to database...`
            );
            const result = await insertTokensBatch(tokenBatch);
            console.log(
              `   Inserted: ${result.inserted}, Duplicates: ${result.duplicates}, Errors: ${result.errors}`
            );
            tokenBatch = []; // Clear the batch for next round
          }

          console.log(
            `📊 Progress: ${processedCount}/${addresses.length} tokens processed`
          );
        }
      } catch (error) {
        console.error(
          `❌ Error processing bonding curve at index ${i} (${addresses[i]}):`,
          error
        );
        // Continue processing even if one fails
      }
    }

    console.log(
      `✅ Completed processing! Successfully processed ${processedCount} tokens!`
    );
  }

  /**
   * Display current database statistics
   */
  async showDatabaseStats(): Promise<void> {
    console.log("\n📊 Database Statistics:");

    const [bondingCurveStats, tokenStats] = await Promise.all([
      getDatabaseStats(),
      getTokenStats(),
    ]);

    console.log(`   Bonding curve addresses: ${bondingCurveStats || 0}`);
    console.log(`   Total tokens: ${tokenStats?.totalTokens || 0}`);
    console.log(
      `   Completed bonding curves: ${tokenStats?.completedBondingCurves || 0}`
    );
    console.log(
      `   Active bonding curves: ${tokenStats?.activeBondingCurves || 0}`
    );
  }

  /**
   * Add a single bonding curve and its token data to the database
   * @param bondingCurveAddress - The bonding curve address to add
   */
  async addSingleToken(bondingCurveAddress: string): Promise<boolean> {
    await this.initializeDatabase();

    try {
      // Add the bonding curve address
      await insertBondingCurve(bondingCurveAddress);

      // Get and store the token data
      const tokenData = await this.getDataWithBondingCurveAddress(
        bondingCurveAddress
      );
      if (tokenData) {
        const success = await insertToken(tokenData);
        if (success) {
          console.log(
            `✅ Successfully added token for bonding curve: ${bondingCurveAddress}`
          );
          return true;
        }
      }

      console.log(
        `❌ Failed to add token for bonding curve: ${bondingCurveAddress}`
      );
      return false;
    } catch (error) {
      console.error(`❌ Error adding single token: ${error}`);
      return false;
    }
  }
}

// Updated main function that uses database instead of files
async function main() {
  // Initialize connection
  const connection: SolanaClient<string> = createSolanaClient({
    urlOrMoniker: `${process.env.HELIUS_RPC_URL}`,
  });

  // Create an instance of the pumpfun token fetcher class
  const fetcher = new PumpFunTokenFetcher(
    connection,
    `${process.env.HELIUS_KEY}`
  );

  try {
    // Update the db with the new tokens created
    await fetcher.updateTokenList();

    // Option 2: If you want to collect all bonding curves first (one-time setup)
    // await fetcher.collectAndStoreBondingCurves();

    // Option 3: Process specific addresses from an array
    // const specificAddresses = ["address1", "address2", "address3"];
    // await fetcher.processBondingCurvesToDatabase(specificAddresses);

    // Option 4: Add a single token
    // await fetcher.addSingleToken("specific_bonding_curve_address");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error in main process:", error);
    process.exit(1);
  }
}

main();

export { PumpFunTokenFetcher, bondingCurveSchema };
