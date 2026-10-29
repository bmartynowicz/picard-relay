import fs from 'node:fs';
import {createRelayStore} from '../src/relay-store.mjs';
const[mode,path,raw,clock]=process.argv.slice(2),now=Number(clock),store=createRelayStore({dbPath:path,now:()=>now});
if(mode==='seed'){await store.accept(JSON.parse(fs.readFileSync(raw,'utf8')));store.close();process.exit(0);}
const claim=store.claimNext({workerId:mode+'-'+process.pid,claimTtlMs:1000});
if(mode==='claim'){console.log(JSON.stringify({claimed:!!claim}));store.close();process.exit(0);}
if(!claim)throw Error('Expected a claim');
store.startInvocation({requestId:claim.event_id,attempt:claim.attempt,workerId:claim.claimed_by});
if(mode==='result')store.appendReply({owner:claim.owner,task:claim.task,requestId:claim.event_id,attempt:claim.attempt,workerId:claim.claimed_by,eventId:`resp:${claim.event_id}`,kind:'answer',outcomeKind:'information',body:'Durable isolated result',statusChange:null});
// Abrupt process exit, deliberately no close/markCompleted.
process.exit(mode==='result'?77:78);
