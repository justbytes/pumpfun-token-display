import { NextRequest, NextResponse } from "next/server";
import {
  getAllTokens,
  initializeDbConnection,
} from "../../../lib/db/connection";

export async function GET(request: NextRequest) {
  try {
    // Initialize database connection
    const connected = await initializeDbConnection();
    if (!connected) {
      return NextResponse.json(
        { error: "Failed to connect to database" },
        { status: 500 }
      );
    }

    // Get all tokens at once - no pagination on backend
    const tokens = await getAllTokens();

    return NextResponse.json({
      success: true,
      tokens,
      total: tokens.length,
    });
  } catch (error) {
    console.error("Error fetching tokens:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
