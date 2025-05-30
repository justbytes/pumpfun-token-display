import { promises as fs } from "fs";

async function tokenCount() {
  try {
    const bondingCurveData = await fs.readFile(
      "bonding_addresses.json",
      "utf8"
    );
    const tokenListData = await fs.readFile("pumpfun_token_list.json", "utf8");
    const bondingCurves = JSON.parse(bondingCurveData);
    const pumpfunList = JSON.parse(tokenListData);
    console.log("Total pumpfun bonding curve accounts :", bondingCurves.length);
    console.log("Total pumpfun token list :", pumpfunList.length);
  } catch (err) {
    console.error("Error:", err);
  }
}

countItemsInJson();
