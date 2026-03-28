import pino from 'pino';

export function createLogger(level: string = 'info'): pino.Logger {
  return pino({
    level,
    transport: {
      target: 'pino/file',
      options: { destination: 2 }, // stderr — stdout is reserved for MCP JSON-RPC
    },
  });
}

export type Logger = pino.Logger;
