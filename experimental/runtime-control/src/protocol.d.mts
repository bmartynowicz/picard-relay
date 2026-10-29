export type ProtocolConfig={keyId:string;secret:string};
export class ProtocolError extends Error{code:string;constructor(code:string);}
export function digest(text:string):Promise<string>;
export function canonical(value:unknown):string;
export function payloadHash(payload:unknown):Promise<string>;
export function validateWork(payload:unknown):Promise<WorkPayload>;
export type WorkPayload={v:1;eventId:string;ownerId:string;taskId:string;requestId:string;grantId:string;assistantId:string;grantExpiresAt:number;payloadHash:string;request:{text:string;createdAt:string;answerTo:string|null};context:{title:string;nextAction:string;latestFinding:string}};
export function validConfig(c:unknown):c is ProtocolConfig;
export function boundedBody(message:Request|Response,max?:number):Promise<string>;
export function signRequest(url:string,payload:unknown,c:ProtocolConfig,now?:number):Promise<{nonce:string;request:Request}>;
export function verifyRequest(request:Request,c:ProtocolConfig,consumeNonce:(nonce:string,expires:number)=>boolean|Promise<boolean>,now?:number):Promise<{payload:unknown;nonce:string}>;
export function signedResponse(payload:unknown,status:number,nonce:string,c:ProtocolConfig):Promise<Response>;
export function verifyResponse(response:Response,nonce:string,c:ProtocolConfig):Promise<unknown>;
