# Pumpfun Token Display

A custom real-tim pumpfun token indexer leveraging Helius, Next.js, React, and MongoDB.

## Steps to run locally

### Configure .ENV file

You will need a MongoDB URI along with a Helius RPC URL and API key. Get these and put them in the `.env` file using the `example-env` file for reference.

- #### Note: You can run this with the free tier on Helius but getting all of the tokens is resource intensive and can use up to 500k credit units.

### Install dependencies

The project uses the pnpm package manager to handle installtion of packages:

```
pnpm install
```

### Setup the PumpfunTokenFetcher main()

After the env variables and dependencies are installed you can configure the main() function in `PumpfunTokenFetcher.ts` to run the function that will get all of the data and store it the database.

```
async function main() {
  // Initialize connection
  const connection: SolanaClient<string> = createSolanaClient({
    urlOrMoniker: `${process.env.HELIUS_RPC_URL}`,
  });

  // Create an instance of the pumpfun token fetcher class
  const fetcher = new PumpFunTokenFetcher(
    connection,
    `${process.env.HELIUS_KEY}`
  );

  try {

    await fetcher.collectAndStoreBondingCurves();

    // Or Process specific addresses from an array
    // const specificAddresses = ["address1", "address2", "address3"];
    // await fetcher.processBondingCurvesToDatabase(specificAddresses);

    // Or Add a single token
    // await fetcher.addSingleToken("specific_bonding_curve_address");

    // Show final stats
    await fetcher.showDatabaseStats();
  } catch (error) {
    console.error("❌ Error in main process:", error);
  }
}

main();
```

- #### NOTE: Sometimes the getAllBondingCurves() function will fail with an error along the lines of "Too many requests", "Deprecated because of to many requests", if this happens wait a few seconds and run it again. Sometimes it can take up to five calls for it to go through properly.

Then run it:

```
npx esrun src/lib/models/PumpfunTokenFetcher.ts
```

### Setup Helius webhook

- CURRENTLY BEING IMPLEMENTED

### Start the App to view tokens

Once the above steps are completed you will be ready to start the react/next app locally and view the bonding tokens run:

```

pnpm run dev

```
