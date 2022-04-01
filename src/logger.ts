import fs from 'fs';
import { exec } from 'child_process';
import { Console } from 'console';

import config from './config';

const { accessLogPath, activityLogPath, errorLogPath } = config.logging;

if (accessLogPath) {
  console.log(`REST access log redirected to ${accessLogPath}`);
}
if (activityLogPath) {
  console.log(`Output redirected to ${activityLogPath}`);
}
if (errorLogPath) {
  console.log(`Errors redirected to ${errorLogPath}`);
}

function createAccessLogWriteStream(): fs.WriteStream | null {
  if (!accessLogPath) {
    return null;
  }
  return fs.createWriteStream(accessLogPath, { flags: 'a' });
}

function createConsoleLogger(): Console {
  return new Console({
    stdout: activityLogPath
      ? fs.createWriteStream(activityLogPath, { flags: 'a' })
      : process.stdout,
    stderr: errorLogPath
      ? fs.createWriteStream(errorLogPath, { flags: 'a' })
      : process.stderr,
  });
}

let accessLogWriteStream = createAccessLogWriteStream();
let consoleLogger = createConsoleLogger();

/**
 * Returns true if the given file was trimmed.
 */
function trimLog(
  path: string,
  maxSizeInBytes = 50 * 1024 * 1024, // 50MB,
  linesToRemove = 10000,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    try {
      const stats = fs.statSync(path);
      if (stats.size <= maxSizeInBytes) {
        return resolve(false);
      }
      console.log(
        `Trimming log file ${path} was ${stats.size} wants ${maxSizeInBytes}`,
      );
      exec(`sed -i '1,${linesToRemove}d' ${path}`, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve(true);
        }
      });
    } catch (e) {
      return resolve(false);
    }
  });
}

export async function trimLogs(): Promise<void> {
  const results = await Promise.all(
    [activityLogPath, errorLogPath]
      .filter((path) => !!path)
      .map(async (path) => trimLog(path)),
  );
  // Writes to the existing stream fail after trimming; reopen it
  if (results.some((wasTrimmed) => wasTrimmed)) {
    consoleLogger = createConsoleLogger();
  }
  if (accessLogPath && (await trimLog(accessLogPath))) {
    try {
      accessLogWriteStream?.destroy();
    } catch (e) {
      // ignore
    }
    accessLogWriteStream = createAccessLogWriteStream();
  }
}

export const logger = {
  access: (message: string): void => {
    if (!accessLogWriteStream) {
      return;
    }
    accessLogWriteStream.write(message);
  },
  error: (...messages: unknown[]): void => consoleLogger.error(...messages),
  info: (...messages: unknown[]): void => consoleLogger.info(...messages),
};
