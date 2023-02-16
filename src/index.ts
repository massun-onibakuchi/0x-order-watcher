import express from 'express';
import { ethers } from 'ethers';
import ExpressPinoLogger from 'express-pino-logger';

import { RPC_URL, PORT, SYNC_INTERVAL, POLLING_INTERVAL } from './config';
import { getDBConnectionAsync } from './db_connection';
import { OrderWatcher, createOrderWatcher } from './order_watcher';
import { logger } from './logger';
import {performance as pf} from 'perf_hooks'

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

// creates an Express application.
const app = express();
app.use(expressPino);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let orderWatcher: OrderWatcher;
if (require.main === module) {
    (async () => {
        // db is shared among 0x-api and 0x-order-watcher
        const dbConnection = await getDBConnectionAsync();
        const provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL);
        provider.pollingInterval = POLLING_INTERVAL;
        orderWatcher = await createOrderWatcher(dbConnection, provider, logger);
    })().then(() => {
        // periodically remove expired orders from DB
        const timerId = setInterval(async (ow) => {
            logger.debug('start syncing unfilled orders...');
            const startTime = pf.now()
            try {
                await ow.syncFreshOrders();
            } catch (error) {
                logger.error(error);
            }
            const endTime = pf.now()
            logger.info(`syncFreshOrders execution time: ${endTime - startTime}`)
        }, SYNC_INTERVAL, orderWatcher);

        app.post('/ping', function (req, res) {
            res.json({ msg: 'pong, Got a POST request' });
        });

        // receive POST request from 0x-api `POST orderbook/v1/order`.
        app.post('/orders', async function (req: express.Request, res) {
            try {
                req.log.info(req.body);

                // save orders to DB
                const startPost = pf.now()
                await orderWatcher.postOrdersAsync(req.body);
                const endPost = pf.now()
                logger.info(`postOrdersAsync execution time: ${endPost - startPost}`)

                res.status(200).json();
            } catch (err) {
                logger.error(err);
                res.status(500).json({ error: err.message });
            }
        });

        app.listen(PORT, () => console.log(`app listening on port ${PORT} !`));
    });
}

process.on('uncaughtException', (err) => {
    logger.error(err);
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    if (err) {
        logger.error(err);
    }
});
