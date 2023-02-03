import { pino } from 'pino';

import { LOGGER_INCLUDE_TIMESTAMP, LOG_LEVEL } from './config';

export const logger = pino({
    formatters: {
        level: (label) => ({
            level: label,
        }),
    },
    transports: {
        target: 'pino/file',
        options: {
            destination: 'logs/out.log',
            mkdir: true,
        },
    },
    level: LOG_LEVEL,
    timestamp: LOGGER_INCLUDE_TIMESTAMP,
});
