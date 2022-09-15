# 0x-order-watcher

`OrderWatcher` functionality for [0x-api](https://github.com/0xProject/0x-api/).
This repo enables devs to run the 0x-api locally.

This manages the orders tracked by SQL db in 0x-api, so it is responsible for adding/removing orders from it

-   by sync'ing order statuses from the chain
-   by receiving new orders submitted through the api
-   by removing expired orders from the db

## Concept

[0x-api](https://github.com/0xProject/0x-api/) is a decentralized exchange infrastructure. It seems that 0x-api is not fully open-source.

That infracture depends on the following service called [OrderWatcher](https://github.com/0xProject/0x-api/blob/2ce223be17be18d83a47ea3f46aa3f737c7fae3b/src/utils/order_watcher.ts#L16). This repo provides `OrderWatcher` functionality to 0x-api.

## Getting Started

Type:

```
yarn
```

setup the `.env` file below:

```
# Required
EXCHANGE_RPOXY= # ZeroEx contract address
RPC_URL=http://localhost:8545 # Local or Mainnet RPC URL
```

### Compiling

Type:

```
yarn build
```

### Development

This project depends on [0x-api](https://github.com/0xProject/0x-api/).
For development make sure you run the 0x-api on a terminal.

Type:

```
docker-compose up
yarn dev
```

Type the following command on an another terminal:

```
yarn dev
```

## Running

Type:

```
yarn start
```

## Disclaimer

![Disclaimer](./picture.png)
