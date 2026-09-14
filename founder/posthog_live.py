"""Fixed read-only aggregate queries. Never expose secrets, raw properties, IDs or SQL input."""
import json
import os
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from analytics_filters import clean_where, sqlstr

EVENTS=['$pageview','bible_graphic_story_opened','bible_graphic_story_panel_viewed','bible_graphic_story_shared',
        'Auth Phone Failed','Social Auth Error','Client Uncaught Error','dm_send_failed']
HOSTS={'Cartha website':['cartha.com','www.cartha.com'], 'People’s Open Bible':['peoplesbible.com','www.peoplesbible.com','pob.cartha.com'],
       'Message Church':['message.cartha.com'],'Cartha web app':['app.cartha.com','app.cartha.ai'],
       'Churches':['church.cartha.com'],'Wellness':['cartha.ai','www.cartha.ai','wellness.cartha.com'],
       'Recovery':['recovery.cartha.ai','recovery.cartha.com'],'Hub':['hub.cartha.com']}

def config():
    import boto3
    from botocore.config import Config
    c=boto3.client('secretsmanager',region_name='us-west-2',config=Config(connect_timeout=5,read_timeout=10,retries={'max_attempts':1}))
    d=json.loads(c.get_secret_value(SecretId='cartha/founder-report/config')['SecretString'])
    if d.get('host','').rstrip('/')!='https://us.posthog.com' or str(d.get('environment_id') or d.get('project_id'))!='509180':
        raise ValueError('Analytics target changed; review required')
    return d

def build_query(days, now, cfg):
    if type(days) is not int or days not in (1,7,28):raise ValueError('Choose 1, 7 or 28 days')
    def date(d):return "toDateTime("+sqlstr(d.strftime('%Y-%m-%d %H:%M:%S'))+", 'UTC')"
    end=date(now);start=date(now-timedelta(days=days));previous=date(now-timedelta(days=2*days))
    products=','.join("properties.`$host` IN ("+','.join(map(sqlstr,hosts))+"),"+sqlstr(name) for name,hosts in HOSTS.items())
    product="multiIf("+products+",'Unattributed / native')"
    return f'''SELECT event, {product} AS product,
      countIf(timestamp >= {start}), uniqIf(distinct_id,timestamp >= {start}),
      countIf(timestamp < {start}), uniqIf(distinct_id,timestamp < {start}), max(timestamp)
      FROM events WHERE timestamp >= {previous} AND timestamp < {end}
      AND event IN ({','.join(map(sqlstr,EVENTS))}) AND ({clean_where(cfg)})
      GROUP BY event,product ORDER BY product,event LIMIT 100'''

def query(cfg, sql):
    # No caller-controlled endpoint, project, query text, field names or secrets.
    request=urllib.request.Request('https://us.posthog.com/api/environments/509180/query/',
       data=json.dumps({'query':{'kind':'HogQLQuery','query':sql},'name':'Cartha Hermes aggregate growth'}).encode(),
       headers={'Authorization':'Bearer '+cfg['api_key'],'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=45) as response:
        raw=response.read(1_000_001)
    if len(raw)>1_000_000:raise ValueError('Response too large')
    d=json.loads(raw)
    if d.get('error') or d.get('hasMore') or not isinstance(d.get('results'),list):raise ValueError('Incomplete response')
    if d.get('is_cached') and not d.get('last_refresh'):raise ValueError('Unknown cache age')
    return d

def fetch(home: Path, days=1):
    if type(days) is not int or days not in (1,7,28):raise ValueError('Choose 1, 7 or 28 days')
    if os.environ.get('CARTHA_POSTHOG_DISABLED')=='1':return {'status':'unavailable','reason':'Live analytics disabled for this process'}
    cache=home/f'posthog-{days}.json'
    if cache.exists():
        try:
            d=json.loads(cache.read_text())
            age=time.time()-d.get('cached_at_epoch',0)
            if d.get('status')=='available' and 0<=age<300:
                return {**d,'connection':'direct_posthog','cache_age_seconds':round(age),'served_from_cache':True}
        except (OSError, ValueError, TypeError):
            pass  # A corrupt cache is not a reason to skip a live query or its fallback.
    try:
        cfg=config();now=datetime.now(timezone.utc);raw=query(cfg,build_query(days,now,cfg))
        rows=[]
        for row in raw['results']:
            if len(row)!=7 or row[0] not in EVENTS or row[1] not in [*HOSTS,'Unattributed / native']:
                raise ValueError('Unexpected aggregate shape')
            if any(type(v) not in (int,float) or v<0 for v in row[2:6]):raise ValueError('Invalid count')
            rows.append(dict(event=row[0],product=row[1],count=row[2],identities=row[3],previous_count=row[4],previous_identities=row[5],latest_event=row[6]))
        result={'status':'available','connection':'direct_posthog','source':'https://us.posthog.com/project/509180',
          'queried_at':now.isoformat(),'provider_last_refresh':raw.get('last_refresh'),'provider_cached':bool(raw.get('is_cached')),
          'window':{'start':(now-timedelta(days=days)).isoformat(),'end':now.isoformat(),'days':days,'comparison':'preceding equal-length rolling window'},
          'metrics':rows,'events_checked':EVENTS,'cached_at_epoch':time.time(),'served_from_cache':False,
          'limitations':['Counts are allowlisted events, not a complete product funnel or account totals.',
            'Distinct identities are not verified humans; do not add them across events or products.',
            'Native/unrecognized hosts remain unattributed; do not guess product ownership.',
            'Graphic shared event in inspected mobile source means copied link, not delivered message.',
            'No linked recipient, signup or retention attribution: viral coefficient and causal uplift remain unavailable.',
            'Existing founder-report test/internal traffic exclusions reused; unidentified bot/test traffic may remain.',
            'No returned row means no matching observed event in these windows, not proof instrumentation works.']}
        home.mkdir(parents=True,exist_ok=True,mode=0o700)
        import tempfile
        fd,tmp=tempfile.mkstemp(dir=home)
        with os.fdopen(fd,'w') as f:json.dump(result,f)
        os.replace(tmp,cache)
        return result
    except Exception as exc:
        # Error text may contain headers, SQL or private config. Return only the class.
        return {'status':'unavailable','connection':'direct_posthog','error_type':type(exc).__name__,
                'reason':'Live aggregate query failed; do not interpret missing data as zero.'}
