import {readFile,writeFile} from 'node:fs/promises';
const manifest=await readFile('release-output/manifest.json'),bundle=await readFile('release-output/bundle.json'),proof=await readFile('release-output/manifest.sigstore.json');
if(proof.length>65536)throw Error('sigstore_bundle_too_large');JSON.parse(proof);
const envelope=JSON.stringify({format:2,manifest:manifest.toString('base64'),sigstoreBundle:proof.toString('base64'),bundle:bundle.toString('base64')});if(Buffer.byteLength(envelope)>3*1024*1024)throw Error('envelope_too_large');await writeFile('release-output/stable.json',envelope);
