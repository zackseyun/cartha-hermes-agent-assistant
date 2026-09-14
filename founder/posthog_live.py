"""Fixed read-only aggregate queries. Never expose secrets, raw properties, IDs or SQL input."""
import json
import os
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from analytics_filters import clean_where, sqlstr

SCHEMA_VERSION=3
# Inspected mobile _formatEventName emits Title Case. Hosted engagement emits
# pob_* events. Keep contracts separate: legacy "shared" is not a delivered share.
GRAPHIC_EVENTS={
 'Bible Graphic Story Opened':'opened',
 'Bible Graphic Story Panel Viewed':'panel_viewed',
 'Bible Graphic Story Shared':'legacy_share_action',
 'pob_graphic_story_opened':'opened',
 'pob_graphic_story_panel_entered':'panel_entered',
 'pob_graphic_story_panel_viewed':'panel_viewed',
 'pob_graphic_story_engagement':'engagement_flush',
 'pob_graphic_story_all_verses_exposed':'scripture_exposed',
 'pob_graphic_story_share_clicked':'share_intent',
 'pob_graphic_story_link_copied':'link_copied',
 'pob_graphic_story_native_share_completed':'share_sheet_completed',
 'pob_graphic_story_shared':'legacy_share_action',
 'pob_graphic_story_shared_link_opened':'shared_link_arrival',
}
EVENTS=['$pageview',*GRAPHIC_EVENTS,'signup_completed',
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
      GROUP BY event,product ORDER BY product,event LIMIT 256'''

def build_funnel_query(cfg, now):
    """First observed non-self shared-link arrival -> canonical signup, 7-day window.
    Use PostHog person_id to honor SDK identify merges; never return identifiers.
    Legacy 'Signup Completed' is an alias, not a second signup event.
    """
    def dt(d):return "toDateTime("+sqlstr(d.strftime('%Y-%m-%d %H:%M:%S'))+", 'UTC')"
    valid_share="match(toString(coalesce(properties.share_id,'')), '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')"
    entry=f"event='pob_graphic_story_shared_link_opened' AND {valid_share} AND lower(toString(coalesce(properties.self_open,''))) IN ('false','0')"
    converted="arrivals>0 AND signups>0 AND first_signup>=first_arrival AND first_signup<=first_arrival+INTERVAL 7 DAY"
    mature=f"arrivals>0 AND first_arrival<={dt(now-timedelta(days=7))}"
    return f'''SELECT countIf(arrivals>0),countIf({converted}),countIf({mature}),countIf(({mature}) AND ({converted}))
      FROM (SELECT person_id, countIf({entry}) AS arrivals, minIf(timestamp,{entry}) AS first_arrival,
      countIf(event='signup_completed') AS signups,minIf(timestamp,event='signup_completed') AS first_signup
      FROM events WHERE timestamp>={dt(now-timedelta(days=28))} AND timestamp<{dt(now)}
      AND event IN ('pob_graphic_story_shared_link_opened','signup_completed')
      AND notEmpty(toString(person_id)) AND toString(person_id)!='00000000-0000-0000-0000-000000000000'
      AND ({clean_where(cfg)}) GROUP BY person_id)'''

def funnel_result(raw):
    rows=raw.get('results',[])
    if len(rows)!=1 or len(rows[0])!=4:raise ValueError('Unexpected funnel shape')
    arrived,converted,matured,matured_converted=rows[0]
    if any(type(v) not in (int,float) or v<0 for v in rows[0]) or converted>arrived or matured>arrived or matured_converted>matured:
        raise ValueError('Invalid funnel counts')
    return {'status':'available','lookback_days':28,'conversion_window_days':7,
      'arriving_posthog_identities':arrived,'linked_signups_so_far':converted,
      'matured_arriving_identities':matured,'matured_linked_signups':matured_converted,
      'matured_conversion_rate':matured_converted/matured if matured else None,
      'provider_last_refresh':raw.get('last_refresh'),'provider_cached':bool(raw.get('is_cached')),
      'scope':'First observed valid non-self hosted shared-link arrival -> canonical signup_completed on the same PostHog person; ordered within 7 days.',
      'limitations':['Unmatured cohorts are not failures; no mature denominator means no conversion rate.',
        'Identity stitching depends on existing PostHog identify calls. Cross-device and browser-to-native continuity are not independently verified.',
        'Shared IDs and locally recorded self-open flags do not prove a unique human recipient or exclude every scanner.',
        'This measures observed attributed signups, not causal lift or viral coefficient. Native clipboard-only shares without gn_share are outside this funnel.']}

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
            if d.get('schema_version')==SCHEMA_VERSION and d.get('status')=='available' and 0<=age<300:
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
            rows.append(dict(event=row[0],metric=GRAPHIC_EVENTS.get(row[0],row[0]),product=row[1],count=row[2],identities=row[3],previous_count=row[4],previous_identities=row[5],latest_event=row[6]))
        try:
            funnel=funnel_result(query(cfg,build_funnel_query(cfg,now)))
        except Exception as exc:
            funnel={'status':'unavailable','error_type':type(exc).__name__,'reason':'Funnel query failed; event counts remain available.'}
        result={'status':'available','connection':'direct_posthog','source':'https://us.posthog.com/project/509180',
          'schema_version':SCHEMA_VERSION,'graphic_signup_funnel':funnel,
          'queried_at':now.isoformat(),'provider_last_refresh':raw.get('last_refresh'),'provider_cached':bool(raw.get('is_cached')),
          'window':{'start':(now-timedelta(days=days)).isoformat(),'end':now.isoformat(),'days':days,'comparison':'preceding equal-length rolling window'},
          'metrics':rows,'events_checked':EVENTS,'cached_at_epoch':time.time(),'served_from_cache':False,
          'limitations':['Counts are allowlisted events, not a complete product funnel or account totals.',
            'Distinct identities are not verified humans; do not add them across events or products.',
            'Native/unrecognized hosts remain unattributed; do not guess product ownership.',
            'Graphic shared event in inspected mobile source means copied link, not delivered message.',
            'Use graphic_signup_funnel for ordered observed attribution; viral coefficient, retention and causal uplift remain unavailable.',
            'Hosted legacy shared overlaps link_copied/native_share_completed. Do not sum them; share intent, clipboard copy and completed share sheet are distinct.',
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
