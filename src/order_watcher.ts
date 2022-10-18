import { LimitOrder } from '@0x/protocol-utils';
import { Connection, In, LessThanOrEqual, MoreThan } from 'typeorm';
import { BigNumber, providers, ethers } from 'ethers';

import { orderUtils } from './utils/order_utils';
import { LimitOrderFilledEventArgs, SignedLimitOrder } from './types';
import { EXCHANGE_RPOXY, SRA_ORDER_EXPIRATION_BUFFER_SECONDS, SYNC_INTERVAL } from './config';

import { SignedOrderV4Entity } from './entities';
import { logger } from './logger';
import NativeOrdersFeature from './abi/NativeOrdersFeature.json';

export interface OrderWatcherInterface {
    postOrdersAsync(orders: SignedLimitOrder[]): Promise<void>;
    updateFilledOrdersAsync(events: LimitOrderFilledEventArgs[]): Promise<void>;
    updateCanceledOrdersByHashAsync(orderHashes: string[]): Promise<void>;
    syncFreshOrders(): Promise<void>;
}

const BN = BigNumber.from;

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
    private readonly _zeroEx: any;

    constructor(connection: Connection, provider: providers.JsonRpcProvider) {
        this._connection = connection;
        this._provider = provider;
        this._zeroEx = new ethers.Contract(
            EXCHANGE_RPOXY,
            new ethers.utils.Interface(NativeOrdersFeature.abi),
            provider,
        );
    }

    /// @dev assume schema has already been validated.
    public async postOrdersAsync(orders: SignedLimitOrder[]): Promise<void> {
        // validate whether orders are valid format.
        const [validOrders, invalidOrders] = await this.filterFreshOrders(orders);

        if (invalidOrders.length > 0) {
            throw new Error(`invalid orders: ${JSON.stringify(invalidOrders)}`);
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
        const [validOrders, invalidOrders] = await this.filterFreshOrders(
            orderEntities.map((order) => orderUtils.deserializeOrder(order as Required<SignedOrderV4Entity>)),
        );
        if (validOrders.length > 0) {
            await this._connection.getRepository(SignedOrderV4Entity).save(validOrders);
            logger.info(`sync orders: ${validOrders.reduce((acc, order) => `${order?.hash}, ${acc}`, '')}`);
        }
        if (invalidOrders.length > 0) {
            await this._connection
                .getRepository(SignedOrderV4Entity)
                .delete(invalidOrders.map((order) => order.hash as any));
            logger.info(`remove orders: ${validOrders.reduce((acc, order) => `${order?.hash}, ${acc}`, '')}`);
        }
    }

    /// @dev orderが無効ならエラーを投げる
    ///  - 有効期限が切れていないか
    ///  - chainIdが正しいか
    ///  - verifyingContractが正しいZeroExProxyのアドレスか
    ///  - 署名が正しいか
    ///  - makerが十分な残高を持っているか, allowanceが十分か zeroExに問い合わせる
    private async filterFreshOrders(orders: SignedLimitOrder[]) {
        const limitOrders = [];
        const signatures = [];
        const validOrderEntities: SignedOrderV4Entity[] = [];
        const invalidOrderEntities: SignedOrderV4Entity[] = [];

        for (const order of orders) {
            const { signature, ...limitOrder } = order;
            limitOrders.push(limitOrder);
            signatures.push(signature);
        }
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
        // NOTE: XXX
        // order-watcherにbugある可能性
        // eventsとtrades.csvで同じorderHashが繰り返し出てくる
        // TODO: order-watcher動くか？
        // TODO: amaterasu_clientにcanceled_orderを管理するキューを作ったので機能しているか確認する
        // TODO: 約定した注文をキューに入れる
        isSignatureValids.forEach((isValidSig: Boolean, index) => {
            if (!isValidSig) {
                throw new Error(`invalid signature: ${orderInfos[index].orderHash}`);
            }
            if (actualFillableTakerTokenAmounts[index].gt(0) && orderInfos[index].status === OrderStatus.FILLABLE) {
                validOrderEntities.push(
                    orderUtils.serializeOrder({
                        order: orders[index],
                        metaData: {
                            orderHash: orderInfos[index].orderHash,
                            remainingFillableTakerAmount: actualFillableTakerTokenAmounts[index] as any,
                        },
                    }),
                );
            } else {
                invalidOrderEntities.push(
                    orderUtils.serializeOrder({
                        order: orders[index],
                        metaData: {
                            orderHash: orderInfos[index].orderHash,
                            remainingFillableTakerAmount: BN(0) as any,
                        },
                    }),
                );
            }
        });
        return [validOrderEntities, invalidOrderEntities];
    }
}
