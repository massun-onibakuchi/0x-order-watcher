import { ChainId } from '@0x/asset-swapper';
import { nativeWrappedTokenSymbol } from '@0x/token-metadata';
import { BigNumber } from '@0x/utils';

import { DEFAULT_LOCAL_POSTGRES_URI, NULL_ADDRESS } from './constants';
/**
 * A taker-integrator of the 0x API.
 */
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

// Log level for pino.js
export const LOG_LEVEL: string = process.env.LOG_LEVEL ?? 'info';

export const DEFAULT_LOGGER_INCLUDE_TIMESTAMP = true;

// Should the logger include time field in the output logs, defaults to true.
export const LOGGER_INCLUDE_TIMESTAMP =
    process.env.LOGGER_INCLUDE_TIMESTAMP === 'true' ?? DEFAULT_LOGGER_INCLUDE_TIMESTAMP;

// Number of milliseconds of inactivity the servers waits for additional
// incoming data aftere it finished writing last response before a socket will
// be destroyed.
// Ref: https://nodejs.org/api/http.html#http_server_keepalivetimeout
export const HTTP_KEEP_ALIVE_TIMEOUT = 76 * 1000;

// Limit the amount of time the parser will wait to receive the complete HTTP headers.
// NOTE: This value HAS to be higher than HTTP_KEEP_ALIVE_TIMEOUT.
// Ref: https://nodejs.org/api/http.html#http_server_headerstimeout
export const HTTP_HEADERS_TIMEOUT = 77 * 1000;

export const DEFAULT_CHAIN_ID: ChainId = ChainId.Ganache;

export const CHAIN_ID: ChainId = Number(process.env.CHAIN_ID) ?? DEFAULT_CHAIN_ID;

export const DEFAULT_LOCAL_WS_RPC_URL = 'wss://localhost:8545';

export const WS_RPC_URL = process.env.WS_RPC_URL || DEFAULT_LOCAL_WS_RPC_URL;

export const DEFAULT_LOCAL_RPC_URL = 'http://localhost:8545';

export const RPC_URL = process.env.RPC_URL || DEFAULT_LOCAL_RPC_URL;

export const EXCHANGE_RPOXY = process.env.EXCHANGE_RPOXY || '';

export const PORT = process.env.PORT || 8008;

// Timeout in seconds to wait for an RPC request (default 5000)
export const RPC_REQUEST_TIMEOUT = 5000;

// The fee recipient for orders
export const FEE_RECIPIENT_ADDRESS = NULL_ADDRESS;

// A flat fee that should be charged to the order taker
export const TAKER_FEE_UNIT_AMOUNT = new BigNumber(0);

// If there are any orders in the orderbook that are expired by more than x seconds, log an error
export const MAX_ORDER_EXPIRATION_BUFFER_SECONDS: number = 3 * 60;

export const META_TXN_RELAY_EXPECTED_MINED_SEC = 10;

// Ignore orders greater than x seconds when responding to SRA requests
export const SRA_ORDER_EXPIRATION_BUFFER_SECONDS: number = 10;

export const POSTGRES_URI = DEFAULT_LOCAL_POSTGRES_URI;

export const PROTOCOL_FEE_MULTIPLIER = new BigNumber(0);

export const NATIVE_WRAPPED_TOKEN_SYMBOL = nativeWrappedTokenSymbol(CHAIN_ID);

export const SYNC_INTERVAL: number = Number(process.env.SYNC_INTERVAL) || SRA_ORDER_EXPIRATION_BUFFER_SECONDS * 2000
