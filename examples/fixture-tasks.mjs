// Local deterministic demonstration. No provider, listener or external action.
import {createFixtureTaskExecutor} from '../experimental/runtime-control/src/adapters.mjs';
const executor=createFixtureTaskExecutor({enabledForLocalTestOnly:true,maxTasks:1});
const input={owner:'fixture-owner',task:'fixture-task',requestId:'fixture-request',invocationId:'fixture-request',attempt:1,requestText:JSON.stringify({v:1,operation:'count-words',text:'Small ship durable messages'})};
console.log((await executor.answer(input)).body);
console.log((await executor.answer({...input,attempt:2})).body);
console.log(`Executed ${executor.executedTasks} local fixture task; exact replay used the cached result. Production execution disabled.`);
