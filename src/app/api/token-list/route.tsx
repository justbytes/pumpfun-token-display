// Updated src/app/api/token-list/route.tsx
import { NextRequest, NextResponse } from 'next/server';
import { getAllTokensFromDB, getTokenCountFromDB } from '@/lib/db/queries';

/**
 * Reads from the postgresql database and gets the tokens accordingly
 */
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

    // Get tokens from DB with filtering options
    const tokens = await getAllTokensFromDB({
      limit,
      offset,
      searchTerm,
      complete,
    });

    // Get total count for pagination (only if we need it)
    let totalCount = 0;
    if (offset !== undefined || limit !== undefined) {
      totalCount = await getTokenCountFromDB();
    }

    // Return the results
    return NextResponse.json({
      success: true,
      tokens,
      total: totalCount || tokens.length,
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
