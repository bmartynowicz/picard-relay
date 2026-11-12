// Synthetic credential delivered on a private pipe, never CLI args or env.
import {readFileSync} from 'node:fs';
import {createAgentWorkspace} from '../../tools/workspace-agent.mjs';
import {serveWorkspaceMcp} from '../../tools/workspace-mcp.mjs';
import {WORKSPACE_AGENT_TOOLS,AGENT_INSTRUCTIONS} from '../../tools/workspace-agent-mcp.mjs';
const access=JSON.parse(readFileSync(3,'utf8'));
const client=createAgentWorkspace({origin:access.origin,readAccess:async()=>access});
await serveWorkspaceMcp({client,tools:WORKSPACE_AGENT_TOOLS,serverName:'picard-workspace-agent',instructions:AGENT_INSTRUCTIONS});
