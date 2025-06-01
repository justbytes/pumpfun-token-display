// src/app/api/tokens/recent/route.ts
import { NextRequest, NextResponse } from 'next/server';
import {
  getRecentTokensFromSQLite,
  getTokensAfterFromSQLite,
  initializeSQLiteDB,
  getTokenStatsFromSQLite,
} from '../../../../lib/db/sql';

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50;
    const after = searchParams.get('after'); // Timestamp to get tokens after
    const includeStats = searchParams.get('stats') === 'true';

    // Initialize SQLite
    const sqliteInitialized = await initializeSQLiteDB();
    if (!sqliteInitialized) {
      return NextResponse.json({ error: 'Failed to initialize SQLite database' }, { status: 500 });
    }

    const startTime = performance.now();

    let tokens;
    if (after) {
      // Get tokens created after a specific timestamp
      tokens = await getTokensAfterFromSQLite(after);
      // Limit the results if needed
      if (tokens.length > limit) {
        tokens = tokens.slice(0, limit);
      }
    } else {
      // Get recent tokens
      tokens = await getRecentTokensFromSQLite(limit);
    }

    const endTime = performance.now();
    const queryTime = Math.round(endTime - startTime);

    // Optionally include stats
    let stats = null;
    if (includeStats) {
      stats = await getTokenStatsFromSQLite();
    }

    console.log(`✅ Recent tokens query completed in ${queryTime}ms (${tokens.length} tokens)`);

    return NextResponse.json({
      success: true,
      tokens,
      count: tokens.length,
      queryTime: `${queryTime}ms`,
      stats,
      timestamp: new Date().toISOString(),
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

// src/app/api/tokens/stats/route.ts - Separate stats endpoint
export async function GET_STATS(request: NextRequest) {
  try {
    // Initialize SQLite
    const sqliteInitialized = await initializeSQLiteDB();
    if (!sqliteInitialized) {
      return NextResponse.json({ error: 'Failed to initialize SQLite database' }, { status: 500 });
    }

    const startTime = performance.now();
    const stats = await getTokenStatsFromSQLite();
    const endTime = performance.now();
    const queryTime = Math.round(endTime - startTime);

    return NextResponse.json({
      success: true,
      stats,
      queryTime: `${queryTime}ms`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching token stats:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
