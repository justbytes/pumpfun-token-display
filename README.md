![pump display banner](/assets/display.png)

# 🚀 PumpFun Token Indexer

A real-time Solana token indexer that tracks and displays newly created PumpFun tokens with sub-second performance. Built with Next.js, React, and a dual-database architecture for optimal speed and reliability.

## 🌐 Live Demo

[View Live Application](http://ec2-13-58-137-59.us-east-2.compute.amazonaws.com/)
Note: Currently configured for HTTP connections

[Watch demo](https://www.youtube.com/watch?v=EN2W7xehxpQ)

## ✨ Features

- Real-time Token Tracking
- Monitors 100+ PumpFun token creation events per minute
- Fast Search
- Sub-second query responses with advanced filtering
- Live Updates
- Automatic token list refresh with real-time data
- Responsive Design
- Optimized for desktop and mobile viewing
- Pagination System
- Efficient browsing of 50 tokens per page
- Robust Data Collection
- Automated bonding curve parsing and metadata extraction
- Dual-Database Architecture
- SQLite for speed, MongoDB for cloud backup

## 🛠 Tech Stack

### Frontend

- Next.js 14
- React 18
- TypeScript
- TailwindCSS

### Backend & Infrastructure

- Node.js
- SQLite (local high-speed queries)
- MongoDB (cloud persistence)
- AWS EC2 deployment

### Blockchain Integration

- Solana Web3.js
- Helius RPC API
- Solana Program Account parsing

## 🏗 Architecture

### Dual Database System

This application uses a sophisticated two-database approach:

### SQLite Database

- Runs locally on the server
- Handles all client-side queries for millisecond response times
- Primary data source for the PumpFun event listener

### MongoDB Database

- Cloud-based persistent storage
- Automatic backup every 5 minutes
- Disaster recovery and data redundancy

This architecture ensures fast user experience while maintaining data integrity and preventing loss of expensive-to-retrieve blockchain data.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- MongoDB Atlas account
- Helius RPC access

### 1. Environment Setup

Create a .env file using the provided example.env:

```env
MONGODB_URI=your_mongodb_connection_string
HELIUS_RPC_URL=your_helius_rpc_endpoint
HELIUS_KEY=your_helius_api_key
```

Note: Free tier Helius works but may consume up to 500k credit units for full token indexing.

### 2. Install Dependencies

```bash
npm install
```

### 3. Initial Token Data Setup

Configure and run the initial token fetcher:

```bash
npm run fetch-tokens
```

#### - Troubleshooting: If you encounter "Too many requests" errors, wait a few seconds and retry. The system includes exponential backoff, but manual retries may be needed.

### 4. Start the Application

```bash
npm run dev
```

### 5. Start Real-time Event Listener

In a separate terminal, start the token creation monitor:

```bash
npm run start:listener
```

## 🔧 Database Management

Manual Database Sync
Navigate to `/src/lib/utils` and run the sync utility:

```
//Sync from SQLite to MongoDB
await syncDatabases(toCloud: false)

// Sync from MongoDB to SQLite
await syncDatabases(toCloud: true)

```

### Database Status Commands

- Check connection status
- View record counts
- Monitor sync intervals

## 🔮 Roadmap

### Planned Features

- RPC-based token lookup for missing tokens
- Enhanced Filtering
- Advanced search by market cap, volume, etc.
- Alert system for new token discoveries
- Analytics Dashboard
- Token performance metrics and trends
