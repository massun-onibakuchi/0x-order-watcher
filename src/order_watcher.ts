import { Connection, In } from 'typeorm';
import { ethers, BigNumber } from 'ethers';
import { LimitOrderFields } from '@0x/protocol-utils';
import fs from 'fs';
import { Logger } from 'pino';

import { CHAIN_ID, EXCHANGE_PROXY, LOG_PATH } from './config';
import { orderUtils } from './utils/order_utils';
import { formatDate } from './utils/formatDate';
import { LimitOrderFilledEventArgs, SignedLimitOrder, OrderCanceledEventArgs } from './types';
import { SignedOrderV4Entity } from './entities';
import { logger } from './logger';
import NativeOrdersFeature from './abi/NativeOrdersFeature.json';

export interface OrderWatcherInterface {
    postOrdersAsync(orders: SignedLimitOrder[]): Promise<void>;
    updateFilledOrdersAsync(events: LimitOrderFilledEventArgs[]): Promise<void>;
    updateCanceledOrdersByHashAsync(orderHashes: string[]): Promise<void>;
    syncFreshOrders(): Promise<void>;
}

enum OrderStatus {
    INVALID = 0,
    // 約定可能
    FILLABLE = 1,
    // 完全約定済み
    FILLED = 2,
    CANCELLED = 3,
    EXPIRED = 4,
}

export class OrderWatcher implements OrderWatcherInterface {
    private readonly _connection: Connection;
    private readonly _zeroEx: ethers.Contract;
    private readonly _chunkSize = 200;

    constructor(connection: Connection, exchangeContract: ethers.Contract) {
        this._connection = connection;
        this._zeroEx = exchangeContract;
    }

    /// @dev assume schema has already been validated.
    /// @notice 0xAPIのmaker注文提出API(POST orderbook/v1/order)が叩かれたときに呼ばれる。
    public async postOrdersAsync(orders: SignedLimitOrder[]): Promise<void> {
        // validate whether orders are valid format.
        const [validOrders, invalidOrders, canceledOrders, expiredOrders, filledOrders] = await this._filterFreshOrders(
            orders,
        ).catch((e) => {
            logger.error(`error:`, e);
            throw e;
        });

        if (invalidOrders.length > 0) {
            throw new Error(`invalid orders ${JSON.stringify(invalidOrders)}`);
        }
        if (canceledOrders.length > 0) {
            // logger.warn(`canceled orders ${JSON.stringify(canceledOrders)}`);
            throw new Error(`canceled orders ${JSON.stringify(canceledOrders)}`);
        }
        if (expiredOrders.length > 0) {
            throw new Error(`expired orders ${JSON.stringify(expiredOrders)}`);
        }
        if (filledOrders.length > 0) {
            throw new Error(`already fully filled orders ${JSON.stringify(filledOrders)}`);
        }
        // Saves all given entities in the database. If entities do not exist in the database then inserts, otherwise updates.
        await this._connection.getRepository(SignedOrderV4Entity).save(validOrders);
    }

    /// @dev
    /// if remainingFillableTakerAmountが0なら完全約定であるので削除する
    /// else 部分約定とみなして、remainingFillableTakerAmountを更新
    public async updateFilledOrdersAsync(events: LimitOrderFilledEventArgs[]): Promise<void> {
        const orderEntities = await this._connection.getRepository(SignedOrderV4Entity).find({
            where: {
                hash: In(events.map((event) => event.orderHash)),
            },
        });
        if (orderEntities.length > 0) {
            await this._syncFreshOrders(orderEntities);
        }
    }

    public async updateCanceledOrdersByHashAsync(orderHashes: string[]): Promise<void> {
        await this._connection.getRepository(SignedOrderV4Entity).delete(orderHashes);
    }

    /// @dev DB内のmaker注文を最新の状態に同期する。
    public async syncFreshOrders() {
        const orderEntities = await this._connection.getRepository(SignedOrderV4Entity).find();
        const promises = [];

        // NOTE: `chunkSize`件ずつに分割して処理する
        // entityの数が多すぎるとzeroExで注文ステータスを取得するリクエストが失敗する
        const length = orderEntities.length;
        for (let i = 0; i < length; i += this._chunkSize) {
            // NOTE: sliceはend がシーケンスの長さを超えた場合も シーケンスの最後 (arr.length) までを取り出す
            promises.push(this._syncFreshOrders(orderEntities.slice(i, i + this._chunkSize)));
        }
        await Promise.all(promises);
    }

