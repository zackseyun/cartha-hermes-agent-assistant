"""Narrow local operations boundary. No shell, arbitrary paths/SQL, sends or cloud writes."""
from __future__ import annotations
import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

HOME = Path(os.environ.get('CARTHA_OPS_HOME', str(Path.home()/'.hermes/profiles/founder/operations')))
STAGES = {'lead','contacted','replied','meeting','demo','pilot','active','stalled','do_not_contact'}
SEGMENTS = {'message','churches','pob','wellness','recovery','hub'}

def now(): return datetime.now(timezone.utc).isoformat()

def checked(value, limit=4000):
    if not isinstance(value, str) or not value.strip() or len(value)>limit:
        raise ValueError('Expected nonempty bounded text')
    return value.strip()

def timestamp(value):
    d = datetime.fromisoformat(value.replace('Z','+00:00'))
    if d.tzinfo is None: raise ValueError('Explicit timezone offset required')
    return d.astimezone(timezone.utc).isoformat()

def db():
    HOME.mkdir(parents=True,exist_ok=True,mode=0o700)
    c=sqlite3.connect(HOME/'operations.sqlite3',timeout=20)
    c.row_factory=sqlite3.Row
    c.executescript('''
    CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY, name TEXT NOT NULL, organization TEXT NOT NULL,
      segment TEXT NOT NULL, stage TEXT NOT NULL, source TEXT NOT NULL, notes TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS followups(id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, due_at TEXT NOT NULL,
      action TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS engineering(id TEXT PRIMARY KEY, body TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY, action TEXT NOT NULL, entity_id TEXT NOT NULL, at TEXT NOT NULL);
    ''')
    os.chmod(HOME/'operations.sqlite3',0o600)
    return c

def audit(c,action,entity): c.execute('INSERT INTO audit(action,entity_id,at) VALUES(?,?,?)',(action,entity,now()))

def list_contacts(segment: str='', limit: int=50):
    if segment and segment not in SEGMENTS: raise ValueError('Unknown segment')
    with db() as c:
        return [dict(r) for r in c.execute('SELECT * FROM contacts WHERE (?="" OR segment=?) ORDER BY name LIMIT ?',
            (segment,segment,max(1,min(limit,250))))]

def update_contact(contact_id: str, name: str, organization: str, segment: str, stage: str, source: str, notes: str=''):
    """Record an explicitly stated business relationship, not inferred engagement intent."""
    if stage not in STAGES or segment not in SEGMENTS: raise ValueError('Invalid stage or segment')
    values=(checked(contact_id,120),checked(name,200),checked(organization,300),segment,stage,checked(source,2000),notes[:4000],now())
    with db() as c:
        old=c.execute('SELECT stage FROM contacts WHERE id=?',(contact_id,)).fetchone()
        if old and old['stage']=='do_not_contact' and stage!='do_not_contact':
            raise ValueError('Suppression cannot be lifted through agent tools')
        c.execute('INSERT INTO contacts VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,organization=excluded.organization,segment=excluded.segment,stage=excluded.stage,source=excluded.source,notes=excluded.notes,updated_at=excluded.updated_at',values)
        audit(c,'update_contact',contact_id)
    return {'id':contact_id,'saved':True,'sent':False}

def create_followup(request_id: str, contact_id: str, due_at: str, action: str):
    """Idempotently queue a reminder; never send a message or create a calendar event."""
    values=(checked(request_id,120),checked(contact_id,120),timestamp(due_at),checked(action), 'pending', now())
    with db() as c:
        contact=c.execute('SELECT stage FROM contacts WHERE id=?',(contact_id,)).fetchone()
        if not contact or contact['stage']=='do_not_contact': raise ValueError('Missing or suppressed contact')
        old=c.execute('SELECT * FROM followups WHERE id=?',(request_id,)).fetchone()
        if old:
            if (old['contact_id'],old['due_at'],old['action'])!=values[1:4]: raise ValueError('Idempotency key conflict')
            return dict(old)
        c.execute('INSERT INTO followups VALUES(?,?,?,?,?,?)',values)
        audit(c,'create_followup',request_id)
    return {'id':request_id,'state':'pending','sent':False}

def get_stale_leads(as_of: str=''):
    cutoff=timestamp(as_of) if as_of else now()
    with db() as c:
        rows=c.execute('''SELECT f.*,c.name,c.organization,c.segment FROM followups f JOIN contacts c ON c.id=f.contact_id
        WHERE f.state='pending' AND f.due_at<=? AND c.stage!='do_not_contact' ORDER BY f.due_at LIMIT 100''',(cutoff,))
        return {'as_of':cutoff,'followups':[dict(r) for r in rows], 'rule':'Only explicit due dates; missing dates are not overdue.'}

