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

export default function Home() {
  // State management
  const [allTokens, setAllTokens] = useState<Token[]>([]);
  const [loadedPages, setLoadedPages] = useState<Set<number>>(new Set()); // Track which pages are loaded
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false); // Loading state for individual pages
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [dataLoadTime, setDataLoadTime] = useState<Date | null>(null);
  const [newTokensCount, setNewTokensCount] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const [totalTokenCount, setTotalTokenCount] = useState<number>(0); // Total count from server

  // New refresh-related state
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);

  // Refs for polling
  const lastPollTimeRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isComponentMountedRef = useRef(true);
  const autoRefreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const TOKENS_PER_PAGE = 50;
  const INITIAL_PAGES_TO_LOAD = 5; // Load first 5 pages initially
  const POLLING_INTERVAL = 1000;
  const NEW_TOKEN_THRESHOLD = 5;

  // Load a specific page of tokens
  const loadPage = useCallback(
    async (pageNumber: number) => {
      if (loadedPages.has(pageNumber)) {
        return; // Page already loaded
      }

      try {
        setPageLoading(true);

        const offset = (pageNumber - 1) * TOKENS_PER_PAGE;
        const response = await fetch(`/api/token-list?limit=${TOKENS_PER_PAGE}&offset=${offset}`);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
          setAllTokens(prevTokens => {
            // Create a map of existing tokens by address for efficient lookup
            const existingTokens = new Map(prevTokens.map(token => [token.tokenAddress, token]));

            // Add new tokens from this page
            data.tokens.forEach((token: Token) => {
              existingTokens.set(token.tokenAddress, token);
            });

            // Convert back to array and sort by creation time (newest first)
            return Array.from(existingTokens.values()).sort(
              (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
            );
          });

          setLoadedPages(prev => new Set([...prev, pageNumber]));

          // Update total count if provided
          if (data.total !== undefined) {
            setTotalTokenCount(data.total);
          }

          console.log(`✅ Loaded page ${pageNumber} (${data.tokens.length} tokens)`);
        } else {
          throw new Error(data.error || 'Failed to fetch page');
        }
      } catch (error) {
        console.error(`Error loading page ${pageNumber}:`, error);
        throw error;
      } finally {
        setPageLoading(false);
      }
    },
    [loadedPages]
  );

  // Load initial pages (first 3 pages)
  const loadInitialPages = useCallback(
    async (source: 'sqlite' | 'mongodb' = 'sqlite') => {
      try {
        setLoading(true);
        setError(null);
        const startTime = performance.now();

        console.log(`🔄 Loading initial ${INITIAL_PAGES_TO_LOAD} pages...`);

        // Load pages sequentially to maintain order
        for (let page = 1; page <= INITIAL_PAGES_TO_LOAD; page++) {
          await loadPage(page);
        }

        const endTime = performance.now();
        const loadTime = Math.round(endTime - startTime);

        setDataLoadTime(new Date());
        setNewTokensCount(0);

        console.log(`✅ Initial load completed in ${loadTime}ms`);

        // Start polling if using SQLite
        if (source === 'sqlite') {
          startPolling();
        }
      } catch (error) {
        console.error('Error loading initial pages:', error);
        setError('Failed to load tokens. Please try again.');

        // If SQLite fails, try MongoDB as fallback
        if (source === 'sqlite') {
          console.log('🔄 SQLite failed, falling back to MongoDB...');
          try {
            await loadInitialPages('mongodb');
            return;
          } catch (mongoError) {
            console.error('MongoDB fallback also failed:', mongoError);
          }
        }
      } finally {
        setLoading(false);
      }
    },
    [loadPage]
  );

  // Modified poll function to only update first page
  const pollForNewTokens = useCallback(async () => {
    if (!isComponentMountedRef.current) return;

    try {
      // Just get the most recent 50 tokens from the database
      const response = await fetch('/api/tokens/recent?limit=50');

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

  // Handle page navigation
  const handlePageChange = useCallback(
    async (page: number) => {
      if (page === currentPage) return;

      setCurrentPage(page);

      // Load the page if it's not already loaded
      if (!loadedPages.has(page)) {
        try {
          await loadPage(page);
        } catch (error) {
          console.error(`Failed to load page ${page}:`, error);
          setError(`Failed to load page ${page}. Please try again.`);
        }
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [currentPage, loadedPages, loadPage]
  );

  // Manual refresh function
  const refreshTokenList = useCallback(async () => {
    console.log('🔄 Full refresh - reloading all token data...');

    // Clear everything and start fresh
    setAllTokens([]);
    setLoadedPages(new Set());
    setNewTokensCount(0);
    setCurrentPage(1);

    if (autoRefreshTimeoutRef.current) {
      clearTimeout(autoRefreshTimeoutRef.current);
      autoRefreshTimeoutRef.current = null;
    }

    const wasPolling = isPolling;
    if (wasPolling) {
      stopPolling();
    }

    try {
      await loadInitialPages();
      setLastRefreshTime(new Date());

      if (wasPolling) {
        setTimeout(() => {
          console.log('🔄 Resuming token polling...');
          startPolling();
        }, 1000);
      }
    } catch (error) {
      console.error('Error during refresh:', error);
      setError('Failed to refresh tokens. Please try again.');
    }
  }, [isPolling, loadInitialPages, stopPolling, startPolling]);

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

  // Component lifecycle
  useEffect(() => {
    isComponentMountedRef.current = true;

    const initializeApp = async () => {
      await loadInitialPages('sqlite');
    };

    initializeApp();

    return () => {
      isComponentMountedRef.current = false;
      stopPolling();
      if (autoRefreshTimeoutRef.current) {
        clearTimeout(autoRefreshTimeoutRef.current);
      }
    };
  }, [loadInitialPages, stopPolling]);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

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

  const handleLastPage = () => {
    handlePageChange(paginationInfo.totalPages);
  };

  const handleRefresh = () => {
    setSearchTerm('');
    stopPolling();
    refreshTokenList();
  };

  // Rest of your component remains the same...
  const getDataInfo = () => {
    if (!dataLoadTime) return '';

    const now = new Date();
    const diffMs = now.getTime() - dataLoadTime.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 5) return 'Data loaded just now';
    if (diffSecs < 60) return `Data loaded ${diffSecs} seconds ago`;
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins === 1) return 'Data loaded 1 minute ago';
    return `Data loaded ${diffMins} minutes ago`;
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
      const maxVisible = 5;

      if (totalPages <= maxVisible) {
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Always show first page
        pages.push(1);

        const start = Math.max(2, currentPage - 1);
        const end = Math.min(totalPages - 1, currentPage + 1);

        // Add ellipsis if needed
        if (start > 2) {
          pages.push('...');
        }

        // Add middle pages
        for (let i = start; i <= end; i++) {
          if (i !== 1 && i !== totalPages) {
            pages.push(i);
          }
        }

        // Add ellipsis if needed
        if (end < totalPages - 1) {
          pages.push('...');
        }

        // Always show last page
        if (totalPages > 1) {
          pages.push(totalPages);
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
          {getPageNumbers().map((pageNum, index) =>
            pageNum === '...' ? (
              <span key={`ellipsis-${index}`} className="px-2 py-1 text-gray-500">
                ...
              </span>
            ) : (
              <button
                key={pageNum}
                onClick={() => handlePageJump(pageNum as number)}
                disabled={pageLoading}
                className={`px-3 py-1 text-sm rounded transition-colors disabled:opacity-50 ${
                  pageNum === currentPage
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                } ${
                  !loadedPages.has(pageNum as number) && pageNum !== currentPage
                    ? 'ring-1 ring-blue-300'
                    : ''
                }`}
                title={!loadedPages.has(pageNum as number) ? 'Click to load page' : ''}
              >
                {pageNum}
              </button>
            )
          )}

          {/* Next and Last */}
          <button
            onClick={handleNextPage}
            disabled={!paginationInfo.hasNextPage || pageLoading}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
          <button
            onClick={handleLastPage}
            disabled={currentPage === totalPages || pageLoading}
            className="px-2 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Last page"
          >
            »»
          </button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-6"></div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Loading PumpFun Tokens
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Loading first {INITIAL_PAGES_TO_LOAD * TOKENS_PER_PAGE} tokens...
          </p>
        </div>
      </div>
    );
  }

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

              <span className="text-xs">
                📄 Pages loaded: {loadedPages.size}/{paginationInfo.totalPages}
              </span>
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

            <button
              onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
              className={`px-4 py-2 rounded-lg transition-colors duration-200 flex items-center space-x-2 ${
                autoRefreshEnabled
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gray-600 text-white hover:bg-gray-700'
              }`}
            >
              <span>{autoRefreshEnabled ? '🤖' : '📱'}</span>
              <span>{autoRefreshEnabled ? 'Auto-Refresh ON' : 'Auto-Refresh OFF'}</span>
            </button>
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
            {paginationInfo.currentPage} of {paginationInfo.totalPages.toLocaleString()}
            {isPolling && ' • Live updates active (1s intervals)'}
            {autoRefreshEnabled && ' • Auto-refresh enabled'}
            <br />
            Loaded pages:{' '}
            {Array.from(loadedPages)
              .sort((a, b) => a - b)
              .join(', ')}
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
