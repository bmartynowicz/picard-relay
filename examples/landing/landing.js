import {relayAddress} from './setup-flow.mjs';
import {createGuideState,mountGuide} from './learning-guide.mjs';
import {mountPublicTest} from './public-test.mjs';

const root=document.querySelector('#console-surface'),panel=document.querySelector('#landing-panel'),welcome=document.querySelector('#welcome'),content=document.querySelector('#panel-content'),heading=document.querySelector('#panel-title');
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
const titles={overview:['Your workspace','The cockpit is yours.'],jobs:['Jobs','Follow the work.'],requests:['Requests','Start with something useful.'],groq:['Groq','Your Free project.'],system:['System','Small machine. Your control.'],setup:['01 / Server','Give your relay a home.'],install:['02 / Install','Bring Picard online.'],connect:['03 / Connect','Step into your relay.']};
titles.guide=['Interactive guide','Try one request.'];
titles.trial=['Live relay trial','Test the relay.'];
const guideState=createGuideState();
let current=null,opener=null,paused=false,transition=Promise.resolve(),closeTrial=null;
function motion(){root.dataset.motion=paused||reduce.matches||document.hidden?'off':'on';document.querySelector('#motion').textContent=reduce.matches?'Reduced motion':paused?'Resume motion':'Pause motion';document.querySelector('#motion').disabled=reduce.matches;document.querySelector('#motion').setAttribute('aria-pressed',String(paused));}
document.querySelector('#motion').addEventListener('click',()=>{paused=!paused;motion();});
document.querySelector('#stars-toggle').addEventListener('click',event=>{const enabled=root.dataset.starfield!=='true';root.dataset.starfield=String(enabled);event.currentTarget.setAttribute('aria-pressed',String(enabled));});
document.addEventListener('visibilitychange',motion);reduce.addEventListener('change',motion);

function markControls(){document.querySelectorAll('[data-panel]').forEach(button=>{const selected=button.dataset.panel===current||button.dataset.panel==='guide'&&current==='trial';button.setAttribute('aria-expanded',String(selected));if(button.closest('nav'))button.setAttribute('aria-current',selected?'page':'false');});}
async function animate(frames){if(reduce.matches||paused||document.hidden)return;const animation=panel.animate(frames,{duration:160,easing:'cubic-bezier(.2,.8,.25,1)'});try{await animation.finished;}catch{}finally{animation.cancel();}}
function pivot(button){const source=button.getBoundingClientRect(),box=panel.getBoundingClientRect();panel.style.setProperty('--origin-x',(source.left+source.width/2-box.left)+'px');panel.style.setProperty('--origin-y',(source.top+source.height/2-box.top)+'px');}
async function change(view,button){
 closeTrial?.();closeTrial=null;
 if(current){panel.inert=true;await animate([{transform:'none',opacity:1},{transform:'scale(.3,.12)',opacity:0}]);}
 if(current===view||view===null){panel.hidden=true;panel.inert=false;current=null;root.dataset.panelOpen='false';root.dataset.lessonOpen='false';welcome.inert=false;markControls();if(opener?.isConnected)opener.focus({preventScroll:true});else document.querySelector('#hud-next').focus({preventScroll:true});return;}
 const anchor=button.closest('#landing-panel')?document.querySelector('.hud-instruments [data-panel="'+view+'"],.console-utilities [data-panel="'+(view==='trial'?'guide':view)+'"]')??button:button;
 current=view;opener=anchor;content.replaceChildren(document.querySelector('#content-'+view).content.cloneNode(true));
 document.querySelector('#panel-kicker').textContent=titles[view][0];heading.textContent=titles[view][1];
 panel.hidden=false;panel.inert=false;panel.scrollTop=0;panel.dataset.view=view;root.dataset.panelOpen='true';root.dataset.lessonOpen=String(view==='guide'||view==='trial');welcome.inert=true;markControls();pivot(anchor);
 if(view==='guide')mountGuide(content,guideState);
 if(view==='trial')closeTrial=mountPublicTest(content);
 if(view==='connect')content.querySelector('form').addEventListener('submit',event=>{
  event.preventDefault();const input=content.querySelector('input'),error=content.querySelector('#relay-error');
  try{const destination=relayAddress(input.value);input.removeAttribute('aria-invalid');window.location.assign(destination);}
  catch{error.textContent='Use your relay’s HTTPS address, without a password, path, or query.';error.hidden=false;input.setAttribute('aria-invalid','true');input.focus();}
 });
 await animate([{transform:'scale(.3,.12)',opacity:0},{transform:'none',opacity:1}]);heading.focus({preventScroll:true});
}
function request(view,button){transition=transition.then(()=>change(view,button));}
document.addEventListener('click',event=>{const button=event.target.closest('[data-panel]');if(button&&Object.hasOwn(titles,button.dataset.panel)){request(button.dataset.panel,button);return;}if(event.target.closest('.landing-close'))request(null,opener);else if(current&&(event.target===root||event.target===document.querySelector('#cockpit-glass')))request(null,opener);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&current){event.preventDefault();request(null,opener);}});

// Same quadratic glass/control geometry as the source cockpit. No render loop.
const dash=document.querySelector('.cockpit-dash'),arc=document.querySelector('.folding-arc');
const controls=[...document.querySelectorAll('.hud-instruments>button,.folding-side>button,.folding-side>a')];
for(const control of controls)control.setAttribute('data-arc-control','');
function fitArc(){
 if(innerWidth<820)return;
 const box=dash.getBoundingClientRect(),stacked=innerWidth<1100,bow=stacked?Math.min(28,box.width*.035):Math.min(60,box.width*.044);
 const edge=y=>'M0 '+(y+bow)+' Q'+box.width/2+' '+(y-bow)+' '+box.width+' '+(y+bow);
 const placements=controls.filter(c=>c.offsetWidth).map(control=>{const b=control.getBoundingClientRect(),x=2*(b.left+b.width/2-box.left)/box.width-1,side=stacked&&control.closest('.folding-side'),y=(side?114:51)+bow*x*x,old=Number.parseFloat(control.style.getPropertyValue('--arc-shift'))||0;return {control,shift:y-(b.top+b.height/2-box.top-old),angle:Math.atan(4*bow*x/box.width)*180/Math.PI};});
 arc.setAttribute('viewBox','0 0 '+box.width+' '+box.height);arc.querySelector('.folding-arc-face').setAttribute('d',edge(5)+' V'+box.height+' H0 Z');arc.querySelector('.folding-arc-edge').setAttribute('d',edge(5));arc.querySelector('.folding-arc-track').setAttribute('d',stacked?edge(94):'');
 for(const {control,shift,angle} of placements){control.style.setProperty('--arc-shift',shift.toFixed(2)+'px');control.style.setProperty('--arc-angle',angle.toFixed(2)+'deg');}
}
new ResizeObserver(fitArc).observe(dash);motion();fitArc();
