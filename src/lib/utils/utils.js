import { promises as fs } from "fs";
import dotenv from "dotenv";
import { getTokenStats } from "../db/connection";

dotenv.config();

async function tokenCount() {
  console.log(process.env.DATA_PATH);

  try {
    const bondingCurveData = await fs.readFile(
      `${process.env.DATA_PATH}/bonding_addresses.json`,
      "utf8"
    );
    const tokenListData = await fs.readFile(
      `${process.env.DATA_PATH}/pumpfun_token_list.json`,
      "utf8"
    );
    const bondingCurves = JSON.parse(bondingCurveData);
    const pumpfunList = JSON.parse(tokenListData);
    console.log("Total pumpfun bonding curve accounts :", bondingCurves.length);
    console.log("Total pumpfun token list :", pumpfunList.length);
  } catch (err) {
    console.error("Error:", err);
  }
}

async function getTokens() {
  const data = await getTokenStats();
  console.log(data);
}

getTokens();
