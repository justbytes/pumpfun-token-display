// Updated src/app/page.tsx with pagination
'use client';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import TokenCard from './components/TokenCard';

interface Token {
  bondingCurveAddress: string;
  complete: boolean;
  creator: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  uri: string;
  description: string;
  image: string;
  createdAt?: string;
  updatedAt?: string;
}

interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalTokens: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  startIndex: number;
  endIndex: number;
}

/**
 * React SPA that displays the pumpfun tokens coming from the postgresql database
 */
export default function Home() {
  // State management
  const [allTokens, setAllTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false); // Loading state for individual pages
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [dataLoadTime, setDataLoadTime] = useState<Date | null>(null);
  const [newTokensCount, setNewTokensCount] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const [loadedBatches, setLoadedBatches] = useState<Set<number>>(new Set());
  const [totalTokenCount, setTotalTokenCount] = useState<number>(0);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);

  // Refs for polling
  const lastPollTimeRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isComponentMountedRef = useRef(true);
  const autoRefreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const TOKENS_PER_PAGE = 50;
  const TOKENS_PER_BATCH = 500; // Load 500 tokens at once (10 pages worth)
  const POLLING_INTERVAL = 1000;
  const NEW_TOKEN_THRESHOLD = 5;

  // Load a specific page of tokens
  const loadTokenBatch = useCallback(
    async (batchNumber: number) => {
      if (loadedBatches.has(batchNumber)) {
        return; // Batch already loaded
      }

      try {
        setPageLoading(true);

        // get the batch offset
        const offset = (batchNumber - 1) * TOKENS_PER_BATCH;
        console.log(
          `🔄 Loading batch ${batchNumber} (tokens ${offset + 1}-${offset + TOKENS_PER_BATCH})`
        );

        // NextJS api call to get tokens
        const response = await fetch(`/api/token-list?limit=${TOKENS_PER_BATCH}&offset=${offset}`);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Response token data
        const data = await response.json();

        // Add the tokens to the list
        if (data.success) {
          setAllTokens(prevTokens => {
            // Create a map of existing tokens by address for efficient lookup
            const existingTokens = new Map(prevTokens.map(token => [token.tokenAddress, token]));

            // Add new tokens from this batch
            data.tokens.forEach((token: Token) => {
              existingTokens.set(token.tokenAddress, token);
            });

            // Convert back to array and sort by creation time (newest first)
            return Array.from(existingTokens.values()).sort(
              (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
            );
          });

          setLoadedBatches(prev => new Set([...prev, batchNumber]));

          // Update total count if provided
          if (data.total !== undefined) {
            setTotalTokenCount(data.total);
          }

          console.log(`✅ Loaded batch ${batchNumber} (${data.tokens.length} tokens)`);
        } else {
          throw new Error(data.error || 'Failed to fetch batch');
        }
      } catch (error) {
        console.error(`Error loading batch ${batchNumber}:`, error);
        throw error;
      } finally {
        setPageLoading(false);
      }
    },
    [loadedBatches]
  );

  // Load initial batch (first 500 tokens)
  const loadInitialTokens = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const startTime = performance.now();

      console.log(`🔄 Loading initial batch (first ${TOKENS_PER_BATCH} tokens)...`);

      // Clear existing data
      setAllTokens([]);
      setLoadedBatches(new Set());
      setCurrentPage(1);

      // Load the first batch
      await loadTokenBatch(1);

      const endTime = performance.now();
      const loadTime = Math.round(endTime - startTime);

      setDataLoadTime(new Date());
      setNewTokensCount(0);

      console.log(`✅ Initial load completed in ${loadTime}ms`);
    } catch (error) {
      console.error('Error loading initial tokens:', error);
      setError('Failed to load tokens. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [loadTokenBatch]);

  // Check if we need to load more tokens when user navigates to a page
  const ensureTokensLoaded = useCallback(
    async (pageNumber: number) => {
      // Calculate which batch this page belongs to
      const requiredTokenIndex = pageNumber * TOKENS_PER_PAGE;
      const requiredBatch = Math.ceil(requiredTokenIndex / TOKENS_PER_BATCH);

      // Use the current state value instead of stale closure
      setLoadedBatches(currentBatches => {
        if (!currentBatches.has(requiredBatch)) {
          console.log(`📄 Page ${pageNumber} requires batch ${requiredBatch}, loading...`);
          // Load the batch asynchronously without blocking state update
          loadTokenBatch(requiredBatch).catch(console.error);
        }
        return currentBatches; // Return unchanged
      });
    },
    [loadTokenBatch] // Only depend on loadTokenBatch
  );

  // Modified poll function to only update first page
  const pollForNewTokens = useCallback(async () => {
    if (!isComponentMountedRef.current) return;

    try {
      // Just get the most recent 25 tokens from the database
      const response = await fetch('/api/token-list?limit=25');

      if (!response.ok) {
        console.warn('❌ Polling failed:', response.status);
        return;
      }

      const data = await response.json();

      if (data.success && data.tokens && data.tokens.length > 0) {
        setAllTokens(prevTokens => {
          const existingAddresses = new Set(prevTokens.map(t => t.tokenAddress));

          // Find tokens we don't have yet
          const newTokens = data.tokens.filter(
            (token: Token) => !existingAddresses.has(token.tokenAddress)
          );

          if (newTokens.length > 0) {
            setNewTokensCount(prev => prev + newTokens.length);

            // Add new tokens to the front of the list
            return [...newTokens, ...prevTokens];
          }

          return prevTokens;
        });
      }
    } catch (error) {
      console.error('❌ Polling error:', error);
    }
  }, []);

  // Start polling for new tokens
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      console.log('Polling already active, skipping start');
      return;
    }

    console.log('🎧 Starting token polling...');
    setIsPolling(true);
    const now = new Date().toISOString();
    lastPollTimeRef.current = now;

    pollingIntervalRef.current = setInterval(() => {
      if (isComponentMountedRef.current) {
        pollForNewTokens();
      }
    }, POLLING_INTERVAL);
  }, [pollForNewTokens]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      setIsPolling(false);
      console.log('🛑 Token polling stopped');
    }
  }, []);

  // Handle page navigation with auto-loading
  const handlePageChange = useCallback(
    (page: number) => {
      if (page === currentPage) return;

      console.log(`📄 Navigating to page ${page}`);
      setCurrentPage(page);

      // Ensure we have enough tokens loaded for this page
      ensureTokensLoaded(page);

      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [currentPage, ensureTokensLoaded]
  );

  // Manual refresh function
  const refreshTokenList = useCallback(async () => {
    console.log('🔄 Full refresh - reloading all token data...');

    // Stop polling first
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      setIsPolling(false);
    }

    if (autoRefreshTimeoutRef.current) {
      clearTimeout(autoRefreshTimeoutRef.current);
      autoRefreshTimeoutRef.current = null;
    }

    // Clear everything and start fresh
    setAllTokens([]);
    setLoadedBatches(new Set());
    setNewTokensCount(0);
    setCurrentPage(1);

    try {
      await loadInitialTokens();
      setLastRefreshTime(new Date());

      // Restart polling after refresh
      setTimeout(() => {
        if (isComponentMountedRef.current) {
          console.log('🔄 Resuming token polling after refresh...');
          startPolling();
        }
      }, 1000);
    } catch (error) {
      console.error('Error during refresh:', error);
      setError('Failed to refresh tokens. Please try again.');
    }
  }, [loadInitialTokens, startPolling]);

  // Filter tokens based on search term
  const filteredTokens = useMemo(() => {
    if (!searchTerm.trim()) {
      return allTokens;
    }

    const searchLower = searchTerm.toLowerCase();
    return allTokens.filter(
      token =>
        token.name?.toLowerCase().includes(searchLower) ||
        token.symbol?.toLowerCase().includes(searchLower) ||
        token.description?.toLowerCase().includes(searchLower) ||
        token.tokenAddress?.toLowerCase().includes(searchLower)
    );
  }, [allTokens, searchTerm]);

  // Paginate filtered tokens
  const paginatedTokens = useMemo(() => {
    const startIndex = (currentPage - 1) * TOKENS_PER_PAGE;
    const endIndex = startIndex + TOKENS_PER_PAGE;
    return filteredTokens.slice(startIndex, endIndex);
  }, [filteredTokens, currentPage]);

  // Calculate pagination info
  const paginationInfo: PaginationInfo = useMemo(() => {
    const totalTokens = searchTerm
      ? filteredTokens.length
      : totalTokenCount || filteredTokens.length;
    const totalPages = Math.ceil(totalTokens / TOKENS_PER_PAGE);

    return {
      currentPage,
      totalPages,
      totalTokens,
      hasNextPage: currentPage < totalPages,
      hasPrevPage: currentPage > 1,
      startIndex: totalTokens > 0 ? (currentPage - 1) * TOKENS_PER_PAGE + 1 : 0,
      endIndex: Math.min(currentPage * TOKENS_PER_PAGE, totalTokens),
    };
  }, [currentPage, filteredTokens.length, totalTokenCount, searchTerm]);

  // Rest of your component remains the same...
  const getDataInfo = () => {
    if (!dataLoadTime) return '';

    const now = new Date();
    const diffMs = now.getTime() - dataLoadTime.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    const batchInfo = `📦 Batches Loaded: ${loadedBatches.size}`;

    if (diffSecs < 5) return `Data loaded just now • ${batchInfo}`;
    if (diffSecs < 60) return `Data loaded ${diffSecs}s ago • ${batchInfo}`;
    const diffMins = Math.floor(diffSecs / 60);
    return `Data loaded ${diffMins}m ago • ${batchInfo}`;
  };

  const getRefreshInfo = () => {
    if (!lastRefreshTime) return '';

    const now = new Date();
    const diffMs = now.getTime() - lastRefreshTime.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 5) return 'Refreshed just now';
    if (diffSecs < 60) return `Refreshed ${diffSecs}s ago`;
    const diffMins = Math.floor(diffSecs / 60);
    return `Refreshed ${diffMins}m ago`;
  };

  const PaginationControls = () => {
    const { totalPages, currentPage, totalTokens } = paginationInfo;

    if (totalPages <= 1) return null;

    // Generate page numbers to show
    const getPageNumbers = () => {
      const pages = [];
      const maxVisible = 3; // Changed to 3 since you want 3 pages at a time

      if (totalPages <= maxVisible) {
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Calculate start and end for sliding window
        let start = currentPage - 1;
        let end = currentPage + 1;

        // Adjust if we're near the beginning
        if (start < 1) {
          start = 1;
          end = 3;
        }

        // Adjust if we're near the end
        if (end > totalPages) {
          end = totalPages;
          start = totalPages - 2;
        }

        // Add the pages in the window
        for (let i = start; i <= end; i++) {
          pages.push(i);
        }
      }

      return pages;
    };

    return (
      <div className="flex flex-col lg:flex-row justify-between items-center space-y-4 lg:space-y-0 py-6 border-t border-gray-200 dark:border-gray-700">
        <div className="text-sm text-gray-700 dark:text-gray-300">
          Showing {paginationInfo.startIndex} to {paginationInfo.endIndex} of{' '}
          {totalTokens.toLocaleString()} tokens
          {pageLoading && <span className="ml-2 text-blue-600">Loading...</span>}
        </div>

        <div className="flex items-center space-x-1">
          {/* First and Previous */}
          <button
            onClick={handleFirstPage}
            disabled={currentPage === 1 || pageLoading}
            className="px-2 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="First page"
          >
            ««
          </button>
          <button
            onClick={handlePrevPage}
            disabled={!paginationInfo.hasPrevPage || pageLoading}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>

          {/* Page Numbers */}
          {getPageNumbers().map(pageNum => (
            <button
              key={pageNum}
              onClick={() => handlePageJump(pageNum as number)}
              disabled={pageLoading}
              className={`px-3 py-1 text-sm rounded transition-colors disabled:opacity-50 ${
                pageNum === currentPage
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              } ${'ring-1 ring-blue-300'}`}
              // title={!loadedPages.has(pageNum as number) ? 'Click to load page' : ''}
            >
              {pageNum}
            </button>
          ))}

          {/* Next and Last */}
          <button
            onClick={handleNextPage}
            disabled={!paginationInfo.hasNextPage || pageLoading}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    );
  };

  // Event handlers
  const handlePrevPage = () => {
    if (paginationInfo.hasPrevPage) {
      handlePageChange(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (paginationInfo.hasNextPage) {
      handlePageChange(currentPage + 1);
    }
  };

  const handlePageJump = (page: number) => {
    if (page >= 1 && page <= paginationInfo.totalPages) {
      handlePageChange(page);
    }
  };

  const handleFirstPage = () => {
    handlePageChange(1);
  };

  const handleRefresh = () => {
    setSearchTerm('');
    stopPolling();
    refreshTokenList();
  };

  // Component lifecycle
  useEffect(() => {
    isComponentMountedRef.current = true;

    const initializeApp = async () => {
      await loadInitialTokens();
      // Start polling after initial load completes
      setTimeout(() => {
        if (isComponentMountedRef.current) {
          startPolling();
        }
      }, 1000); // Give it a second before starting polling
    };

    initializeApp();

    return () => {
      isComponentMountedRef.current = false;
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (autoRefreshTimeoutRef.current) {
        clearTimeout(autoRefreshTimeoutRef.current);
        autoRefreshTimeoutRef.current = null;
      }
    };
  }, []);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  // Displays loading spinner with message
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-6"></div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Loading PumpFun Tokens
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Loading first {TOKENS_PER_BATCH * TOKENS_PER_PAGE} tokens...
          </p>
        </div>
      </div>
    );
  }

  // Displays error message
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center max-w-md">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Failed to Load Tokens
          </h2>
          <p className="text-red-600 mb-6">{error}</p>
          <div className="space-x-4">
            <button
              onClick={handleRefresh}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Displays tokens
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
            🚀 PumpFun Token Explorer
          </h1>
          <div className="text-gray-600 dark:text-gray-400 space-y-2">
            <p className="text-lg">
              {(totalTokenCount || allTokens.length).toLocaleString()} tokens • Lightning-fast
              navigation
            </p>
            <div className="flex justify-center items-center space-x-4 text-sm flex-wrap">
              {isPolling && (
                <div className="flex items-center space-x-1 text-green-600">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span>Live Updates (1s)</span>
                </div>
              )}

              {newTokensCount > 0 && newTokensCount < NEW_TOKEN_THRESHOLD && (
                <div className="flex items-center space-x-1 text-blue-600">
                  <span>🆕</span>
                  <span>{newTokensCount} new</span>
                </div>
              )}

              <span>⚡ {getDataInfo()}</span>

              {lastRefreshTime && <span>🔄 {getRefreshInfo()}</span>}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="mb-8 space-y-4">
          {/* Search Bar */}
          <div className="max-w-xl mx-auto relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg
                className="h-5 w-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search by name, symbol, description, or mint address..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-white text-lg"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-center items-center space-x-4 flex-wrap gap-2">
            <button
              onClick={handleRefresh}
              disabled={loading || pageLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 flex items-center space-x-2 disabled:opacity-50"
            >
              <span>🔄</span>
              <span>Refresh</span>
            </button>

            {/* <button
              onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
              className={`px-4 py-2 rounded-lg transition-colors duration-200 flex items-center space-x-2 ${
                autoRefreshEnabled
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gray-600 text-white hover:bg-gray-700'
              }`}
            >
              <span>{autoRefreshEnabled ? '🤖' : '📱'}</span>
              <span>{autoRefreshEnabled ? 'Auto-Refresh ON' : 'Auto-Refresh OFF'}</span>
            </button> */}
          </div>
        </div>

        {/* Results Summary */}
        {searchTerm && (
          <div className="text-center mb-6">
            <p className="text-gray-600 dark:text-gray-400">
              {filteredTokens.length.toLocaleString()} results for &quot;{searchTerm}&quot;
            </p>
          </div>
        )}

        {/* Top Pagination */}
        <PaginationControls />

        {/* Token Grid */}
        {paginatedTokens.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 mb-8">
            {paginatedTokens.map(token => (
              <TokenCard
                key={token.tokenAddress}
                tokenAddress={token.tokenAddress}
                name={token.name}
                symbol={token.symbol}
                description={token.description}
                image={token.image}
              />
            ))}
          </div>
        ) : searchTerm ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              No Results Found
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              No tokens found matching &quot;{searchTerm}&quot;
            </p>
            <button
              onClick={() => setSearchTerm('')}
              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
            >
              Clear search and view all tokens
            </button>
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">📭</div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              No Tokens Found
            </h3>
            <p className="text-gray-500 dark:text-gray-400">No tokens available in the database.</p>
          </div>
        )}

        {/* Bottom Pagination */}
        <PaginationControls />

        {/* Footer Stats */}
        <div className="text-center py-8 border-t border-gray-200 dark:border-gray-700 mt-8">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Total: {(totalTokenCount || allTokens.length).toLocaleString()} tokens • Page{' '}
            {paginationInfo.currentPage}
            {isPolling && ' • Live updates active (1s intervals)'}
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes slide-down {
          from {
            transform: translateY(-100%) translateX(-50%);
            opacity: 0;
          }
          to {
            transform: translateY(0) translateX(-50%);
            opacity: 1;
          }
        }

        .animate-slide-down {
          animation: slide-down 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
