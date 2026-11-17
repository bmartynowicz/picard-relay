// Build-time geometry only. The browser animates two SVG surfaces with CSS.
export function landingStarfield(seed=0x50494341){
 let state=seed>>>0;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const occupied=new Set();
 const planes=[88,48].map((count,plane)=>{
  const groups=[[],[],[]];
  for(let i=0;i<count;i++){
   let x,y,key;
   do{
    x=Math.round(12+random()*976);y=Math.round(12+random()*976);
    // A loose diagonal star lane breaks up uniform noise; leave the headline quiet.
    if(i%3===0)y=Math.round(Math.max(12,Math.min(988,190+x*.53+(random()-.5)*290)));
    key=x+','+y;
   }while(occupied.has(key)||(x>320&&x<680&&y>300&&y<620&&random()<.55));
   occupied.add(key);
   groups[i%17===0?2:i%4===0?1:0].push('M'+x+' '+y+'h0.01');
  }
  const path=(points,color,width,opacity)=>'<path fill="none" stroke="'+color+'" stroke-width="'+width+'" stroke-opacity="'+opacity+'" stroke-linecap="round" vector-effect="non-scaling-stroke" d="'+points.join('')+'"/>';
  return '<svg class="space-plane space-plane-'+plane+'" id="space-plane-'+plane+'" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">'+
   path(groups[0],'#a7c5df',1,.72)+path(groups[1],'#d3e6f2',1.5,.86)+
   path(groups[2],'#fff0ce',5.5,.09)+path(groups[2],'#fff0ce',2.1,.95)+'</svg>';
 });
 return '<div id="space-scene" class="space-scene" aria-hidden="true">'+planes.join('')+'</div>';
}
