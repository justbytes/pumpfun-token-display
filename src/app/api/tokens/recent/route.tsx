import { NextRequest, NextResponse } from 'next/server';
import {
  getRecentTokensFromSQL,
  getTokensAfterFromSQL,
  getTokenStatsFromSQL,
  initializeSQLDB,
} from '../../../../lib/db/sql';

// Cache the initialization status to avoid repeated connections
let isInitialized = false;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50;
    const includeStats = searchParams.get('stats') === 'true';

    // Initialize DB once
    if (!isInitialized) {
      const sqliteInitialized = await initializeSQLDB();
      if (!sqliteInitialized) {
        return NextResponse.json(
          { error: 'Failed to initialize SQLite database' },
          { status: 500 }
        );
      }
      isInitialized = true;
    }

    // Just get the most recent tokens, forget timestamps
    const tokens = await getRecentTokensFromSQL(limit);

    let stats = null;
    if (includeStats) {
      stats = await getTokenStatsFromSQL();
    }

    return NextResponse.json({
      success: true,
      tokens,
      count: tokens.length,
      timestamp: new Date().toISOString(),
      stats: stats,
      source: 'sqlite',
    });
  } catch (error) {
    console.error('Error fetching recent tokens:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
