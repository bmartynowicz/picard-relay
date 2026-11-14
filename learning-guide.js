// Local teaching only. No fetch, credentials, persistence or provider authority.
export const SAMPLE_REQUEST='Turn these notes into three next actions: check relay health, write a useful task, and reopen the saved answer.';
export const SAMPLE_ANSWER='1. Check System for relay health.\n2. Write your task in Requests and review the exact brief.\n3. Open the completed job to read the same saved answer.';
export function createGuideState(){
 let stage='request',saved=false;
 return {
  get stage(){return stage;},get saved(){return saved;},
  next(){if(stage==='request')stage='review';else if(stage==='review'){saved=true;stage='answer';}},
  back(){if(stage==='review')stage='request';else if(stage==='answer')stage='saved';},
  reopen(){if(saved)stage='answer';},
  reset(){stage='request';saved=false;}
 };
}
export function mountGuide(container,state){
 const guide=container.querySelector('#request-guide');
 guide.querySelectorAll('[data-example-request]').forEach(e=>{e.textContent=SAMPLE_REQUEST;});
 guide.querySelector('[data-example-answer]').textContent=SAMPLE_ANSWER;
 function render(){
  guide.querySelectorAll('[data-guide-stage]').forEach(e=>{e.hidden=e.dataset.guideStage!==state.stage;});
  const step=state.stage==='request'?'1':state.stage==='review'?'2':'3';
  guide.querySelectorAll('[data-guide-step]').forEach(e=>{if(e.dataset.guideStep===step)e.setAttribute('aria-current','step');else e.removeAttribute('aria-current');});
  guide.querySelector('#guide-announcement').textContent={request:'Step 1: read the task.',review:'Step 2: review the exact request.',answer:'Example answer open. No AI call was made.',saved:'Example saved. Reopen it without making a new request.'}[state.stage];
 }
 guide.addEventListener('click',event=>{
  const control=event.target.closest('[data-guide-action]');if(!control)return;
  const action=control.dataset.guideAction;
  if(action==='next')state.next();else if(action==='back')state.back();else if(action==='reopen')state.reopen();else if(action==='reset')state.reset();
  render();guide.closest('.landing-panel').scrollTop=0;
  guide.querySelector('[data-guide-stage]:not([hidden]) h3')?.focus({preventScroll:true});
 });
 render();
}
