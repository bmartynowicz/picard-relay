// Public artifact builder: only reviewed browser assets and the sharing image leave the source tree.
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function buildLanding({outputDir,sourceSha=null}){
 if(sourceSha!==null&&!/^[a-f0-9]{40}$/.test(sourceSha))throw Error('landing_source_sha');
 const output=resolve(outputDir);
 await mkdir(output,{recursive:true});
 if((await readdir(output)).length)throw Error('landing_output_not_empty');
 const read=name=>readFile(new URL('./'+name,import.meta.url),'utf8');
 const parts=JSON.parse(await read('console-parts.json'));
 let html=(await read('index.html')).replace('<!-- PICARD_MARK -->',parts.mark).replace('<!-- PICARD_SCENE -->',parts.scene);
 if(html.includes('<!-- PICARD_'))throw Error('landing_unresolved_template');
 for(const asset of ['mark.svg','console.css','landing.css','landing.js'])html=html.replaceAll('"/'+asset+'"','"./'+asset+'"');
 html=html.replace('Local setup concept · no connected relay','Your server. Your workspace.');
 // Pages cannot supply custom response headers. The supported static policies live in HTML.
 html=html.replace('<head>','<head>\n<meta name="referrer" content="no-referrer">\n<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\'; img-src \'self\'; connect-src https://picard-relay.141-148-50-78.sslip.io; base-uri \'none\'; form-action \'none\'">');
 const assets={
  'index.html':html,
  'console.css':await read('console.css'),
  'landing.css':(await read('landing.css')).replaceAll("url('/mark.svg')","url('./mark.svg')"),
  'landing.js':(await read('landing.js')).replace("from './setup-flow.mjs'","from './setup-flow.js'").replace("from './learning-guide.mjs'","from './learning-guide.js'").replace("from './public-test.mjs'","from './public-test.js'"),
  'setup-flow.js':await read('setup-flow.mjs'),
  'learning-guide.js':await read('learning-guide.mjs'),
  'public-test.js':(await read('public-test.mjs')).replace("from './learning-guide.mjs'","from './learning-guide.js'"),
  'mark.svg':await read('mark.svg'),
  'social-preview.png':await readFile(new URL('./social-preview.png',import.meta.url)),
  '.nojekyll':''
 };
 const files=Object.fromEntries(Object.entries(assets).map(([name,value])=>[name,{bytes:Buffer.byteLength(value),sha256:createHash('sha256').update(value).digest('hex')}]));
 assets['build.json']=JSON.stringify({schemaVersion:1,sourceSha,files},null,2)+'\n';
 for(const [name,value] of Object.entries(assets))await writeFile(resolve(output,name),value,'utf8');
 return {output,sourceSha,files,totalBytes:Object.values(assets).reduce((sum,text)=>sum+Buffer.byteLength(text),0)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 console.log(JSON.stringify(await buildLanding({outputDir:process.argv[2]??'dist/landing',sourceSha:process.argv[3]??null}),null,2));
}
