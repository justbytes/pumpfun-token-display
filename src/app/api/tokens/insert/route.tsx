// src/app/api/tokens/insert/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { addTokenToServerStorage } from '../../token-list/route';

interface TokenData {
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

export async function POST(request: NextRequest) {
  try {
    // Parse the token data from the request
    const tokenData: TokenData = await request.json();

    // Validate required fields
    if (!tokenData.tokenAddress || !tokenData.name || !tokenData.symbol) {
      return NextResponse.json(
        { error: 'Missing required fields: tokenAddress, name, symbol' },
        { status: 400 }
      );
    }

    console.log(`📝 Inserting new token: ${tokenData.name} (${tokenData.symbol})`);

    // Add token to server storage (in-memory)
    const success = addTokenToServerStorage(tokenData);

    if (success) {
      console.log(`✅ Token ${tokenData.name} successfully added to server storage`);

      return NextResponse.json({
        success: true,
        message: 'Token inserted successfully',
        token: {
          tokenAddress: tokenData.tokenAddress,
          name: tokenData.name,
          symbol: tokenData.symbol,
        },
        timestamp: new Date().toISOString(),
      });
    } else {
      console.log(`⚠️ Token ${tokenData.name} already exists, skipping duplicate`);

      return NextResponse.json({
        success: true,
        message: 'Token already exists, skipped duplicate',
        token: {
          tokenAddress: tokenData.tokenAddress,
          name: tokenData.name,
          symbol: tokenData.symbol,
        },
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('❌ Error in token insert API:', error);

    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  try {
    return NextResponse.json({
      status: 'healthy',
      database: 'in-memory server storage',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
