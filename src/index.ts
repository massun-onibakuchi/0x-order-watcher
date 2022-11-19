import express from 'express';
import { ethers } from 'ethers';
import ExpressPinoLogger from 'express-pino-logger';

import { LimitOrderFilledEventArgs, OrderCanceledEventArgs } from './types';
import { OrderWatcher } from './order_watcher';
import { getDBConnectionAsync } from './db_connection';
import { logger } from './logger';
import {
    RPC_URL,
    EXCHANGE_RPOXY,
    PORT,
    SYNC_INTERVAL,
    LOG_LEVEL,
    CHAIN_ID,
    LOG_PATH,
    POLLING_INTERVAL,
} from './config';
import * as fs from 'fs';

const expressPino = ExpressPinoLogger({
    logger,
    // https://github.com/pinojs/express-pino-logger
    // https://github.com/pinojs/express-pino-logger/issues/24
    // BUG: 何故かbodyがlogに出力されない
    // serializers: {
    //     req(req) {
    //         req.body = req.raw.body;
    //         return req;
    //     },
    // },
});
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
app.use(expressPino);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let orderWatcher: OrderWatcher;
if (require.main === module) {
    (async () => {
        const provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL);
        orderWatcher = await createOrderWatcher(provider, logger);
    })();
}

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
        req.log.info(req.body);
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

async function createOrderWatcher(provider: ethers.providers.JsonRpcProvider, logger: any) {
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
    const orderWatcher = new OrderWatcher(connection, provider);

    logger.info(`${RPC_URL} is connected. ZeroEx: ${EXCHANGE_RPOXY}`);
    logger.info('OrderWatcher is ready. LogLevel: ' + LOG_LEVEL);

    // ZeroEx INativeOrdersEvents
    const abi = [
        'event OrderCancelled(bytes32 orderHash, address maker)',
        'event LimitOrderFilled(bytes32 orderHash, address maker, address taker, address feeRecipient, address makerToken, address takerToken, uint128 takerTokenFilledAmount, uint128 makerTokenFilledAmount, uint128 takerTokenFeeFilledAmount, uint256 protocolFeePaid, bytes32 pool)',
    ];
    const zeroEx = new ethers.Contract(EXCHANGE_RPOXY, abi);

    // Set polling interval
    provider.pollingInterval = POLLING_INTERVAL;

    // NOTE: https://docs.ethers.io/v5/api/providers/types/#providers-Filter
    // NOTE: https://docs.ethers.io/v5/api/providers/types/#providers-Log
    // NOTE: https://docs.ethers.io/v5/concepts/events/#events--filters
    // subscribe LimitOrderFilled events from ZeroEx contract
    const orderFilledEventFilter = zeroEx.filters.LimitOrderFilled();
    provider.on(orderFilledEventFilter, (log) => {
        const filledOrderEvent = zeroEx.interface.parseLog(log).args as any as LimitOrderFilledEventArgs;
        setImmediate(
            async (blockNumber, transactionHash, filledOrderEvent: LimitOrderFilledEventArgs) => {
                // format
                // "filledOrder", date, orderHash, maker, taker, makerToken, takerToken, takerTokenFilledAmount, makerTokenFilledAmount, takerTokenFeeFilledAmount
                fs.appendFile(
                    LOG_PATH,
                    `filledOrder,${blockNumber},${formatDate(new Date())},${transactionHash},${filledOrderEvent.orderHash},${filledOrderEvent.maker},${filledOrderEvent.taker},${filledOrderEvent.makerToken},${filledOrderEvent.takerToken},${filledOrderEvent.takerTokenFilledAmount},${filledOrderEvent.makerTokenFilledAmount},${filledOrderEvent.takerTokenFeeFilledAmount}\n`, // prettier-ignore
                    (err) => {
                        if (err) {
                            logger.error(err);
                        }
                    },
                );
                logger.debug('filledOrderEvent: orderHash ' + filledOrderEvent.orderHash);
                await orderWatcher.updateFilledOrdersAsync([filledOrderEvent]);
            },
            log.blockNumber,
            log.transactionHash,
            filledOrderEvent,
        );
    });

    // subscribe OrderCancelled events from ZeroEx contract
    const orderCanceledEventFilter = zeroEx.filters.OrderCancelled();
    provider.on(orderCanceledEventFilter, (log) => {
        const canceledOrderEvent = zeroEx.interface.parseLog(log).args as any as OrderCanceledEventArgs;
        setImmediate(
            async (blockNumber, transactionHash, canceledOrderEvent: OrderCanceledEventArgs) => {
                // format
                // "canceledOrder", date, orderHash, maker
                fs.appendFile(
                    LOG_PATH,
                    `canceledOrder,${blockNumber},${formatDate(new Date())},${transactionHash},${canceledOrderEvent.orderHash},${canceledOrderEvent.maker}\n`, // prettier-ignore
                    (err) => {
                        if (err) {
                            logger.error(err);
                        }
                    },
                );
                await orderWatcher.updateCanceledOrdersByHashAsync([canceledOrderEvent.orderHash]);
                logger.debug('canceledOrderEvent: orderHash ' + canceledOrderEvent.orderHash);
            },
            log.blockNumber,
            log.transactionHash,
            canceledOrderEvent,
        );
    });

    return orderWatcher;
}
