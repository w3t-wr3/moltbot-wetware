import type { Sandbox } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { getR2BucketName } from '../config';
import { withTimeout } from './utils';

const RCLONE_CONF_PATH = '/root/.config/rclone/rclone.conf';
const CONFIGURED_FLAG = '/tmp/.rclone-configured';
const EXEC_TIMEOUT_MS = 10_000;

/**
 * Ensure rclone is configured in the container for R2 access.
 * Idempotent — checks for a flag file to skip re-configuration.
 *
 * @returns true if rclone is configured, false if credentials are missing
 */
export async function ensureRcloneConfig(sandbox: Sandbox, env: MoltbotEnv): Promise<boolean> {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.CF_ACCOUNT_ID) {
    console.log(
      'R2 storage not configured (missing R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, or CF_ACCOUNT_ID)',
    );
    return false;
  }

  try {
    const check = await withTimeout(
      sandbox.exec(`test -f ${CONFIGURED_FLAG} && echo yes || echo no`),
      EXEC_TIMEOUT_MS,
      'rclone config check',
    );
    if (check.stdout?.trim() === 'yes') {
      return true;
    }
  } catch (e) {
    console.error('Failed to check rclone config:', e);
    return false;
  }

  const rcloneConfig = [
    '[r2]',
    'type = s3',
    'provider = Cloudflare',
    `access_key_id = ${env.R2_ACCESS_KEY_ID}`,
    `secret_access_key = ${env.R2_SECRET_ACCESS_KEY}`,
    `endpoint = https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    'acl = private',
    'no_check_bucket = true',
  ].join('\n');

  try {
    await withTimeout(
      sandbox.exec(`mkdir -p $(dirname ${RCLONE_CONF_PATH})`),
      EXEC_TIMEOUT_MS,
      'rclone mkdir',
    );
    await withTimeout(sandbox.writeFile(RCLONE_CONF_PATH, rcloneConfig), EXEC_TIMEOUT_MS, 'rclone writeFile');
    await withTimeout(sandbox.exec(`touch ${CONFIGURED_FLAG}`), EXEC_TIMEOUT_MS, 'rclone touch flag');
    console.log('Rclone configured for R2 bucket:', getR2BucketName(env));
    return true;
  } catch (e) {
    console.error('Failed to configure rclone:', e);
    return false;
  }
}
