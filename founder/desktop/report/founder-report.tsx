import { useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { useMemo, type ReactNode } from 'react'
import { $activeGatewayProfile } from '@/store/profile'
import { requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { Button } from '@/components/ui/button'
import { reportFromTurn, reportView } from './report-model'
import './founder-report.css'

const EMPTY: readonly unknown[]=[]
function date(v:unknown){if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))return 'Unknown';return new Date(v).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}

export function FounderReportCard({data}:{data:Record<string,any>}) {
  const v=reportView(data)
  const f=data.graphic_signup_funnel
  const queryTime=data.queried_at||data.data?.generated_at
  const age=typeof queryTime==='string'?(Date.now()-Date.parse(queryTime))/3600000:NaN
  const stale=Number.isFinite(age)&&age>6
  return <article className="founder-report" data-state={v.state} aria-label="Graphic Bible decision report">
    <header>
      <p className="fr-eyebrow">GRAPHIC BIBLE {v.lookback?`· ${v.lookback}-DAY ARRIVAL COHORT`:''}</p>
      <h2>{v.headline}</h2>
      <div className="fr-meta"><span className="fr-badge">{v.badge}</span><span>{data.connection==='direct_posthog'?'PostHog query':'Older report fallback'} · {date(queryTime)}</span>{stale&&<strong>Older snapshot — refresh before deciding</strong>}</div>
    </header>
    <dl className="fr-metrics">
      <div><dt>Shared-link visitors</dt><dd>{v.arrivals}</dd><p>Unique tracked identities—not verified people.</p></div>
      <div><dt>Linked signups so far</dt><dd>{v.signups}</dd><p>Signup within 7 days of a linked arrival.</p></div>
      <div><dt>7-day conversion</dt><dd>{v.rate}</dd><p>{v.state==='ready'?'Only cohorts with a complete observation window.':v.state==='waiting'?'Waiting for complete cohorts.':'No usable conversion rate.'}</p></div>
    </dl>
    <aside className="fr-explanation">{v.explanation}</aside>
    <section><h3>What to do next</h3><ol className="fr-actions">
      <li><strong>{v.state==='unavailable'?'Check the analytics connection':'Verify one share-to-signup journey'}</strong><p>{v.state==='unavailable'?'Ask for a fresh report; keep the fallback date visible.':'Use a tagged test on a second device. Confirm arrival → signup.'}</p></li>
      <li><strong>{v.state==='waiting'?'Let the 7-day window complete':v.state==='empty'?'Check tracking before interpreting zero':v.state==='ready'?'Review the sample before changing direction':'Review source coverage'}</strong><p>{v.state==='waiting'?'Wait for complete cohorts before interpreting the rate.':'Separate instrumentation gaps, identity limits and small samples from actual product performance.'}</p></li>
    </ol></section>
    <details className="fr-details"><summary>Activity counts, sources & limitations</summary>
      <p>Activity window: {date(data.window?.start)} → {date(data.window?.end)}. The signup cohort is a separate {v.lookback||'unknown'}-day lookback.</p>
      <p>Provider refreshed: {date(data.provider_last_refresh)}. {data.served_from_cache?`Served from a short cache (${data.cache_age_seconds??'unknown'} seconds old when returned).`:'Not served from the local cache.'} Funnel refreshed: {date(f?.provider_last_refresh)}.</p>
      <div className="fr-table-scroll"><table><caption>Separate event counts — do not add overlapping share events or identities</caption><thead><tr><th>Signal / product</th><th>Events</th><th>Identities</th></tr></thead><tbody>{(Array.isArray(data.metrics)?data.metrics:[]).filter((row:any)=>row && typeof row==='object' && !Array.isArray(row)).slice(0,256).map((row:any,i:number)=><tr key={i}><td>{String(row.metric||row.event||'Unknown')}<small>{String(row.product||'Unattributed')}</small></td><td>{typeof row.count==='number'?row.count:'—'}</td><td>{typeof row.identities==='number'?row.identities:'—'}</td></tr>)}</tbody></table></div>
      <ul><li>Copied links and completed share sheets do not establish delivery.</li><li>PostHog identity stitching is not independently verified across devices or browser-to-native handoffs.</li><li>Native shares without a referral ID and some scanner traffic are outside reliable attribution.</li><li>These are observed associations, not causal lift or a viral coefficient.</li></ul>
    </details>
    <Button variant="outline" onClick={()=>{requestComposerInsert('Explain this Graphic Bible report in plain English. What is the single next action, and what evidence is still missing?',{target:'main',mode:'block'});requestComposerFocus('main')}}>Ask about this report</Button>
  </article>
}

export function FounderReportMessage({children}:{children:ReactNode}) {
  const profile=useStore($activeGatewayProfile)
  const messageId=useAuiState(s=>s.message.id)
  const messages=useAuiState(s=>profile==='founder'&&s.message.status?.type!=='running'?s.thread.messages:EMPTY)
  const data=useMemo(()=>reportFromTurn(messages,messageId),[messages,messageId])
  if(!data)return <>{children}</>
  return <><FounderReportCard data={data}/><details className="fr-transcript"><summary>Original answer & tool activity</summary>{children}</details></>
}
