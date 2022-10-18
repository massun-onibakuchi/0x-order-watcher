import { Connection, In } from 'typeorm';
import { providers, ethers, BigNumber } from 'ethers';

import { orderUtils } from './utils/order_utils';
import { LimitOrderFilledEventArgs, SignedLimitOrder } from './types';
import { EXCHANGE_RPOXY } from './config';

import { SignedOrderV4Entity } from './entities';
import { logger } from './logger';
import NativeOrdersFeature from './abi/NativeOrdersFeature.json';
import { LimitOrderFields } from '@0x/protocol-utils';

export interface OrderWatcherInterface {
    postOrdersAsync(orders: SignedLimitOrder[]): Promise<void>;
    updateFilledOrdersAsync(events: LimitOrderFilledEventArgs[]): Promise<void>;
    updateCanceledOrdersByHashAsync(orderHashes: string[]): Promise<void>;
    syncFreshOrders(): Promise<void>;
}

enum OrderStatus {
    INVALID = 0,
    FILLABLE = 1,
    FILLED = 2,
    CANCELLED = 3,
    EXPIRED = 4,
}

export class OrderWatcher implements OrderWatcherInterface {
    private readonly _connection: Connection;
    private readonly _provider: providers.JsonRpcProvider;
    private readonly _zeroEx;

    constructor(connection: Connection, provider: providers.JsonRpcProvider) {
        this._connection = connection;
        this._provider = provider;
        this._zeroEx = new ethers.Contract(
            EXCHANGE_RPOXY,
            new ethers.utils.Interface(NativeOrdersFeature.abi),
            provider,
        ) as any;
    }

    /// @dev assume schema has already been validated.
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
        const orderEntities = await this._connection.manager.find(SignedOrderV4Entity, {
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

    /// @dev TODO: makerが十分な残高を持っているか, allowanceが十分か
    public async syncFreshOrders() {
        const orderEntities = await this._connection.manager.find(SignedOrderV4Entity);
        await this._syncFreshOrders(orderEntities);
    }

    private async _syncFreshOrders(orderEntities: SignedOrderV4Entity[]) {
        const [validOrders, invalidOrders, canceledOrders, expiredOrderEntities, filledOrders] =
            await this._filterFreshOrders(orderEntities.map((order) => orderUtils.deserializeOrder(order as any)));
        if (validOrders.length > 0) {
            await this._connection.getRepository(SignedOrderV4Entity).save(validOrders);
            logger.info(`sync orders: ${validOrders.reduce((acc, order) => `${order?.hash}, ${acc}`, '')}`);
        }
        const ordersRemove = invalidOrders.concat(canceledOrders, expiredOrderEntities, filledOrders);
        if (ordersRemove.length > 0) {
            await this._connection
                .getRepository(SignedOrderV4Entity)
                .delete(ordersRemove.map((order) => order.hash as any));
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
        const {
            orderInfos,
            actualFillableTakerTokenAmounts,
            isSignatureValids,
        }: {
            orderInfos: {
                orderHash: string;
                status: number;
                takerTokenFilledAmount: BigNumber;
            }[];
            actualFillableTakerTokenAmounts: BigNumber[];
            isSignatureValids: boolean[];
        } = await this._zeroEx.batchGetLimitOrderRelevantStates(limitOrders, signatures);

        isSignatureValids.forEach((isValidSig: Boolean, index) => {
            if (!isValidSig) {
                throw new Error(`invalid signature: ${orderInfos[index].orderHash}`);
            }
            const entity = orderUtils.serializeOrder({
                order: orders[index],
                metaData: {
                    orderHash: orderInfos[index].orderHash,
                    remainingFillableTakerAmount: actualFillableTakerTokenAmounts[index] as any,
                },
            });
            if (actualFillableTakerTokenAmounts[index].gt(0) && orderInfos[index].status === OrderStatus.FILLABLE) {
                validOrderEntities.push(entity);
            }

            // TODO: switch分にする??
            if (
                orderInfos[index].status === OrderStatus.INVALID ||
                (actualFillableTakerTokenAmounts[index].isZero() && orderInfos[index].status === OrderStatus.FILLABLE)
            ) {
                logger.info(
                    `order is not fillable: ${orderInfos[index].orderHash} status: ${
                        OrderStatus[orderInfos[index].status]
                    }`,
                );
                invalidOrderEntities.push(entity);
            } else if (orderInfos[index].status === OrderStatus.FILLED) {
                logger.info(
                    `order is filled: ${orderInfos[index].orderHash} status: ${OrderStatus[orderInfos[index].status]}`,
                );
                filledOrderEntities.push(entity);
            } else if (orderInfos[index].status === OrderStatus.CANCELLED) {
                logger.info(
                    `order is not fillable: ${orderInfos[index].orderHash} status: ${
                        OrderStatus[orderInfos[index].status]
                    }`,
                );
                canceledOrderEntities.push(entity);
            } else if (orderInfos[index].status === OrderStatus.EXPIRED) {
                logger.info(
                    `order is not fillable: ${orderInfos[index].orderHash} status: ${
                        OrderStatus[orderInfos[index].status]
                    }`,
                );
                expiredOrderEntities.push(entity);
            }
        });
        return [
            validOrderEntities,
            invalidOrderEntities,
            canceledOrderEntities,
            expiredOrderEntities,
            filledOrderEntities,
        ];
    }
}
