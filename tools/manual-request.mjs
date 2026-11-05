#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {createManualIntent,validateManualIntent,createManualClient,ManualClientError} from './manual-client.mjs';
import {readPrivateFile,writePrivateNew,createPrivateJournal,loadOperatorProfile,nativeRelayTransport} from './manual-node.mjs';
export async function waitForResult({receipt,intent,client,waitMs,now=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 if(!Number.isSafeInteger(waitMs)||waitMs<0||waitMs>60000)throw new ManualClientError('usage');
 const until=now()+waitMs;
 while(['queued','claimed','invoking'].includes(receipt.state)&&now()<until){
  // Node truncates fractional timer delays. Round up and reserve a complete
  // millisecond before starting a read rather than polling on the final tick.
  await sleep(Math.ceil(Math.min(1000,until-now())));
  const remaining=until-now();if(remaining<1)break;
  const signal=AbortSignal.timeout(Math.max(1,Math.ceil(remaining)));
  try{receipt=await client.result(intent,{signal});}catch(error){if(signal.aborted)return {...receipt,polling:'deadline_reached'};throw error;}
 }
 return receipt;
}
export async function main(args=process.argv.slice(2)){
 const command=args.shift(),options={};if(!['prepare','submit','result'].includes(command))throw new ManualClientError('usage');
 const allowed=command==='prepare'?['gate','request-id','out']:['config','origin','intent','journal','wait-ms'];
 while(args.length){const flag=args.shift();if(!flag.startsWith('--')||!allowed.includes(flag.slice(2))||Object.hasOwn(options,flag.slice(2))||!args.length)throw new ManualClientError('usage');options[flag.slice(2)]=args.shift();}
 if(command==='prepare'){
  if(!options.gate||!options['request-id']||!options.out||process.platform!=='linux')throw new ManualClientError('usage');
  const intent=await createManualIntent({gate:JSON.parse(readPrivateFile(options.gate,{maxBytes:16384})),requestId:options['request-id']});writePrivateNew(options.out,JSON.stringify(intent)+'\n');console.log(JSON.stringify({state:'intent_prepared_no_submission',eventId:intent.payload.eventId,payloadHash:intent.payload.payloadHash,path:options.out}));return;
 }
 if(!options.config||!options.origin||!options.intent||!options.journal)throw new ManualClientError('usage');
 const wait=options['wait-ms']===undefined?0:Number(options['wait-ms']);if(!Number.isSafeInteger(wait)||wait<0||wait>60000)throw new ManualClientError('usage');
 const intent=JSON.parse(readPrivateFile(options.intent,{maxBytes:24576})),profile=loadOperatorProfile(options.config,options.origin);
 await validateManualIntent(intent,profile.config,{requireActiveGate:false}); // identity/origin before reading HMAC
 const journal=createPrivateJournal(options.journal),client=createManualClient({config:{...profile.config,secret:profile.readHmacSecret()},transport:nativeRelayTransport,journal});
 let receipt=await client[command](intent);
 receipt=await waitForResult({receipt,intent,client,waitMs:wait});
 await journal.record(intent.payload.eventId,receipt);console.log(JSON.stringify({eventId:intent.payload.eventId,...receipt}));if(['failed','uncertain','blocked','cancelled'].includes(receipt.state))process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify({state:'stopped_no_retry',code:error instanceof ManualClientError?error.code:'client_unavailable',noAutomaticResubmission:true}));process.exitCode=1;});
