# Pumpfun Token Display

A real-time pumpfun token indexer leveraging Helius, Next.js, React, and MongoDB.

## Databases

This app uses two databases. One better-sqlite3 database that runs locally on the server and is where the PumpfunEventListener adds the new tokens and where the client side gets its data from. The second is a MongoDB database that is used for cloud storage in the case that something happens to the server we don't want to loose all the data that is expensive to get. This allows for quick client side polling and an easy way to manage the 100s/min of tokens that the listener picks up.

### SYNC DBS

In the case you need to manual sync the data between the databases navigate to `/src/lib/utils` directory where you can run the main function with the `sync` parameter and the `toCloud` parameter. Set `toCloud` to true if you would like to sync the data from MongoDB to the local SQlite or set `toCloud` to false to sync the data from SQlite to MongoDB. There are also some other commands that provide status of each database.

## Future Developments

- Deeps search function that uses RPC call to get a pumpfun token using the mint. Not all pumpfun tokens can be retrieved via the getProgramAccounts so we will need a special funtion that can get and add specific coins we might be missing which should also add it to the db if its not there.

## Steps to run locally

### Configure .ENV file

You will need a MongoDB URI along with a Helius RPC URL and API key. Get these and put them in the `.env` file using the `example-env` file for reference.

- #### Note: You can run this with the free tier on Helius but getting all of the tokens is resource intensive and could use up to 500k credit units.

### Install dependencies

```
npm install
```

### Setup the PumpfunTokenFetcher main()

After the env variables and dependencies are installed you can configure the main() function in `PumpfunTokenFetcher.ts` to run the function that will get an initial list of pumpfun tokens to work with.

```
async function main() {
  // Initialize connection
  const connection: SolanaClient<string> = createSolanaClient({
    urlOrMoniker: `${process.env.HELIUS_RPC_URL}`,
  });

  // Create an instance of the pumpfun token fetcher class
  const fetcher = new PumpFunTokenFetcher(connection, `${process.env.HELIUS_KEY}`);

  try {
    // Update the db with the new tokens created
    await fetcher.getFreshTokenList();

    process.exit(0);
  } catch (error) {
    console.error('❌ Error in main process:', error);
    process.exit(1);
  }
}

main();
```

- #### NOTE: Sometimes the getBondingCurvesFromProgramAccounts() function will fail with an error along the lines of "Too many requests", "Deprecated because of to many requests", if this happens wait a few seconds and run it again. Sometimes it can take up to five calls for it to go through properly. - Retry logic has been applied but you may still run into this issue so just keep trying regardless.

Then run it:

```
npx esrun src/lib/models/PumpfunTokenFetcher.ts
```

### Start the App to view tokens

Once you have a list of tokens in your dbs you will be ready to start the react/next app locally and view the tokens by running:

```
pnpm run dev
```

### Start Create Event Listener

Once you have the app started you can start the create event listener which will add new tokens to the sqlite database and run updates to mongodb every 5 minutes:

```
npx esrun src/lib/models/PumpfunEventListener.ts
```
