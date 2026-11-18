import fs from 'node:fs';
import {createRelayStore} from '../src/relay-store.mjs';
import {createDispatcher} from '../src/dispatcher.mjs';
const[mode,path,raw,clock]=process.argv.slice(2),now=Number(clock),store=createRelayStore({dbPath:path,now:()=>now});
if(mode==='seed'){await store.accept(JSON.parse(fs.readFileSync(raw,'utf8')));store.close();process.exit(0);}
if(mode==='accepted'||mode==='save-full'){
 const boardAdapter={
  getTaskContext:store.getTaskContext,
  appendReply(){
   if(mode!=='save-full')throw Error('The child should have exited before this boundary');
   throw Object.assign(Error('Injected result save failure'),{code:'ENOSPC'});
  },
 };
 const assistantAdapter={kind:'offline-provider-fixture',async answer(input){
  // Track the provider separately from the relay so a restart cannot reset the count.
  fs.appendFileSync(path+'.provider.jsonl',JSON.stringify({requestId:input.invocationId})+'\n',{flush:true});
  if(mode==='accepted')process.exit(79);
  return {...input,eventId:'resp:'+input.requestId,kind:'answer',outcomeKind:'information',body:'Unsaved fixture answer'};
 }};
 const result=await createDispatcher({store,boardAdapter,assistantAdapter,enabled:true,claimTtlMs:1000}).runOnce();
 store.close();
 console.log(JSON.stringify({status:result.status}));
 process.exit(0);
}
const claim=store.claimNext({workerId:mode+'-'+process.pid,claimTtlMs:1000});
if(mode==='claim'){console.log(JSON.stringify({claimed:!!claim}));store.close();process.exit(0);}
if(!claim)throw Error('Expected a claim');
store.startInvocation({requestId:claim.event_id,attempt:claim.attempt,workerId:claim.claimed_by});
if(mode==='result')store.appendReply({owner:claim.owner,task:claim.task,requestId:claim.event_id,attempt:claim.attempt,workerId:claim.claimed_by,eventId:`resp:${claim.event_id}`,kind:'answer',outcomeKind:'information',body:'Durable isolated result',statusChange:null});
// Abrupt process exit, deliberately no close/markCompleted.
process.exit(mode==='result'?77:78);
