import { useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { useMemo, useState, useEffect, type ReactNode } from 'react'
import { $activeGatewayProfile } from '@/store/profile'
import { requestComposerFocus, requestComposerInsert, requestComposerSubmit } from '@/app/chat/composer/focus'
import { Button } from '@/components/ui/button'
import { reportFromTurn, reportView, growthDecision, SIGNAL_LABELS, refreshBlock, requestGrowthAssessment } from './report-model'
import './founder-report.css'

const EMPTY: readonly unknown[]=[]
function date(v:unknown){if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))return 'Unknown';return new Date(v).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}

export function FounderReportCard({data,onRefresh,refreshBlocked,notice}:{data:Record<string,any>;onRefresh?:()=>void;refreshBlocked?:string;notice?:string}) {
  const [now,setNow]=useState(Date.now)
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return ()=>clearInterval(timer)},[])
  const v=reportView(data)
  const decision=growthDecision(data,now)
  const f=data.graphic_signup_funnel
  const queryTime=data.queried_at||data.data?.generated_at
  const stale=decision.stale
  const scheduled=data.review_schedule?.status==='scheduled' && Date.parse(data.review_schedule.next_at)>now
  return <article className="founder-report" data-state={v.state} aria-label="Graphic Bible decision report">
    <header>
      <p className="fr-eyebrow">GRAPHIC BIBLE {v.lookback?`· ${v.lookback}-DAY SHARED-LINK VIEW`:''}</p>
      <h2>{decision.title}</h2>
      <p className="fr-meaning">{decision.meaning}</p>
      <div className="fr-meta"><span className="fr-badge">{v.badge}</span><span>{data.connection==='direct_posthog'?'PostHog query':'Older report fallback'} · {date(queryTime)}</span>{stale&&<strong>Older snapshot — refresh before deciding</strong>}</div>
    </header>
    <aside className="fr-recommendation"><strong>My recommendation</strong><p>{decision.recommendation}</p></aside>
    <h3 className="fr-evidence-label">{stale?"In this saved report":"The evidence"}</h3>
    <dl className="fr-metrics">
      <div><dt>Shared-link visitors</dt><dd>{v.arrivals}</dd><p>Unique tracked identities—not verified people.</p></div>
      <div><dt>Linked signups so far</dt><dd>{v.signups}</dd><p>Signup within 7 days of a linked arrival.</p></div>
      <div><dt>Signup rate</dt><dd className={v.rate==='—'?'fr-word-value':undefined}>{v.rate==='—'?'Not ready':v.rate}</dd><p>{v.state==='ready'?'Only visitors with a full 7-day follow-up.':v.state==='waiting'?'Waiting for a full 7-day follow-up.':'No usable conversion rate.'}</p></div>
    </dl>
    <aside className="fr-explanation">{v.explanation}</aside>
    <section className="fr-agent-action"><div><h3>Let the agent do the next check</h3><p>I’ll check the latest numbers and tell you what they mean—and what I’d do next. Read-only.</p></div>
      <Button variant="default" disabled={!onRefresh||!!refreshBlocked} onClick={onRefresh}>Refresh &amp; assess</Button>
    </section>
    <p className="fr-action-status" role="status">{refreshBlocked||notice||'One click. No technical prompt to write.'}</p>
    <p className="fr-schedule">{scheduled?`Next scheduled review: ${date(data.review_schedule.next_at)}. Keep this Mac awake.`:'Refresh to check the next scheduled review.'}</p>
    <details className="fr-details"><summary>What still needs a real-world test?</summary><p>A controlled share → open → signup on a second device. The agent can check recorded events, but these aggregates cannot prove cross-device identity. Keep test traffic excluded from normal growth reports.</p></details>
    <details className="fr-details"><summary>Activity counts, sources & limitations</summary>
      <p>Activity window: {date(data.window?.start)} → {date(data.window?.end)}. The signup cohort is a separate {v.lookback||'unknown'}-day lookback.</p>
      <p>Provider refreshed: {date(data.provider_last_refresh)}. {data.served_from_cache?`Served from a short cache (${data.cache_age_seconds??'unknown'} seconds old when returned).`:'Not served from the local cache.'} Funnel refreshed: {date(f?.provider_last_refresh)}.</p>
      <div className="fr-table-scroll"><table><caption>Separate event counts — do not add overlapping share events or identities</caption><thead><tr><th>Signal / product</th><th>Events</th><th>Identities</th></tr></thead><tbody>{(Array.isArray(data.metrics)?data.metrics:[]).filter((row:any)=>row && typeof row==='object' && !Array.isArray(row)).slice(0,256).map((row:any,i:number)=><tr key={i}><td>{SIGNAL_LABELS[String(row.metric)]||String(row.metric||row.event||'Unknown').replaceAll('_',' ')}<small>{String(row.product||'Unattributed')}</small></td><td>{typeof row.count==='number'?row.count:'—'}</td><td>{typeof row.identities==='number'?row.identities:'—'}</td></tr>)}</tbody></table></div>
      <ul><li>Copied links and completed share sheets do not establish delivery.</li><li>PostHog identity stitching is not independently verified across devices or browser-to-native handoffs.</li><li>Native shares without a referral ID and some scanner traffic are outside reliable attribution.</li><li>These are observed associations, not causal lift or a viral coefficient.</li></ul>
    </details>
    <Button variant="outline" onClick={()=>{requestComposerInsert('Explain this Graphic Bible report in plain English. What is the single next action, and what evidence is still missing?',{target:'main',mode:'block'});requestComposerFocus('main')}}>Ask about this report</Button>
  </article>
}

export function FounderReportMessage({children}:{children:ReactNode}) {
  const profile=useStore($activeGatewayProfile)
  const messageId=useAuiState(s=>s.message.id)
  const hasDraft=useAuiState(s=>s.composer.text.trim().length>0 || (s.composer.attachments?.length??0)>0)
  const running=useAuiState(s=>s.thread.isRunning)
  const [requested,setRequested]=useState(false)
  const [notice,setNotice]=useState('')
  useEffect(()=>{if(!requested)return;const timer=setTimeout(()=>setRequested(false),3000);return ()=>clearTimeout(timer)},[requested])
  const refreshState={hasDraft,running:!!running,requested}
  const refreshBlocked=refreshBlock(refreshState)
  const refresh=()=>{
    const result=requestGrowthAssessment(refreshState,requestComposerSubmit)
    setRequested(result.accepted)
    setNotice(result.notice)
  }
  const messages=useAuiState(s=>profile==='founder'&&s.message.status?.type!=='running'?s.thread.messages:EMPTY)
  const data=useMemo(()=>reportFromTurn(messages,messageId),[messages,messageId])
  if(!data)return <>{children}</>
  return <><FounderReportCard data={data} onRefresh={refresh} refreshBlocked={refreshBlocked} notice={notice}/><details className="fr-transcript"><summary>Original answer & tool activity</summary>{children}</details></>
}
