// Synthetic session supplied only by this test launcher, never a production option.
import {createReadOnlyWorkspace} from '../../tools/workspace-readonly.mjs';
import {serveWorkspaceMcp} from '../../tools/workspace-mcp.mjs';
const origin=process.argv[2];
const client=createReadOnlyWorkspace({origin,readSession:async()=>({v:1,origin,cookie:'__Host-PicardSession='+'A'.repeat(43),expiresAt:Date.now()+3600000})});
await serveWorkspaceMcp({client});