def complete_followup(request_id: str):
    with db() as c:
        r=c.execute("UPDATE followups SET state='completed' WHERE id=?",(request_id,))
        if not r.rowcount: raise ValueError('Unknown followup')
        audit(c,'complete_followup',request_id)
    return {'id':request_id,'state':'completed'}

def record_experiment(experiment_id: str, segment: str, hypothesis: str, metric: str, baseline: str,
                      success_rule: str, stop_rule: str, review_at: str, evidence_source: str, status: str='proposed'):
    if segment not in SEGMENTS or status not in {'proposed','running','completed','stopped'}: raise ValueError('Invalid experiment')
    body=dict(segment=segment,hypothesis=checked(hypothesis),metric=checked(metric),baseline=checked(baseline),
        success_rule=checked(success_rule),stop_rule=checked(stop_rule),review_at=timestamp(review_at),
        evidence_source=checked(evidence_source),status=status)
    with db() as c:
        c.execute('INSERT INTO experiments VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at',
            (checked(experiment_id,120),json.dumps(body),now()))
        audit(c,'record_experiment',experiment_id)
    return {'id':experiment_id,**body}

def get_experiment_results():
    with db() as c: return [{'id':r['id'],**json.loads(r['body'])} for r in c.execute('SELECT * FROM experiments ORDER BY id')]

def get_report_metrics():
    p=HOME/'growth.json'
    if not p.exists(): return {'status':'unavailable','reason':'Aggregate report not imported; never interpret as zero'}
    data=json.loads(p.read_text())
    age=(datetime.now(timezone.utc)-datetime.fromisoformat(timestamp(data['data']['generated_at']))).total_seconds()/3600
    return {**data,'age_hours':round(age,1),'status':'stale' if age>36 else 'available',
      'scope':'Existing noon report, not a real-time Graphic Bible attribution funnel'}

def get_growth_metrics(window_days: int=1):
    """Read direct PostHog aggregates for 1, 7 or 28 days; 5-minute cache, explicit report fallback."""
    from posthog_live import fetch
    live=fetch(HOME,window_days)
    if live['status']=='available':return live
    report=get_report_metrics()
    return {**report,'connection':'report_fallback','live_query':live,
            'warning':'Live PostHog unavailable. This is an older report, not the requested live window.'}

def get_business_context():
    p=HOME/'context.json'
    return json.loads(p.read_text()) if p.exists() else {'status':'unavailable'}

def get_calendar():
    return {'status':'not_connected','events':None,'note':'Do not infer calendar availability from follow-up reminders.'}

def create_codex_task(request_id: str, title: str, problem: str, acceptance_criteria: str, source: str):
    """Create an engineering request awaiting approval, NOT a dispatched Codex task."""
    body=dict(title=checked(title,200),problem=checked(problem),acceptance_criteria=checked(acceptance_criteria),source=checked(source))
    payload=json.dumps(body,sort_keys=True)
    with db() as c:
        old=c.execute('SELECT body FROM engineering WHERE id=?',(request_id,)).fetchone()
        if old and old['body']!=payload: raise ValueError('Idempotency key conflict')
        c.execute('INSERT OR IGNORE INTO engineering VALUES(?,?,?,?)',(checked(request_id,120),payload,'awaiting_approval',now()))
        if not old: audit(c,'engineering_request',request_id)
    return {'id':request_id,'state':'awaiting_approval','dispatched':False}

def get_codex_task_status(request_id: str=''):
    with db() as c:
        return [{'id':r['id'],'state':r['state'],**json.loads(r['body'])} for r in c.execute(
            'SELECT * FROM engineering WHERE (?="" OR id=?) ORDER BY created_at DESC LIMIT 100',(request_id,request_id))]

def founder_brief():
    return {'growth':get_growth_metrics(),'sales':get_stale_leads(),'experiments':get_experiment_results(),
        'engineering':get_codex_task_status(),'calendar':get_calendar(),'context':get_business_context()}

if __name__=='__main__':
    from mcp.server.fastmcp import FastMCP
    mcp=FastMCP('Cartha Founder Operations')
    for fn in (list_contacts,update_contact,create_followup,get_stale_leads,complete_followup,record_experiment,
               get_experiment_results,get_growth_metrics,get_business_context,get_calendar,create_codex_task,
               get_codex_task_status,founder_brief): mcp.tool()(fn)
    mcp.run(transport='stdio')
