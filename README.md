![pump display banner](/assets/display.png)

# 🚀 PumpFun Token Indexer

A real-time Solana token indexer that tracks and displays newly created PumpFun tokens with sub-second performance.

## 🌐 Live Demo

[View Live Application](http://ec2-18-219-41-139.us-east-2.compute.amazonaws.com/)
Currently configured for HTTP connections

[Watch demo](https://www.youtube.com/watch?v=mfBdOPcmGXQ)

## ✨ Features

- Real-time token tracking
- Monitors 100+ PumpFun token creation events per minute
- Instantly search over 400k pumpfun tokens
- Responsive design
- Lazy loading and pagination system
- Robust data collection
- Automated bonding curve parsing and metadata extraction

## 🛠 Tech Stack

### Programming languages

- TypeScript

### Frontend

- Next.js
- React
- TailwindCSS

### Backend & Infrastructure

- Node.js
- PostgreSQL/Drizzle
- Docker
- AWS EC2 deployment

### Blockchain Integration

- Solana Web3.js
- Gill
- Anchor
- Helius RPC API

## 🚀 Quick Start

### Prerequisites

- Node.js 22.16.0
- Helius RPC access
- Docker

### 1. Environment Setup

Create a .env file using the provided example.env

Note: Free tier Helius works but may consume up to 500k credit units for full token indexing.

### 2. Configure Database

Create a docker postgres container:

```bash
docker pull postgres
```

Then create a container with:

```bash
docker run --name <container name here> -e POSTGRES_PASSWORD=<password here> -d -p 5432:5432 postgres
```

Now you can run:

```bash
npm run db:generate
npm run db:migrate
```

But sometimes those commands do not work due to a known issue, in this case you can do the following:

```bash
docker exec -it <name of container> psql -U postgres -d <name of container>
```

Now you are in the shell and can past:

```sql
CREATE TABLE "tokens" (
    "id" serial PRIMARY KEY NOT NULL,
    "bonding_curve_address" text NOT NULL,
    "complete" boolean DEFAULT false NOT NULL,
    "creator" text NOT NULL,
    "token_address" text NOT NULL,
    "name" text NOT NULL,
    "symbol" text NOT NULL,
    "uri" text,
    "description" text,
    "image" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "tokens_bonding_curve_address_unique" UNIQUE("bonding_curve_address"),
    CONSTRAINT "tokens_token_address_unique" UNIQUE("token_address")
);

# Create the indexes:
CREATE INDEX "idx_tokens_bonding_curve" ON "tokens" USING btree ("bonding_curve_address");
CREATE INDEX "idx_tokens_address" ON "tokens" USING btree ("token_address");
CREATE INDEX "idx_tokens_symbol" ON "tokens" USING btree ("symbol");
CREATE INDEX "idx_tokens_name" ON "tokens" USING btree ("name");
CREATE INDEX "idx_tokens_complete" ON "tokens" USING btree ("complete");
CREATE INDEX "idx_tokens_creator" ON "tokens" USING btree ("creator");
CREATE INDEX "idx_tokens_created_at" ON "tokens" USING btree ("created_at");
```

Check to make sure the table is there by running:

```sql
SELECT * FROM tokens;
```

To exit run:

```sql
\q
```

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

## 🔮 Roadmap

### Planned Features

- RPC-based token lookup for older pumpfun tokens
- Enhanced Filtering
- Token performance metrics and trends
