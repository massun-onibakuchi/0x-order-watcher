import { ConnectionOptions } from 'typeorm';

const POSTGRES_URI = process.env.POSTGRES_URI;
const POSTGRES_READ_REPLICA_URIS: string[] = [];

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
    migrations: ['./lib/migrations/*.js'],
    ...(POSTGRES_READ_REPLICA_URIS
        ? {
              replication: {
                  master: { url: POSTGRES_URI },
                  slaves: POSTGRES_READ_REPLICA_URIS.map((r) => ({ url: r })),
              },
          }
        : { url: POSTGRES_URI }),
    cli: {
        migrationsDir: 'migrations',
    },
};
module.exports = config;
