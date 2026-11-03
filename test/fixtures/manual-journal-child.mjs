import fs from 'node:fs';
import {createPrivateJournal} from '../../tools/manual-node.mjs';
const [dir,input]=process.argv.slice(2);
try{console.log(JSON.stringify(await createPrivateJournal(dir).reserve(JSON.parse(fs.readFileSync(input,'utf8')))));}
catch(e){if(!['journal_invalid','private_file_invalid','private_file_changed'].includes(e.code))throw e;console.log(JSON.stringify({created:false,stopped:true,code:e.code}));}
