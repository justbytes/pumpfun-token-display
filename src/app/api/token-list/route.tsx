// src/app/api/token-list/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAllTokens, initializeDbConnection } from '../../../lib/db/mongoDB';
import {
  getAllTokensFromSQL,
  initializeSQLDB,
  getTokenCountFromSQL,
  getTokenStatsFromSQL,
} from '../../../lib/db/sql';

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'sqlite'; // Default to SQLite
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : undefined;
    const searchTerm = searchParams.get('search') || undefined;
    const complete = searchParams.get('complete')
      ? searchParams.get('complete') === 'true'
      : undefined;

    if (source === 'sqlite') {
      // Use SQLite for fast reads
      console.log('📊 Fetching tokens from SQLite...');

      // Initialize SQLite if not already done
      const sqliteInitialized = await initializeSQLDB();
      if (!sqliteInitialized) {
        console.error('Failed to initialize SQL database');
        // Fallback to MongoDB
        return await fetchFromMongoDB();
      }

      const startTime = performance.now();

      // Get tokens from SQLite with filtering options
      const tokens = await getAllTokensFromSQL({
        limit,
        offset,
        searchTerm,
        complete,
      });

      const endTime = performance.now();
      const queryTime = Math.round(endTime - startTime);

      // Get total count for pagination
      const totalCount = await getTokenCountFromSQL();

      console.log(`✅ SQLite query completed in ${queryTime}ms`);

      return NextResponse.json({
        success: true,
        tokens,
        total: totalCount,
        source: 'sqlite',
        queryTime: `${queryTime}ms`,
        pagination: {
          limit,
          offset,
          hasMore: offset !== undefined && tokens.length === limit,
        },
      });
    } else if (source === 'mongodb') {
      // Use MongoDB for comprehensive data
      return await fetchFromMongoDB();
    } else {
      return NextResponse.json(
        { error: 'Invalid source parameter. Use "sqlite" or "mongodb"' },
        { status: 400 }
      );
    }
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

// Fallback function to fetch from MongoDB
async function fetchFromMongoDB() {
  try {
    console.log('📊 Fetching tokens from MongoDB...');

    // Initialize MongoDB connection
    const connected = await initializeDbConnection();
    if (!connected) {
      return NextResponse.json({ error: 'Failed to connect to MongoDB' }, { status: 500 });
    }

    const startTime = performance.now();

    // Get all tokens from MongoDB
    const tokens = await getAllTokens();

    const endTime = performance.now();
    const queryTime = Math.round(endTime - startTime);

    console.log(`✅ MongoDB query completed in ${queryTime}ms`);

    return NextResponse.json({
      success: true,
      tokens,
      total: tokens.length,
      source: 'mongodb',
      queryTime: `${queryTime}ms`,
    });
  } catch (error) {
    console.error('Error fetching from MongoDB:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch from MongoDB',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
