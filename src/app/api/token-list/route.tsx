// Updated src/app/api/token-list/route.tsx
import { NextRequest, NextResponse } from 'next/server';
import { getAllTokensFromSQL, initializeSQLDB, getTokenCountFromSQL } from '../../../lib/db/sqlite';

let isInitialized = false;

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

    /// Initialize DB once
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

    // Start a timer
    //const startTime = performance.now();

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

    // const endTime = performance.now();
    // const queryTime = Math.round(endTime - startTime);

    // console.log(`✅ SQLite query completed in ${queryTime}ms (${tokens.length} tokens)`);

    return NextResponse.json({
      success: true,
      tokens,
      total: totalCount || tokens.length,
      // queryTime: `${queryTime}ms`,
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
