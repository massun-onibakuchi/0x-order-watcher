import { ChainId } from '@0x/asset-swapper';
import { BigNumber } from '@0x/utils';

import { NULL_ADDRESS } from './constants';

// Log level for pino.js
export const LOG_LEVEL: string = process.env.LOG_LEVEL?.toLowerCase() ?? 'info';

export const DEFAULT_LOGGER_INCLUDE_TIMESTAMP = true;

// Should the logger include time field in the output logs, defaults to true.
export const LOGGER_INCLUDE_TIMESTAMP =
    process.env.LOGGER_INCLUDE_TIMESTAMP === 'true' ?? DEFAULT_LOGGER_INCLUDE_TIMESTAMP;

console.log(process.env.CHAIN_ID);

export const CHAIN_ID: ChainId = Number(process.env.CHAIN_ID) ?? ChainId.Ganache;

export const DEFAULT_LOCAL_RPC_URL = 'http://localhost:8545';

export const RPC_URL = process.env.RPC_URL || DEFAULT_LOCAL_RPC_URL;

export const EXCHANGE_RPOXY = process.env.EXCHANGE_RPOXY || '';

export const PORT = process.env.PORT || 8008;

// The fee recipient for orders
export const FEE_RECIPIENT_ADDRESS = NULL_ADDRESS;

// A flat fee that should be charged to the order taker
export const TAKER_FEE_UNIT_AMOUNT = new BigNumber(0);

export const META_TXN_RELAY_EXPECTED_MINED_SEC = 10;

// Ignore orders greater than x seconds when responding to SRA requests
export const SRA_ORDER_EXPIRATION_BUFFER_SECONDS: number = 10;

export const POSTGRES_URI = 'postgres://api:api@localhost/api';

export const PROTOCOL_FEE_MULTIPLIER = new BigNumber(0);

export const SYNC_INTERVAL: number = Number(process.env.SYNC_INTERVAL) || 2000;

export const POLLING_INTERVAL: number = Number(process.env.POLLING_INTERVAL) || 1000;

export const LOG_PATH: string = process.env.LOG_PATH || '../events.csv';

export interface Integrator {
    apiKeys: string[];
    integratorId: string;
    whitelistIntegratorUrls?: string[];
    label: string;
    plp: boolean;
    rfqm: boolean;
    rfqt: boolean;
    slippageModel?: boolean;
}

export type IntegratorsAcl = Integrator[];
