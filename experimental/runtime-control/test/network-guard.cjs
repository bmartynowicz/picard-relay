const fs=require('node:fs');
const log=process.env.QUAL_GUARD_LOG;
const deny=(kind)=>function(){fs.appendFileSync(log,JSON.stringify({pid:process.pid,blocked:kind})+'\n');throw Error('QUALIFICATION_NETWORK_DENIED:'+kind);};
for(const [name,methods] of Object.entries({'node:net':['connect','createConnection'],'node:tls':['connect'],'node:http':['request','get'],'node:https':['request','get'],'node:http2':['connect'],'node:dgram':['createSocket'],'node:dns':['lookup','resolve','resolve4','resolve6','reverse']})){const m=require(name);for(const k of methods)m[k]=deny(name+'.'+k);}
require('node:net').Socket.prototype.connect=deny('Socket.connect');
require('node:net').Server.prototype.listen=deny('Server.listen');
for(const k of ['lookup','resolve','resolve4','resolve6','reverse'])require('node:dns').promises[k]=deny('dns.promises.'+k);
globalThis.fetch=deny('fetch');globalThis.WebSocket=deny('WebSocket');
const cp=require('node:child_process'),spawn=cp.spawn;
cp.spawn=function(file,args,options={}){if((file!=='node'&&file!==process.execPath)||(!args||!args.length||String(args[0]).startsWith('-')))return deny('unexpected-child')();const env=options.env||process.env;if(env.NODE_OPTIONS!==process.env.NODE_OPTIONS||env.QUAL_GUARD_LOG!==log)return deny('child-guard-missing')();return spawn.call(this,file,args,options);};
for(const k of ['exec','execSync','execFile','execFileSync','spawnSync','fork'])cp[k]=deny('child_process.'+k);
require('node:module').syncBuiltinESMExports();