    /// @dev DB内のmaker注文を最新の状態に同期する。
    /// @notice orderEntities 長さが一定を超えるとZeroExへのRPCリクエストがcalldata大きすぎのため失敗する
    private async _syncFreshOrders(orderEntities: SignedOrderV4Entity[]) {
        logger.debug(`_syncFreshOrders param: orderEntities:>> ${orderEntities}`);
        const [validOrders, invalidOrders, canceledOrders, expiredOrderEntities, filledOrders] =
            await this._filterFreshOrders(orderEntities.map((order) => orderUtils.deserializeOrder(order as any)));

        // update valid orders
        if (validOrders.length > 0) {
            await this._connection.getRepository(SignedOrderV4Entity).save(
                validOrders.map((order) => {
                    return {
                        hash: order.hash,
                        // 約定可能残量を更新する
                        remainingFillableTakerAmount: order.remainingFillableTakerAmount,
                    };
                }),
            );
            logger.info(`sync orders: ${validOrders.reduce((acc, order) => `${order?.hash}, ${acc}`, '')}`);
        }

        // remove orders
        const ordersRemove = invalidOrders.concat(canceledOrders, expiredOrderEntities, filledOrders);
        logger.debug(`target remove invalidOrders: ${invalidOrders.reduce((acc, order) => `${order?.hash}, ${acc}`, '')}`);
        logger.debug(`target remove canceledOrders: ${canceledOrders.reduce((acc, order) => `${order?.hash}, ${acc}`, '')}`);
        logger.debug(`target remove filledOrders: ${filledOrders.reduce((acc, order) => `${order?.hash}, ${acc}`, '')}`);
        logger.debug(`target remove orders: ${ordersRemove.reduce((acc, order) => `${order?.hash}, ${acc}`, '')}`);
        if (ordersRemove.length > 0) {
            await this._connection.getRepository(SignedOrderV4Entity).remove(ordersRemove);
            logger.info(`remove orders: ${validOrders.reduce((acc, order) => `${order?.hash}, ${acc}`, '')}`);
        }
    }

    /// @dev orderが無効ならエラーを投げる
    ///  - 有効期限が切れていないか
    ///  - chainIdが正しいか
    ///  - verifyingContractが正しいZeroExProxyのアドレスか
    ///  - 署名が正しいか
    ///  - makerが十分な残高を持っているか, allowanceが十分か zeroExに問い合わせる
    private async _filterFreshOrders(orders: SignedLimitOrder[]) {
        const limitOrders: LimitOrderFields[] = [];
        const signatures = [];
        const validOrderEntities: SignedOrderV4Entity[] = [];
        const invalidOrderEntities: SignedOrderV4Entity[] = [];
        const filledOrderEntities: SignedOrderV4Entity[] = [];
        const canceledOrderEntities: SignedOrderV4Entity[] = [];
        const expiredOrderEntities: SignedOrderV4Entity[] = [];

        // split orders into limitOrders and signatures
        for (const order of orders) {
            // logger.debug(`SignedLimitOrder[i]:>> ${JSON.stringify(order, null)}`);
            const { signature, ...limitOrder } = order;
            signatures.push(signature);
            limitOrders.push({
                ...limitOrder,
                makerAmount: limitOrder.makerAmount.toString() as any,
                takerAmount: limitOrder.takerAmount.toString() as any,
                takerTokenFeeAmount: limitOrder.takerTokenFeeAmount.toString() as any,
                expiry: limitOrder.expiry.toString() as any,
                salt: limitOrder.salt.toString() as any,
            });
        }

        // query orders status
        /// @param orders The limit orders.
        /// @param signatures The order signatures.
        /// @return orderInfos Info about the orders.
        /// @return actualFillableTakerTokenAmounts How much of each order is fillable
        ///         based on maker funds, in taker tokens.
        /// @return isSignatureValids Whether each signature is valid for the order.
        const orderStates: {
            orderInfos: {
                orderHash: string;
                status: number;
                takerTokenFilledAmount: BigNumber;
            }[];
            actualFillableTakerTokenAmounts: BigNumber[];
            isSignatureValids: boolean[];
        } = await this._zeroEx.batchGetLimitOrderRelevantStates(limitOrders, signatures);

        for (let i = 0; i < orderStates.orderInfos.length; i++) {
            const _info = orderStates.orderInfos[i];
            const _actualFillableTakerTokenAmount = orderStates.actualFillableTakerTokenAmounts[i];
            const _isSigValid = orderStates.isSignatureValids[i];

            const entity = orderUtils.serializeOrder({
                order: orders[i],
                metaData: {
                    orderHash: _info.orderHash,
                    remainingFillableTakerAmount: _actualFillableTakerTokenAmount as any,
                },
            });

            logger.info(
                `order is ${OrderStatus[_info.status]} hash: ${_info.orderHash} takerTokenFilledAmount: ${_info.takerTokenFilledAmount} actualFillableTakerTokenAmount: ${_actualFillableTakerTokenAmount} isSigValid: ${_isSigValid}`,
            );
            // Orderのステータスで処理を分岐させる
            // 無効なものを先に弾く
            switch (_info.status) {
                case OrderStatus.EXPIRED:
                    expiredOrderEntities.push(entity);
                    break;
                case OrderStatus.CANCELLED:
                    // NOTE: CANCELLEDの注文は、_actualFillableTakerTokenAmount == 0. そのためInvalidよりも先nに処理する
                    canceledOrderEntities.push(entity);
                    break;
                case OrderStatus.FILLED:
                    filledOrderEntities.push(entity);
                    break;
                case OrderStatus.INVALID:
                    if (!_isSigValid) {
                        logger.info(`order is invalid signature: ${_info.orderHash}`);
                    }
                    invalidOrderEntities.push(entity);
                    break;
                case OrderStatus.FILLABLE:
                    // NOTE: FILLABLEの注文は、_actualFillableTakerTokenAmountが0より大きいとは限らない
                    // makerの残高やallowanceが足りない場合は、_actualFillableTakerTokenAmountが0になる。(ZeroExのコード確認済み)
                    // その場合は、約定できないのでinvalidとして扱い、DBに保存しない.
                    const orderEntities = (_actualFillableTakerTokenAmount.gt(0)) ? validOrderEntities : invalidOrderEntities
                    orderEntities.push(entity);
                    break;
                default:
                    // NOTE: ここには来ないはず
                    logger.warn(`Can't catch order: hash ${_info.orderHash}`);
                    break;
            }
        }
        logger.debug(`_filterFreshOrders returns: validOrderEntities:>> ${validOrderEntities} `);
        logger.debug(`_filterFreshOrders returns: invalidOrderEntities:>> ${invalidOrderEntities} `);
        logger.debug(`_filterFreshOrders returns: canceledOrderEntities:>> ${canceledOrderEntities} `);
        logger.debug(`_filterFreshOrders returns: expiredOrderEntities:>> ${expiredOrderEntities} `);
        logger.debug(`_filterFreshOrders returns: filledOrderEntities:>> ${filledOrderEntities} `);
        return [
            validOrderEntities,
            invalidOrderEntities,
            canceledOrderEntities,
            expiredOrderEntities,
            filledOrderEntities,
        ];
    }
}

