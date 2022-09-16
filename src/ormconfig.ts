import { ConnectionOptions } from 'typeorm';
import { POSTGRES_URI } from './config';

import {
    KeyValueEntity,
    OrderWatcherSignedOrderEntity,
    PersistentSignedOrderEntity,
    PersistentSignedOrderV4Entity,
    SignedOrderV4Entity,
    TransactionEntity,
} from './entities';

const entities = [
    PersistentSignedOrderEntity,
    TransactionEntity,
    KeyValueEntity,
    SignedOrderV4Entity,
    PersistentSignedOrderV4Entity,
    OrderWatcherSignedOrderEntity,
];

const config: ConnectionOptions = {
    type: 'postgres',
    entities,
    synchronize: false,
    logging: true,
    logger: 'debug',
    extra: {
        max: 15,
        statement_timeout: 10000,
    },
    url: POSTGRES_URI,
};
module.exports = config;
