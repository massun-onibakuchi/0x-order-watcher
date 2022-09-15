import { BigNumber } from '@0x/utils';

export const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
export const NULL_BYTES = '0x';
export const ZRX_DECIMALS = 18;
export const MAINNET_EXCHANGE_RPORXY = '0xdef1c0ded9bec7f1a1670819833240f027b25eff';
export const DEFAULT_PAGE = 1;
export const DEFAULT_PER_PAGE = 20;
export const ZERO = new BigNumber(0);
export const ONE = new BigNumber(1);
export const MAX_TOKEN_SUPPLY_POSSIBLE = new BigNumber(2).pow(256);
export const DEFAULT_LOCAL_POSTGRES_URI = 'postgres://api:api@localhost/api';
export const DEFAULT_LOGGER_INCLUDE_TIMESTAMP = true;
export const ONE_SECOND_MS = 1000;
export const ONE_MINUTE_MS = ONE_SECOND_MS * 60;
export const ONE_HOUR_MS = ONE_MINUTE_MS * 60;
export const TEN_MINUTES_MS = ONE_MINUTE_MS * 10;
export const DEFAULT_VALIDATION_GAS_LIMIT = 10e6;
export const HEX_BASE = 16;

// Logging
export const NUMBER_SOURCES_PER_LOG_LINE = 12;

// General cache control
export const DEFAULT_CACHE_AGE_SECONDS = 13;

// Number of base points in 1
export const ONE_IN_BASE_POINTS = 10000;