export async function createOrderWatcher(
    connection: Connection,
    provider: ethers.providers.JsonRpcProvider,
    logger: Logger,
) {
    const { chainId } = await provider.getNetwork();
    if (chainId !== CHAIN_ID) {
        throw new Error(`Invalid ChainId: ${CHAIN_ID}!= ${chainId} `);
    }
    if (!ethers.utils.isAddress(EXCHANGE_PROXY)) {
        throw new Error(`Invalid ZeroEx Address: ${EXCHANGE_PROXY} `);
    }
    if ((await provider.getCode(EXCHANGE_PROXY)) == '0x') {
        throw new Error(`ZeroEx is not deployed: ${EXCHANGE_PROXY} `);
    }

    const exchangeContract = new ethers.Contract(
        EXCHANGE_PROXY,
        new ethers.utils.Interface(NativeOrdersFeature.abi),
        provider,
    );

    const orderWatcher = new OrderWatcher(connection, exchangeContract);

    logger.info(`${provider.connection.url} is connected.ZeroEx: ${exchangeContract.address} `);
    logger.info('OrderWatcher is ready. LogLevel: ' + logger.level);

    const eventLogPath = LOG_PATH;

    // NOTE: https://docs.ethers.io/v5/api/providers/types/#providers-Filter
    // NOTE: https://docs.ethers.io/v5/api/providers/types/#providers-Log
    // NOTE: https://docs.ethers.io/v5/concepts/events/#events--filters
    // subscribe LimitOrderFilled events from ZeroEx contract
    const orderFilledEventFilter = exchangeContract.filters.LimitOrderFilled();
    provider.on(orderFilledEventFilter, async (log) => {
        const filledOrderEvent = exchangeContract.interface.parseLog(log).args as any as LimitOrderFilledEventArgs;
        // fs.appendFile(
        //     eventLogPath,
        //     `filledOrder, ${log.blockNumber},${formatDate(new Date())},${log.transactionHash},${filledOrderEvent.orderHash},${filledOrderEvent.maker},${filledOrderEvent.taker},${filledOrderEvent.makerToken},${filledOrderEvent.takerToken},${filledOrderEvent.takerTokenFilledAmount},${filledOrderEvent.makerTokenFilledAmount},${filledOrderEvent.takerTokenFeeFilledAmount} \n`, // prettier-ignore
        //     (err) => {
        //         if (err) {
        //             logger.error(err);
        //         }
        //     },
        // );
        logger.debug('filledOrderEvent: orderHash ' + filledOrderEvent.orderHash);
        await orderWatcher.updateFilledOrdersAsync([filledOrderEvent]);
    });

    // subscribe OrderCancelled events from ZeroEx contract
    const orderCanceledEventFilter = exchangeContract.filters.OrderCancelled();
    provider.on(orderCanceledEventFilter, async (log) => {
        const canceledOrderEvent = exchangeContract.interface.parseLog(log).args as any as OrderCanceledEventArgs;
        // fs.appendFile(
        //     eventLogPath,
        //     `canceledOrder, ${log.blockNumber},${formatDate(new Date())},${log.transactionHash},${canceledOrderEvent.orderHash},${canceledOrderEvent.maker} \n`, // prettier-ignore
        //     (err) => {
        //         if (err) {
        //             logger.error(err);
        //         }
        //     },
        // );
        await orderWatcher.updateCanceledOrdersByHashAsync([canceledOrderEvent.orderHash]);
        logger.debug('canceledOrderEvent: orderHash ' + canceledOrderEvent.orderHash);
    });

    return orderWatcher;
};
