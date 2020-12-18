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

const trimLog = async function trimLog(
  filename: string,
  maxSizeInBytes = 50 * 1024 * 1024, // 50MB,
  linesToRemove = 10000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const stats = fs.statSync(filename);
      if (stats.size <= maxSizeInBytes) {
        return resolve();
      }
      console.log(
        `Trimming log file ${filename} was ${stats.size} wants ${maxSizeInBytes}`,
      );
      exec(`sed -i '1,${linesToRemove}d' ${filename}`, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    } catch (e) {
      return resolve();
    }
  });
};

export const trimLogs = async function trimLogs(): Promise<void | void[]> {
  return Promise.all(
    [accessLogPath, activityLogPath, errorLogPath]
      .filter((filename) => !!filename)
      .map((l) => trimLog(l)),
  );
};

export const logger = new Console({
  stdout: activityLogPath
    ? fs.createWriteStream(activityLogPath)
    : process.stdout,
  stderr: errorLogPath ? fs.createWriteStream(errorLogPath) : process.stderr,
});
