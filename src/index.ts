import express from 'express';
import { ethers } from 'ethers';

import { LimitOrderFilledEventArgs, OrderCanceledEventArgs, SignedLimitOrder } from './types';
import { OrderWatcher } from './order_watcher';
import { getDBConnectionAsync } from './db_connection';
import { logger } from './logger';
import { RPC_URL, EXCHANGE_RPOXY, PORT, SRA_ORDER_EXPIRATION_BUFFER_SECONDS, LOG_LEVEL } from './config';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// NOTE: WebSocketProvider : https://docs.ethers.io/v5/api/providers/ws-provider/
// const wsProvider = new ethers.providers.WebSocketProvider(WS_RPC_URL);

const provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL);
const EXHANGE_PROXY_ABI = [
    // "event Transfer(address indexed src, address indexed dst, uint val)", // For testing purposes
    'event OrderCancelled(bytes32 orderHash, address maker)',
    'event LimitOrderFilled(bytes32 orderHash, address maker, address taker, address feeRecipient, address makerToken, address takerToken, uint128 takerTokenFilledAmount, uint128 makerTokenFilledAmount, uint128 takerTokenFeeFilledAmount, uint256 protocolFeePaid, bytes32 pool)',
];
const zeroEx = new ethers.Contract(EXCHANGE_RPOXY, new ethers.utils.Interface(EXHANGE_PROXY_ABI), provider);

let orderWatcher: OrderWatcher;
if (require.main === module) {
    (async () => {
        const connection = await getDBConnectionAsync();
        orderWatcher = new OrderWatcher(connection);

        logger.info(`${RPC_URL} is connected. ZeroEx: ${EXCHANGE_RPOXY}`);
        if (!ethers.utils.isAddress(EXCHANGE_RPOXY)) {
            throw new Error(`Invalid ZeroEx Address: ${EXCHANGE_RPOXY}`);
        }
        logger.info('OrderWatcher is ready. LogLevel: ' + LOG_LEVEL);
    })().catch((err) => console.error(err.stack));
}

const orderFilledEventFilter = zeroEx.filters.LimitOrderFilled();
provider.on(orderFilledEventFilter, (log) => {
    const filledOrderEvent = zeroEx.interface.parseLog(log).args as any as LimitOrderFilledEventArgs;

    setImmediate(async (filledOrderEvent: LimitOrderFilledEventArgs) => {
        logger.debug('filledOrderEvent :>> ', filledOrderEvent);
        await orderWatcher.updateFilledOrdersAsync([filledOrderEvent]);
    }, filledOrderEvent);
});

const orderCanceledEventFilter = zeroEx.filters.OrderCancelled();
provider.on(orderCanceledEventFilter, (log) => {
    const canceledOrderEvent = zeroEx.interface.parseLog(log).args as any as OrderCanceledEventArgs;

    setImmediate(async (canceledOrderEvent: OrderCanceledEventArgs) => {
        logger.debug('canceledOrderEvent :>> ', canceledOrderEvent);
        await orderWatcher.updateCanceledOrdersByHashAsync([canceledOrderEvent.orderHash]);
    }, canceledOrderEvent);
});

const timerId = setInterval(async () => {
    logger.debug('start syncing unfilled orders...');
    try {
        await orderWatcher.syncFreshOrders();
    } catch (error) {
        logger.error(error);
    }
}, SRA_ORDER_EXPIRATION_BUFFER_SECONDS * 2000);

app.post('/ping', function (req, res) {
    res.json({ msg: 'pong, Got a POST request' });
});

app.post('/orders', function (req: express.Request, res) {
    logger.debug(req.body);
    try {
        validateOrders(req.body);
    } catch (err) {
        res.status(500).json();
        logger.info(err);
        return;
    }
    orderWatcher.postOrdersAsync(req.body);
    res.status(200).json();
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

function validateOrders(orders: SignedLimitOrder[]) {
    // orderが有効化どうかをチェックする
    // - 署名が正しいか
    // - 有効期限が切れていないか
    // - makerが十分な残高を持っているか
    // - verifyingContractが正しいZeroExProxyのアドレスか
    const ok = true;
    if (!ok) {
        throw new Error('Invalid order: Reason');
    }
}
