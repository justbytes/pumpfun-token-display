// src/app/api/tokens/recent/route.ts
import { NextRequest, NextResponse } from 'next/server';
import {
  getRecentTokensFromSQL,
  getTokensAfterFromSQL,
  getTokenStatsFromSQL,
  initializeSQLDB,
} from '../../../../lib/db/sql';

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const after = searchParams.get('after');
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50;
    const includeStats = searchParams.get('stats') === 'true';

    // Initialize SQLite
    const sqliteInitialized = await initializeSQLDB();
    if (!sqliteInitialized) {
      return NextResponse.json({ error: 'Failed to initialize SQLite database' }, { status: 500 });
    }

    let tokens: any = [];

    if (after) {
      // Get tokens created after a specific timestamp
      tokens = await getTokensAfterFromSQL(after);

      // Limit the results if specified
      if (limit > 0 && tokens.length > limit) {
        tokens = tokens.slice(0, limit);
      }
    } else if (limit > 0) {
      // Get recent tokens with limit
      tokens = await getRecentTokensFromSQL(limit);
    }

    // Get stats if requested
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
