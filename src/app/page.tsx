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

interface TokenStats {
  totalTokens: number;
  completedBondingCurves: number;
  activeBondingCurves: number;
}

export default function Home() {
  // State management
  const [allTokens, setAllTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [dataLoadTime, setDataLoadTime] = useState<Date | null>(null);
  const [newTokensCount, setNewTokensCount] = useState(0);
  const [stats, setStats] = useState<TokenStats | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [lastPollTime, setLastPollTime] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'sqlite' | 'mongodb'>('sqlite');

  // Refs for polling
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isComponentMountedRef = useRef(true);

  const TOKENS_PER_PAGE = 50;
  const POLLING_INTERVAL = 5000; // 5 seconds

  // Add new token to the list
  const addNewToken = useCallback((newToken: Token) => {
    setAllTokens(prevTokens => {
      // Check if token already exists to avoid duplicates
      const tokenExists = prevTokens.some(token => token.tokenAddress === newToken.tokenAddress);

      if (!tokenExists) {
        setNewTokensCount(prev => prev + 1);
        // Add new token to the beginning of the list
        return [newToken, ...prevTokens];
      }

      return prevTokens;
    });
  }, []);

  // Add multiple new tokens
  const addNewTokens = useCallback((newTokens: Token[]) => {
    if (newTokens.length === 0) return;

    setAllTokens(prevTokens => {
      const existingAddresses = new Set(prevTokens.map(t => t.tokenAddress));
      const uniqueNewTokens = newTokens.filter(token => !existingAddresses.has(token.tokenAddress));

      if (uniqueNewTokens.length > 0) {
        setNewTokensCount(prev => prev + uniqueNewTokens.length);
        // Add new tokens to the beginning of the list
        return [...uniqueNewTokens, ...prevTokens];
      }

      return prevTokens;
    });
  }, []);

  // Fetch all tokens from the specified source
  const fetchAllTokens = async (source: 'sqlite' | 'mongodb' = 'sqlite') => {
    try {
      setLoading(true);
      setError(null);

      console.log(`Fetching all tokens from ${source.toUpperCase()}...`);
      const startTime = performance.now();

      const response = await fetch(`/api/token-list?source=${source}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        const endTime = performance.now();
        const loadTime = Math.round(endTime - startTime);

        setAllTokens(data.tokens);
        setDataLoadTime(new Date());
        setNewTokensCount(0);
        setDataSource(source);

        console.log(
          `✅ Loaded ${data.tokens.length} tokens from ${source.toUpperCase()} in ${data.queryTime}`
        );
        console.log(`📊 Total transfer time: ${loadTime}ms`);

        // Start polling if using SQLite
        if (source === 'sqlite') {
          startPolling();
        }
      } else {
        throw new Error(data.error || 'Failed to fetch tokens');
      }
    } catch (error) {
      console.error('Error fetching tokens:', error);
      setError('Failed to fetch tokens. Please try again.');

      // If SQLite fails, try MongoDB as fallback
      if (source === 'sqlite') {
        console.log('🔄 SQLite failed, falling back to MongoDB...');
        try {
          await fetchAllTokens('mongodb');
          return;
        } catch (mongoError) {
          console.error('MongoDB fallback also failed:', mongoError);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Poll for new tokens
  const pollForNewTokens = async () => {
    if (!isComponentMountedRef.current) return;

    try {
      const timestamp = lastPollTime || new Date(Date.now() - 60000).toISOString(); // Last minute if no timestamp

      const response = await fetch(`/api/tokens/recent?after=${timestamp}&limit=100&stats=true`);

      if (!response.ok) {
        console.warn('Polling request failed:', response.status);
        return;
      }

      const data = await response.json();

      if (data.success && data.tokens.length > 0) {
        console.log(`🆕 Found ${data.tokens.length} new tokens`);
        addNewTokens(data.tokens);

        // Update stats if provided
        if (data.stats) {
          setStats(data.stats);
        }
      }

      setLastPollTime(data.timestamp);
    } catch (error) {
      console.warn('Polling error:', error);
    }
  };

  // Start polling for new tokens
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current || isPolling) return;

    console.log('🔄 Starting token polling...');
    setIsPolling(true);
    setLastPollTime(new Date().toISOString());

    pollingIntervalRef.current = setInterval(pollForNewTokens, POLLING_INTERVAL);
  }, [isPolling, lastPollTime]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      setIsPolling(false);
      console.log('🛑 Token polling stopped');
    }
  }, []);

  // Fetch token stats
  const fetchStats = async () => {
    try {
      const response = await fetch('/api/tokens/recent?stats=true&limit=0');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.stats) {
          setStats(data.stats);
        }
      }
    } catch (error) {
      console.warn('Failed to fetch stats:', error);
    }
  };

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
    const totalTokens = filteredTokens.length;
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
  }, [filteredTokens.length, currentPage]);

  // Component lifecycle
  useEffect(() => {
    isComponentMountedRef.current = true;
    fetchAllTokens('sqlite');
    fetchStats();

    return () => {
      isComponentMountedRef.current = false;
      stopPolling();
    };
  }, []);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  // Event handlers
  const handlePrevPage = () => {
    if (paginationInfo.hasPrevPage) {
      setCurrentPage(prev => prev - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleNextPage = () => {
    if (paginationInfo.hasNextPage) {
      setCurrentPage(prev => prev + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handlePageJump = (page: number) => {
    if (page >= 1 && page <= paginationInfo.totalPages) {
      setCurrentPage(page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleFirstPage = () => {
    setCurrentPage(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLastPage = () => {
    setCurrentPage(paginationInfo.totalPages);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRefresh = () => {
    setSearchTerm('');
    setCurrentPage(1);
    stopPolling();
    fetchAllTokens(dataSource);
  };

  const handleSwitchSource = async (newSource: 'sqlite' | 'mongodb') => {
    if (newSource !== dataSource) {
      stopPolling();
      await fetchAllTokens(newSource);
    }
  };

  const getDataInfo = () => {
    if (!dataLoadTime) return '';

    const now = new Date();
    const diffMs = now.getTime() - dataLoadTime.getTime();
    const diffMins = Math.floor(diffMs / 1000 / 60);

    if (diffMins < 1) return 'Data loaded just now';
    if (diffMins === 1) return 'Data loaded 1 minute ago';
    return `Data loaded ${diffMins} minutes ago`;
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

        let start = Math.max(2, currentPage - 1);
        let end = Math.min(totalPages - 1, currentPage + 1);

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
        </div>

        <div className="flex items-center space-x-1">
          {/* First and Previous */}
          <button
            onClick={handleFirstPage}
            disabled={currentPage === 1}
            className="px-2 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="First page"
          >
            ««
          </button>
          <button
            onClick={handlePrevPage}
            disabled={!paginationInfo.hasPrevPage}
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
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  pageNum === currentPage
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {pageNum}
              </button>
            )
          )}

          {/* Next and Last */}
          <button
            onClick={handleNextPage}
            disabled={!paginationInfo.hasNextPage}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
          <button
            onClick={handleLastPage}
            disabled={currentPage === totalPages}
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
            Loading from {dataSource.toUpperCase()}...
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
            {dataSource === 'sqlite' && (
              <button
                onClick={() => handleSwitchSource('mongodb')}
                className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200"
              >
                Use MongoDB
              </button>
            )}
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
              {allTokens.length.toLocaleString()} tokens • Lightning-fast navigation
            </p>
            <div className="flex justify-center items-center space-x-4 text-sm flex-wrap">
              <div className="flex items-center space-x-2">
                <span>💾 Source:</span>
                <span className="font-semibold">{dataSource.toUpperCase()}</span>
              </div>

              {isPolling && (
                <div className="flex items-center space-x-1 text-green-600">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span>Live Updates</span>
                </div>
              )}

              {newTokensCount > 0 && (
                <div className="flex items-center space-x-1 text-blue-600">
                  <span>🆕</span>
                  <span>{newTokensCount} new</span>
                </div>
              )}

              <span>⚡ {getDataInfo()}</span>
            </div>

            {/* Stats */}
            {stats && (
              <div className="flex justify-center items-center space-x-6 text-sm text-gray-500">
                <span>Total: {stats.totalTokens.toLocaleString()}</span>
                <span>Active: {stats.activeBondingCurves.toLocaleString()}</span>
                <span>Completed: {stats.completedBondingCurves.toLocaleString()}</span>
              </div>
            )}
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
          <div className="flex justify-center items-center space-x-4">
            <button
              onClick={handleRefresh}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 flex items-center space-x-2"
            >
              <span>🔄</span>
              <span>Refresh</span>
            </button>

            {dataSource === 'sqlite' ? (
              <button
                onClick={() => handleSwitchSource('mongodb')}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200 flex items-center space-x-2"
              >
                <span>📊</span>
                <span>Switch to MongoDB</span>
              </button>
            ) : (
              <button
                onClick={() => handleSwitchSource('sqlite')}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors duration-200 flex items-center space-x-2"
              >
                <span>⚡</span>
                <span>Switch to SQLite</span>
              </button>
            )}

            {dataSource === 'sqlite' && (
              <button
                onClick={isPolling ? stopPolling : startPolling}
                className={`px-4 py-2 rounded-lg transition-colors duration-200 flex items-center space-x-2 ${
                  isPolling
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                <span>{isPolling ? '⏸️' : '▶️'}</span>
                <span>{isPolling ? 'Stop Live Updates' : 'Start Live Updates'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Results Summary */}
        {searchTerm && (
          <div className="text-center mb-6">
            <p className="text-gray-600 dark:text-gray-400">
              {filteredTokens.length.toLocaleString()} results for "{searchTerm}"
            </p>
          </div>
        )}

        {/* Top Pagination */}
        <PaginationControls />

        {/* Token Grid */}
        {paginatedTokens.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 mb-8">
            {paginatedTokens.map(token => (
              <TokenCard key={token.tokenAddress} token={token} />
            ))}
          </div>
        ) : searchTerm ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              No Results Found
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              No tokens found matching "{searchTerm}"
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
            Total: {allTokens.length.toLocaleString()} tokens • Page {paginationInfo.currentPage} of{' '}
            {paginationInfo.totalPages.toLocaleString()} • Data source: {dataSource.toUpperCase()}
            {isPolling && ' • Live updates active'}
          </p>
        </div>
      </div>
    </div>
  );
}
