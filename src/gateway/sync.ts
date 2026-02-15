import type { Sandbox } from '@cloudflare/sandbox';
import type { MoltbotEnv } from '../types';
import { getR2BucketName } from '../config';
import { ensureRcloneConfig } from './r2';
import { withTimeout } from './utils';

const EXEC_TIMEOUT_MS = 10_000;
const SYNC_TIMEOUT_MS = 120_000;

export interface SyncResult {
  success: boolean;
  lastSync?: string;
  error?: string;
  details?: string;
}

const RCLONE_FLAGS = '--transfers=16 --fast-list --s3-no-check-bucket';
const LAST_SYNC_FILE = '/tmp/.last-sync';

function rcloneRemote(env: MoltbotEnv, prefix: string): string {
  return `r2:${getR2BucketName(env)}/${prefix}`;
}

/**
 * Detect which config directory exists in the container.
 */
async function detectConfigDir(sandbox: Sandbox): Promise<string | null> {
  const check = await withTimeout(
    sandbox.exec(
      'test -f /root/.openclaw/openclaw.json && echo openclaw || ' +
        '(test -f /root/.clawdbot/clawdbot.json && echo clawdbot || echo none)',
    ),
    EXEC_TIMEOUT_MS,
    'sync: detectConfigDir',
  );
  const result = check.stdout?.trim();
  if (result === 'openclaw') return '/root/.openclaw';
  if (result === 'clawdbot') return '/root/.clawdbot';
  return null;
}

/**
 * Sync OpenClaw config and workspace from container to R2 for persistence.
 * Uses rclone for direct S3 API access (no FUSE mount overhead).
 */
export async function syncToR2(sandbox: Sandbox, env: MoltbotEnv): Promise<SyncResult> {
  if (!(await ensureRcloneConfig(sandbox, env))) {
    return { success: false, error: 'R2 storage is not configured' };
  }

  const configDir = await detectConfigDir(sandbox);
  if (!configDir) {
    return {
      success: false,
      error: 'Sync aborted: no config file found',
      details: 'Neither openclaw.json nor clawdbot.json found in config directory.',
    };
  }

  const remote = (prefix: string) => rcloneRemote(env, prefix);

  // Sync config (rclone sync propagates deletions)
  const configResult = await withTimeout(
    sandbox.exec(
      `rclone sync ${configDir}/ ${remote('openclaw/')} ${RCLONE_FLAGS} --exclude='*.lock' --exclude='*.log' --exclude='*.tmp' --exclude='.git/**'`,
      { timeout: 120000 },
    ),
    SYNC_TIMEOUT_MS,
    'sync: rclone config',
  );
  if (!configResult.success) {
    return {
      success: false,
      error: 'Config sync failed',
      details: configResult.stderr?.slice(-500),
    };
  }

  // Sync workspace (non-fatal, rclone sync propagates deletions)
  await withTimeout(
    sandbox.exec(
      `test -d /root/clawd && rclone sync /root/clawd/ ${remote('workspace/')} ${RCLONE_FLAGS} --exclude='skills/**' --exclude='.git/**' || true`,
      { timeout: 120000 },
    ),
    SYNC_TIMEOUT_MS,
    'sync: rclone workspace',
  );

  // Sync skills (non-fatal)
  await withTimeout(
    sandbox.exec(
      `test -d /root/clawd/skills && rclone sync /root/clawd/skills/ ${remote('skills/')} ${RCLONE_FLAGS} || true`,
      { timeout: 120000 },
    ),
    SYNC_TIMEOUT_MS,
    'sync: rclone skills',
  );

  // Write timestamp
  await withTimeout(sandbox.exec(`date -Iseconds > ${LAST_SYNC_FILE}`), EXEC_TIMEOUT_MS, 'sync: write timestamp');
  const tsResult = await withTimeout(sandbox.exec(`cat ${LAST_SYNC_FILE}`), EXEC_TIMEOUT_MS, 'sync: read timestamp');
  const lastSync = tsResult.stdout?.trim();

  return { success: true, lastSync };
}
