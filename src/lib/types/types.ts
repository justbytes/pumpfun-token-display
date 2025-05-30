export type TokenMetadata = {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  description: string;
  image: string;
};

export type BondingCurveData = {
  discriminator: Uint8Array;
  virtualTokenReserves: string;
  virtualSolReserves: string;
  realTokenReserves: string;
  realSolReserves: string;
  tokenTotalSupply: string;
  complete: boolean;
  creator: string;
};

export type Token = {
  bondingCurveAddress: string;
  tokenAddress: string;
  bondingCurveData: BondingCurveData;
  tokenData: TokenMetadata;
};
