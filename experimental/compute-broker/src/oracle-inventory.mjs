import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { integer, object } from './policy.mjs';

// Fixed read-only probe: no caller command, code, URL, environment or remote path.
export const ORACLE_PROBE = `import json,os,platform,shutil,urllib.request
request=urllib.request.Request('http://169.254.169.254/opc/v2/instance/',headers={'Authorization':'Bearer Oracle'})
with urllib.request.urlopen(request,timeout=2) as response: metadata=json.load(response)
with open('/proc/meminfo') as source: memory=dict(line.split(':',1) for line in source)
disk=shutil.disk_usage('/')
print(json.dumps({'shape':metadata.get('shape'),'region':metadata.get('region'),'availabilityDomain':metadata.get('availabilityDomain'),'architecture':platform.machine(),'logicalCpus':os.cpu_count(),'memoryTotalBytes':int(memory['MemTotal'].split()[0])*1024,'memoryAvailableBytes':int(memory['MemAvailable'].split()[0])*1024,'diskTotalBytes':disk.total,'diskFreeBytes':disk.free}))
`;

export function oracleProbePlan(profile) {
  if (!object(profile) || Object.keys(profile).some(key => !['hostname', 'username', 'identityFile', 'knownHostsFile', 'sshExecutable'].includes(key))
    || typeof profile.hostname !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,252}$/.test(profile.hostname)
    || typeof profile.username !== 'string' || !/^[a-z_][a-z0-9_-]{0,31}$/.test(profile.username)
    || !['identityFile', 'knownHostsFile', 'sshExecutable'].every(key => typeof profile[key] === 'string'
      && profile[key].length <= 4096 && isAbsolute(profile[key]) && !/[\r\n"\0]/.test(profile[key])))
    throw Error('invalid_oracle_profile');
  const hosts = profile.knownHostsFile.replaceAll('\\', '/');
  return { command: profile.sshExecutable, args: ['-F', process.platform === 'win32' ? 'NUL' : '/dev/null',
    '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile="${hosts}"`,
    '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes',
    '-o', 'ConnectionAttempts=1', '-o', 'ConnectTimeout=5', '-i', profile.identityFile,
    `${profile.username}@${profile.hostname}`, '/usr/bin/python3 -'], input: ORACLE_PROBE };
}

function executeProbe(plan) {
  return new Promise((resolve, reject) => {
    const child = spawn(plan.command, plan.args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', bytes = 0, stopped = false;
    const timer = setTimeout(() => { stopped = true; child.kill(); }, 8000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk); if (bytes > 16_384) { stopped = true; child.kill(); } else output += chunk;
    });
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(Error('oracle_inventory_unavailable')); });
    child.on('close', code => { clearTimeout(timer);
      if (code !== 0 || stopped) reject(Error('oracle_inventory_unavailable')); else resolve(output);
    });
    child.stdin.end(plan.input);
  });
}

export async function observeOracle(profile, { runProbe = executeProbe, now = Date.now } = {}) {
  if (profile === null || profile === undefined) return { provider: 'oracle', configured: false,
    readOnly: true, dispatchEnabled: false, note: 'No private Oracle SSH profile configured.' };
  const plan = oracleProbePlan(profile);
  let data;
  try {
    const text = await runProbe(plan);
    if (typeof text !== 'string' || Buffer.byteLength(text) > 16_384) throw Error();
    data = JSON.parse(text);
  } catch { throw Error('oracle_inventory_unavailable'); }
  if (!object(data) || data.shape !== 'VM.Standard.E2.1.Micro' || data.architecture !== 'x86_64'
    || typeof data.region !== 'string' || !/^[a-z0-9-]{1,40}$/.test(data.region)
    || typeof data.availabilityDomain !== 'string' || !/^[a-zA-Z0-9:-]{1,80}$/.test(data.availabilityDomain)
    || !['logicalCpus', 'memoryTotalBytes', 'memoryAvailableBytes', 'diskTotalBytes', 'diskFreeBytes'].every(key => integer(data[key], 1))
    || data.logicalCpus > 128 || data.memoryAvailableBytes > data.memoryTotalBytes || data.diskFreeBytes > data.diskTotalBytes)
    throw Error('invalid_oracle_inventory');
  return { provider: 'oracle', configured: true, readOnly: true, dispatchEnabled: false, observedAt: now(),
    resource: { shape: data.shape, architecture: 'x64', region: data.region, availabilityDomain: data.availabilityDomain,
      observedCapacity: { logicalCpus: data.logicalCpus, memoryTotalBytes: data.memoryTotalBytes,
        memoryAvailableBytes: data.memoryAvailableBytes, diskTotalBytes: data.diskTotalBytes, diskFreeBytes: data.diskFreeBytes } },
    costVerification: 'unknown', accountQuota: null,
    note: 'OS capacity is not an account entitlement, scheduling reservation or billing check. No cloud executor is enrolled.' };
}

// One SSH probe per MCP process even when several clients ask at once.
export function createOracleObserver(profile, options) {
  let active;
  return () => {
    if (!active) active = observeOracle(profile, options).finally(() => { active = undefined; });
    return active;
  };
}
