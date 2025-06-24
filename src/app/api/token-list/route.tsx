// Updated src/app/api/token-list/route.tsx
import { NextRequest, NextResponse } from 'next/server';
import { getAllTokensMongoDB, initializeMongoDb } from '../../../../oldcode/mongoDB';
import { getAllTokensFromSQL, initializeSQLDB, getTokenCountFromSQL } from '../../../lib/db/sqlite';

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined;
    const searchTerm = searchParams.get('search') || undefined;
    const complete = searchParams.get('complete')
      ? searchParams.get('complete') === 'true'
      : undefined;

    // Use SQLite for fast reads
    console.log(`📊 Fetching tokens from SQLite (limit: ${limit}, offset: ${offset})...`);

    // Initialize SQLite if not already done
    const sqliteInitialized = await initializeSQLDB();
    if (!sqliteInitialized) {
      console.error('Failed to initialize SQL database');
    }

    const startTime = performance.now();

    // Get tokens from SQLite with filtering options
    const tokens = await getAllTokensFromSQL({
      limit,
      offset,
      searchTerm,
      complete,
    });

    // Get total count for pagination (only if we need it)
    let totalCount = 0;
    if (offset !== undefined || limit !== undefined) {
      totalCount = await getTokenCountFromSQL();
    }

    const endTime = performance.now();
    const queryTime = Math.round(endTime - startTime);

    console.log(`✅ SQLite query completed in ${queryTime}ms (${tokens.length} tokens)`);

    return NextResponse.json({
      success: true,
      tokens,
      total: totalCount || tokens.length,
      source: 'sqlite',
      queryTime: `${queryTime}ms`,
      pagination: {
        limit,
        offset,
        hasMore: limit !== undefined && tokens.length === limit,
        isPagedRequest: offset !== undefined || limit !== undefined,
      },
    });
  } catch (error) {
    console.error('Error fetching tokens:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
