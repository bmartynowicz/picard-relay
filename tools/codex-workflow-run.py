"""Run one frozen Picard CLI input. Never retries model work; delivery is resumable."""
import argparse,datetime,hashlib,json,os,pathlib,subprocess,time

def transcript(thread):
    stamp=int(thread[:8]+thread[9:13],16)/1000
    home=pathlib.Path(os.environ.get('CODEX_HOME',pathlib.Path.home()/'.codex'))
    for offset in (0,-1,1):
        day=datetime.datetime.fromtimestamp(stamp,datetime.timezone.utc)+datetime.timedelta(days=offset)
        folder=home/'sessions'/day.strftime('%Y/%m/%d')
        matches=list(folder.glob('rollout-*-'+thread+'.jsonl'))
        if matches:return [json.loads(line) for line in matches[0].read_text(encoding='utf8').splitlines()]
    raise RuntimeError('Native transcript unavailable; preserve run and inspect before another call.')

def run(args):
    root=pathlib.Path(args.input).resolve()
    prepared=json.loads((root/'prepared.json').read_text(encoding='utf8'))
    assert prepared['automaticRetries']==0
    settings=json.loads(pathlib.Path(args.settings).read_text(encoding='utf8'))
    label=args.variant
    if args.preparation:
        assert not args.fix
        label='preparation-'+args.preparation
        prompt=(root/(label+'-prompt.txt')).read_bytes()
    elif args.fix:
        original=json.loads((root/(args.variant+'-measurement.json')).read_text())
        label=args.variant+'-fix-'+args.fix
        prompt=(root/(label+'-prompt.txt')).read_bytes()
    else:prompt=(root/(label+'-prompt.txt')).read_bytes()
    events=root/(label+'-events.jsonl')
    measurement=root/(label+'-measurement.json')
    recorder=pathlib.Path(__file__).with_name('codex-usage-notify.mjs')
    if args.deliver_only:
        row=json.loads(measurement.read_text())
    else:
        assert not events.exists(),'Existing native attempt: inspect it; no automatic retry.'
        if args.variant=='assisted' and not args.fix and not args.preparation:
            proof=json.loads((root/'proof.json').read_text())
            assert hashlib.sha256(prompt).hexdigest()==proof['promptSha256']
        command=[args.node,args.codex_js,'exec','--ignore-user-config','--disable','apps','--disable','plugins',
          '--enable','skip_host_skill_discovery','--json','--skip-git-repo-check','--sandbox','read-only',
          '-C',str(root),'-m',prepared['model'],'-c','model_reasoning_effort='+json.dumps(prepared['effort']),
          '-c','service_tier='+json.dumps(prepared['serviceTier']),'-c','notify='+json.dumps(settings['original']),
          '--output-last-message',str(root/(label+'-answer.txt')),'-']
        print(json.dumps({'started':root.name+'/'+label,'model':prepared['model'],'effort':prepared['effort']}),flush=True)
        started=time.monotonic()
        with events.open('xb') as out,(root/(label+'-stderr.txt')).open('xb') as err:
            result=subprocess.run(command,input=prompt,stdout=out,stderr=err,cwd=root,timeout=300)
            if result.returncode:raise RuntimeError('Native CLI failed. Inspect saved events/stderr; do not automatically retry.')
        native=[json.loads(line) for line in events.read_bytes().splitlines()]
        usage,=[r['usage'] for r in native if r['type']=='turn.completed']
        assert not any(r.get('item',{}).get('type') in ('command_execution','mcp_tool_call','web_search','file_change') for r in native)
        thread=native[0]['thread_id'];fixed=[];turns=[];passes=[];matched=False
        for event in transcript(thread):
            p=event.get('payload',{})
            if event['type']=='token_usage_record':passes.append(p['usage'])
            if event['type']=='event_msg' and p.get('type')=='task_complete':turns.append(p['turn_id'])
            if event['type']=='response_item' and p.get('type') in ('message','additional_tools'):
                if p.get('role') in ('system','developer') or p['type']=='additional_tools':
                    fixed.append({k:p[k] for k in ('type','role','content','tools') if k in p})
                elif p.get('role')=='user':
                    text=''.join(c.get('text','') for c in p['content'] if c.get('type')=='input_text').encode()
                    if text==prompt:matched=True
                    else:fixed.append({'role':'user','content':p['content']})
        assert matched and len(turns)==1
        assert all(sum(p[k] for p in passes)==usage[k] for k in ('input_tokens','cached_input_tokens','output_tokens'))
        row={'task':root.name,'variant':args.variant,'label':label,'comparison':prepared['comparison'],
          'thread':thread,'turn':turns[0],'runId':hashlib.sha256((thread+'\n'+turns[0]).encode()).hexdigest(),
          'model':prepared['model'],'effort':prepared['effort'],
          'fixedHash':hashlib.sha256(json.dumps(fixed,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),
          'usage':usage,'totalTokens':usage['input_tokens']+usage['output_tokens'],'modelPasses':len(passes),
          'seconds':round(time.monotonic()-started,1),'followups':[]}
        if args.fix:row['followUpTo']=original['runId']
        # Save native evidence before delivery so a network failure cannot repeat model work.
        measurement.write_bytes(json.dumps(row).encode())
        with (root/'results.jsonl').open('ab') as ledger:ledger.write((json.dumps(row)+'\n').encode())
    notice={'type':'agent-turn-complete','thread-id':row['thread'],'turn-id':row['turn']}
    command=[args.node,str(recorder),'--endpoint',settings['endpoint'],'--token-file',settings['tokenFile'],
       '--exec-events',str(events)]
    if not args.fix and not args.preparation:
        command+=['--comparison',prepared['comparison'],'--variant',args.variant]
        if args.variant=='assisted':command+=['--prepared-handoff',str(root/'proof.json')]
    subprocess.run(command+[json.dumps(notice)],check=True,timeout=30)
    if args.fix:
        subprocess.run([args.node,str(recorder),'--endpoint',settings['endpoint'],'--token-file',settings['tokenFile'],
          '--attach',row['runId'],'--follow-up-to',row['followUpTo']],check=True,timeout=15)
    if not args.fix and not args.preparation and prepared.get('workflow'):
        coverage=prepared['workflow']
        scope={'v':1,'kind':'workflow','comparisonId':prepared['comparison'],'variant':args.variant,
               'preparationIds':coverage['preparationIds'][args.variant],
               'picardRefs':coverage['picardRefs'] if args.variant=='assisted' else []}
        scope_path=root/(args.variant+'-workflow.json')
        scope_path.write_text(json.dumps(scope),encoding='utf8')
        subprocess.run([args.node,str(recorder),'--endpoint',settings['endpoint'],'--token-file',settings['tokenFile'],
                        '--workflow',str(scope_path)],check=True,timeout=15)
    print(json.dumps({'completed':label,'delivered':True,**row}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',required=True);p.add_argument('--variant',choices=['baseline','assisted'],required=True)
    p.add_argument('--settings',required=True);p.add_argument('--node',required=True);p.add_argument('--codex-js',required=True)
    p.add_argument('--fix',help='Explicit correction label; prompt must already exist. Counts against original side.')
    p.add_argument('--preparation',help='Named preparation prompt; records its native usage before finishing. Include its saved runId in workflow coverage.')
    p.add_argument('--deliver-only',action='store_true',help='Redeliver saved usage only; never run the model.')
    run(p.parse_args())
