// Fixed launcher outside replaceable source. No dynamic shell commands.
import {lstat,readlink} from 'node:fs/promises';
const ROOT='/usr/local/lib/board-event-relay';
const s=await lstat(ROOT+'/current');if(!s.isSymbolicLink()||s.uid!==0)throw Error('unsafe_current');
const target=await readlink(ROOT+'/current');if(!/^releases\/[a-f0-9]{64}$/.test(target))throw Error('invalid_current');
process.env.BRIDGE_RELEASE_HASH=target.slice(9);
process.env.BRIDGE_CONTROL_SOCKET='/var/lib/board-event-relay/control.sock';
const {main}=await import(`${ROOT}/${target}/src/oracle-service.mjs`);await main();
