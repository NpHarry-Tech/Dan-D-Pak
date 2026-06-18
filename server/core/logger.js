const LEVELS = ['debug', 'info', 'warn', 'error'];

function shouldLog(level) {
  const configured = process.env.LOG_LEVEL || 'info';
  return LEVELS.indexOf(level) >= LEVELS.indexOf(configured);
}

function write(level, message, meta) {
  if (!shouldLog(level)) return;
  const line = {
    time: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

export const logger = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};
