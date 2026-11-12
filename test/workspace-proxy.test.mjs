import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// A route-contract regression for the disabled deployment example, not a
// replacement Caddy implementation. Native adaptation is a separate check.
const template=readFileSync(new URL('../deploy/Caddyfile.workspace.example',import.meta.url),'utf8').replace(/#.*$/gm,'');
function blocks(pattern){
 const result=new Map();for(const match of template.matchAll(pattern)){
  const start=match.index+match[0].length;let depth=1,end=start;
  for(;end<template.length&&depth;end++){if(template[end]==='{')depth++;else if(template[end]==='}')depth--;}
  assert.equal(depth,0);result.set(match[1],template.slice(start,end-1));
 }return result;
}
const selectors=blocks(/^ {4}@([A-Za-z0-9]+) \{/gm),handlers=blocks(/^ {4}handle @([A-Za-z0-9]+) \{/gm);
function matches(method,path){
 return [...selectors].filter(([,body])=>{
  const methods=/^\s*method (.+)$/m.exec(body)?.[1].trim().split(/\s+/);
  if(!methods?.includes(method))return false;
  const paths=/^\s*path (.+)$/m.exec(body)?.[1].trim().split(/\s+/);
  const regex=/^\s*path_regexp \w+ (.+)$/m.exec(body)?.[1].trim();
  return paths?.includes(path)||(regex&&new RegExp(regex).test(path));
 }).map(([name])=>name);
}
const id='12345678-1234-4567-89ab-123456789abc',ref='a'.repeat(64);
test('proxy example explicitly covers workspace reads, writes and owner-only client operations',()=>{
 const cases=[
  ...['config','history','clients'].map(p=>['GET','/workspace/'+p,'workspaceRead']),
  ['GET','/workspace/drafts/'+id,'workspaceResult'],['GET','/workspace/requests/'+ref,'workspaceResult'],
  ...['drafts','approvals','requests','clients','client-approvals'].map(p=>['POST','/workspace/'+p,'workspaceWrite']),
  ...['reviews','grades'].map(p=>['POST','/workspace/'+p+'/'+ref,'workspaceRecord']),
  ['POST','/workspace/clients/'+id+'/revoke','workspaceRecord']
 ];
 for(const [method,path,name] of cases){
  assert.deepEqual(matches(method,path),[name],method+' '+path);
  const handler=handlers.get(name);assert.match(handler,/reverse_proxy 127\.0\.0\.1:8787(?:\s|$)/);
  assert.doesNotMatch(handler,/header_up\s+-?(?:Authorization|Cookie|Origin)\b/i);
  if(method==='POST')assert.match(handler,/max_size 24KB/);
 }
 // Existing non-workspace endpoints retain their original route boundaries.
 for(const [method,path,name] of [['GET','/status','read'],['GET','/requests/'+ref,'result'],['POST','/auth/login','write'],['POST','/bridge/v1','write']])assert.deepEqual(matches(method,path),[name]);
 assert.match(template,/handle \{\s*respond 404\s*\}/);
});
test('proxy example refuses unlisted workspace methods, malformed IDs and path suffixes',()=>{
 for(const [method,path] of [
  ['GET','/workspace/approvals'],['GET','/workspace/clients/'+id+'/revoke'],['POST','/workspace/config'],
  ['POST','/workspace/drafts/'+id],['POST','/workspace/requests/'+ref],['PATCH','/workspace/clients'],
  ['POST','/workspace/clients/not-a-uuid/revoke'],['POST','/workspace/clients/'+id+'/revoke/extra'],
  ['POST','/workspace/clients/'+id.replace('-4567','-1567')+'/revoke'],
  ['GET','/workspace/requests/'+ref+'/extra'],['GET','/workspace/admin']
 ])assert.deepEqual(matches(method,path),[],method+' '+path);
});
