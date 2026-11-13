// Build from the actual console, without its authentication or API scripts.
import fs from 'node:fs';
import {CONSOLE_HTML} from '../../experimental/runtime-control/src/oracle-service.mjs';

const styles=[...CONSOLE_HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n');
const mark=CONSOLE_HTML.match(/<span class="logo rank-logo"[\s\S]*?<\/svg><\/span>/)?.[0];
const scene=CONSOLE_HTML.match(/<div id="space-scene"[\s\S]*?<\/div>/)?.[0];
if(!styles||!mark||!scene)throw Error('console_assets_missing');
fs.writeFileSync(new URL('./console.css',import.meta.url),styles+'\n');
fs.writeFileSync(new URL('./console-parts.json',import.meta.url),JSON.stringify({mark,scene})+'\n');
let icon=mark.match(/<svg class="insignia-front"[\s\S]*?<\/svg>/)[0].replace('<svg class="insignia-front"','<svg xmlns="http://www.w3.org/2000/svg"');
for(const [key,color] of Object.entries({'metal-shine':'#fff0c6','metal-mid':'#c39b52','metal-light':'#e5c87d','metal-shadow':'#5e4623'}))icon=icon.replaceAll('var(--'+key+')',color);
fs.writeFileSync(new URL('./mark.svg',import.meta.url),icon+'\n');
console.log('Actual console styles, 3D insignia and starfield prepared. No provider calls.');
