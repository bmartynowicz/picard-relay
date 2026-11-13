// Navigation only. No probing, credentials, installation or remote requests.
export function relayAddress(value){
 const url=new URL(value.trim());
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('relay_address');
 return url.origin+'/#overview';
}
