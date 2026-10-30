// Unprivileged network step. Nothing downloaded here is trusted until root verifies.
import {lstat,open,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {readHttps,releaseUrl} from './pull.mjs';
const ROOT='/var/lib/picard-updater-inbox';
const s=await lstat(ROOT);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))throw Error('unsafe_inbox_directory');
const bytes=await readHttps(releaseUrl('https://raw.githubusercontent.com/bmartynowicz/picard-relay/main/releases/stable.json'));
const temp=ROOT+'/.fetch-'+randomUUID();
try{const h=await open(temp,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}await rename(temp,ROOT+'/stable.json');console.log(JSON.stringify({state:'downloaded_unverified',bytes:bytes.length}));}finally{await unlink(temp).catch(()=>{});}
