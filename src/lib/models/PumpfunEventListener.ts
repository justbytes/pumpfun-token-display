import { Connection, PublicKey } from "@solana/web3.js";
import { BorshCoder } from "@coral-xyz/anchor";
const fs = require("fs");
const path = require("path");
import dotenv from "dotenv";
dotenv.config();

class PumpFunEventListener {
  private connection: Connection;
  private coder: BorshCoder;
  private logSubscriptionId: number | null = null;

  // CreateEvent discriminator from your IDL
  private CREATE_EVENT_DISCRIMINATOR = Buffer.from([
    27, 114, 169, 77, 222, 235, 99, 118,
  ]);

  constructor(rpcUrl: string, idl: any) {
    this.connection = new Connection(rpcUrl, {
      commitment: "confirmed",
      wsEndpoint: rpcUrl
        .replace("https://", "wss://")
        .replace("http://", "ws://"),
    });

    this.coder = new BorshCoder(idl);
  }

  async startListening() {
    try {
      const programId = new PublicKey(
        "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
      );
      console.log("Starting log-based listener for:", programId.toString());

      this.logSubscriptionId = this.connection.onLogs(
        programId,
        (logs, context) => {
          //   console.log("\n=== Program Log Detected ===");
          //   console.log("Signature:", logs.signature);
          //   console.log("Slot:", context.slot);

          // Look for event logs
          for (const log of logs.logs) {
            if (log.includes("Program data:")) {
              //console.log("Found program data log:", log);
              this.parseEventFromLog(log, logs.signature);
            }
          }
        },
        "confirmed"
      );

      // console.log("Log listener started with ID:", this.logSubscriptionId);
    } catch (error) {
      console.error("Failed to start log listener:", error);
    }
  }
  private parseEventFromLog(logLine: string, signature: string) {
    try {
      // Extract base64 data from log line
      const dataMatch = logLine.match(/Program data: (.+)/);
      if (!dataMatch) return;

      const base64Data = dataMatch[1];

      // First check if this is a CreateEvent by converting to Buffer and checking discriminator
      const eventData = Buffer.from(base64Data, "base64");

      if (eventData.length >= 8) {
        const discriminator = eventData.subarray(0, 8);

        if (discriminator.equals(this.CREATE_EVENT_DISCRIMINATOR)) {
          console.log("\n🎉 CreateEvent discriminator matched!");
          console.log("Signature:", signature);

          try {
            // Use the original base64 string for decoding
            const decodedEvent = this.coder.events.decode(base64Data);

            if (decodedEvent && decodedEvent.name === "CreateEvent") {
              console.log("✅ Successfully decoded CreateEvent:");
              this.processCreateEvent(decodedEvent.data);
            }
          } catch (decodeError) {
            console.log("❌ Failed to decode event:", decodeError);
            console.log("Raw event data length:", eventData.length);
            console.log("Event data (hex):", eventData.toString("hex"));
          }
        }
      }
    } catch (error) {
      console.error("Error parsing event log:", error);
    }
  }
  async stopListening() {
    if (this.logSubscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.logSubscriptionId);
      this.logSubscriptionId = null;
      console.log("Log listener stopped");
    }
  }

  private processCreateEvent(event: any) {
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
    console.log(`💰 Mint: ${mint.toString()}`);
    console.log(`📈 Bonding Curve: ${bonding_curve.toString()}`);
    console.log(`👤 User: ${user.toString()}`);
    console.log(`🎨 Creator: ${creator.toString()}`);
    console.log(`⏰ Timestamp: ${new Date(timestamp * 1000).toISOString()}`);
    console.log(`🔗 Metadata URI: ${uri}`);
    console.log(`📊 Virtual Token Reserves: ${virtual_token_reserves}`);
    console.log(`📊 Virtual SOL Reserves: ${virtual_sol_reserves}`);
    console.log(`📊 Real Token Reserves: ${real_token_reserves}`);
    console.log(`📊 Token Total Supply: ${token_total_supply}`);
  }
}

const PUMPFUN_IDL_JSON = path.join(__dirname, "../idls/pumpfun_idl.json");
const PUMPFUN_IDL_DATA = fs.readFileSync(PUMPFUN_IDL_JSON);
const PUMPFUN_IDL = JSON.parse(PUMPFUN_IDL_DATA);

const listener = new PumpFunEventListener(
  `${process.env.HELIUS_RPC_URL}`,
  PUMPFUN_IDL
);

listener.startListening();

process.on("SIGINT", async () => {
  await listener.stopListening();
  process.exit(0);
});
