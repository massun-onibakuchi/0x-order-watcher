import express from 'express';
import { ethers } from 'ethers';

import { LimitOrderFilledEventArgs, OrderCanceledEventArgs } from './types';
import { OrderWatcher } from './order_watcher';
import { getDBConnectionAsync } from './db_connection';
import { logger } from './logger';

import { RPC_URL, EXCHANGE_RPOXY, PORT, SYNC_INTERVAL, LOG_LEVEL, CHAIN_ID, LOG_PATH, POLLING_INTERVAL } from './config';
import * as fs from 'fs';

const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'UTC',
    }).format(date);
};
// creates an Express application.
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// NOTE: WebSocketProvider : https://docs.ethers.io/v5/api/providers/ws-provider/
// const wsProvider = new ethers.providers.WebSocketProvider(WS_RPC_URL);

// ZeroEx INativeOrdersEvents
const abi = [
    'event OrderCancelled(bytes32 orderHash, address maker)',
    'event LimitOrderFilled(bytes32 orderHash, address maker, address taker, address feeRecipient, address makerToken, address takerToken, uint128 takerTokenFilledAmount, uint128 makerTokenFilledAmount, uint128 takerTokenFeeFilledAmount, uint256 protocolFeePaid, bytes32 pool)',
];
const zeroEx = new ethers.Contract(EXCHANGE_RPOXY, abi);
const provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL);
// Set polling interval
provider.pollingInterval = POLLING_INTERVAL;

let orderWatcher: OrderWatcher;
if (require.main === module) {
    (async () => {
        const { chainId } = await provider.getNetwork();
        if (chainId !== CHAIN_ID) {
            throw new Error(`Invalid ChainId: ${CHAIN_ID}!= ${chainId}`);
        }
        if (!ethers.utils.isAddress(EXCHANGE_RPOXY)) {
            throw new Error(`Invalid ZeroEx Address: ${EXCHANGE_RPOXY}`);
        }
        if ((await provider.getCode(EXCHANGE_RPOXY)) == '0x') {
            throw new Error(`ZeroEx is not deployed: ${EXCHANGE_RPOXY}`);
        }

        // db is shared among 0x-api and 0x-order-watcher
        const connection = await getDBConnectionAsync();
        orderWatcher = new OrderWatcher(connection, provider);

        logger.info(`${RPC_URL} is connected. ZeroEx: ${EXCHANGE_RPOXY}`);
        logger.info('OrderWatcher is ready. LogLevel: ' + LOG_LEVEL);
    })();
}

// NOTE: https://docs.ethers.io/v5/api/providers/types/#providers-Filter
// NOTE: https://docs.ethers.io/v5/api/providers/types/#providers-Log
// NOTE: https://docs.ethers.io/v5/concepts/events/#events--filters
// subscribe LimitOrderFilled events from ZeroEx contract
const orderFilledEventFilter = zeroEx.filters.LimitOrderFilled();
provider.on(orderFilledEventFilter, (log) => {
    const filledOrderEvent = zeroEx.interface.parseLog(log).args as any as LimitOrderFilledEventArgs;
    setImmediate(async (filledOrderEvent: LimitOrderFilledEventArgs) => {
        // format
        // "filledOrder", date, orderHash, maker, taker, makerToken, takerToken, takerTokenFilledAmount, makerTokenFilledAmount, takerTokenFeeFilledAmount
        fs.appendFile(
            LOG_PATH,
            `filledOrder,${log.blockNumber},${formatDate(new Date())},${log.transactionHash},${filledOrderEvent.orderHash},${filledOrderEvent.maker},${filledOrderEvent.taker},${filledOrderEvent.makerToken},${filledOrderEvent.takerToken},${filledOrderEvent.takerTokenFilledAmount},${filledOrderEvent.makerTokenFilledAmount},${filledOrderEvent.takerTokenFeeFilledAmount}\n`, // prettier-ignore
            (err) => {
                if (err) {
                    logger.error(err);
                }
            },
        );
        logger.debug('filledOrderEvent: orderHash ' + filledOrderEvent.orderHash);
        await orderWatcher.updateFilledOrdersAsync([filledOrderEvent]);
    }, filledOrderEvent);
});

// subscribe OrderCancelled events from ZeroEx contract
const orderCanceledEventFilter = zeroEx.filters.OrderCancelled();
provider.on(orderCanceledEventFilter, (log) => {
    const canceledOrderEvent = zeroEx.interface.parseLog(log).args as any as OrderCanceledEventArgs;
    setImmediate(async (canceledOrderEvent: OrderCanceledEventArgs) => {
        // format
        // "canceledOrder", date, orderHash, maker
        fs.appendFile(
            LOG_PATH,
            `canceledOrder,${log.blockNumber},${formatDate(new Date())},${log.transactionHash},${canceledOrderEvent.orderHash},${canceledOrderEvent.maker}\n`, // prettier-ignore
            (err) => {
                if (err) {
                    logger.error(err);
                }
            },
        );
        await orderWatcher.updateCanceledOrdersByHashAsync([canceledOrderEvent.orderHash]);
        logger.debug('canceledOrderEvent: orderHash ' + canceledOrderEvent.orderHash);
    }, canceledOrderEvent);
});

// periodically remove expired orders from DB
const timerId = setInterval(async () => {
    logger.debug('start syncing unfilled orders...');
    try {
        await orderWatcher.syncFreshOrders();
    } catch (error) {
        logger.error(error);
    }
}, SYNC_INTERVAL);

app.post('/ping', function (req, res) {
    res.json({ msg: 'pong, Got a POST request' });
});

// receive POST request from 0x-api `POST orderbook/v1/order`.
app.post('/orders', async function (req: express.Request, res) {
    try {
        logger.debug(req.body);
        // save orders to DB
        await orderWatcher.postOrdersAsync(req.body);
        res.status(200).json();
    } catch (err) {
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`app listening on port ${PORT} !`));

process.on('uncaughtException', (err) => {
    logger.error(err);
    clearInterval(timerId);
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    if (err) {
        logger.error(err);
    }
});
