import TokenImage from './TokenImage';

interface TokenProps {
  tokenAddress: string;
  name: string;
  symbol: string;
  description: string;
  image: string;
}

export default function TokenCard({ tokenAddress, name, symbol, description, image }: TokenProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300 p-6 border border-gray-200 dark:border-gray-700">
      {/* Token Image */}
      <div className="flex justify-center mb-4">
        <div className="relative w-20 h-20 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
          <TokenImage src={image} alt={name} className="rounded-full" />
        </div>
      </div>

      {/* Token Info */}
      <div className="text-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">{name}</h3>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">${symbol}</p>
        <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">{description}</p>
      </div>

      {/* Mint Address */}
      <div className="mb-4">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Mint Address:</p>
        <p className="text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 p-2 rounded break-all">
          {tokenAddress}
        </p>
      </div>

      {/* View Button */}
      <div className="flex justify-center">
        <a
          href={`https://pump.fun/coin/${tokenAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors duration-200"
        >
          View on Pump.fun
          <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      </div>
    </div>
  );
}
