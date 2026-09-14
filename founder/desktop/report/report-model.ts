type RecordValue = Record<string, any>
function object(v: unknown): v is RecordValue { return !!v && typeof v === 'object' && !Array.isArray(v) }
function count(v: unknown): v is number { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 }
const TOOLS = new Set(['mcp__cartha_ops__get_growth_metrics','get_growth_metrics','tool_call'])

// Read known tool envelopes only. Never execute HTML or derive metrics from LLM prose.
export function unwrapGrowth(value: unknown, depth=0): RecordValue | null {
  if(depth>7) return null
  if(typeof value==='string') {
    if(value.length>1_000_000) return null
    let text=value.trim()
    if(text.startsWith('<untrusted_tool_result')) {
      const start=text.indexOf('\n{'),end=text.lastIndexOf('</untrusted_tool_result>')
      if(start<0||end<0)return null
      text=text.slice(start,end).trim()
    }
    try{return unwrapGrowth(JSON.parse(text),depth+1)}catch{return null}
  }
  if(Array.isArray(value)) {
    for(const v of value.slice(0,100)){const found=unwrapGrowth(v,depth+1);if(found)return found}
  }
  if(!object(value))return null
  if(value.connection==='direct_posthog' && value.source==='https://us.posthog.com/project/509180' && Array.isArray(value.metrics)) return value
  if(value.connection==='report_fallback')return value
  for(const key of ['result','results','structuredContent','content','text']){
    if(key in value){const found=unwrapGrowth(value[key],depth+1);if(found)return found}
  }
  return null
}

export function reportFromTurn(messages: readonly unknown[], currentId: string): RecordValue | null {
  const index=messages.findIndex(m=>object(m)&&m.id===currentId)
  if(index<0)return null
  const current=messages[index] as RecordValue
  if(current.role!=='assistant'||current.status?.type==='running'||current.metadata?.custom?.interim)return null
  if(!Array.isArray(current.content)||!current.content.some((p:RecordValue)=>object(p)&&p.type==='text'&&p.text?.trim()))return null
  let request=''
  for(let i=index-1;i>=0;i--){const m=messages[i];if(object(m)&&m.role==='user'){request=Array.isArray(m.content)?m.content.filter((p:RecordValue)=>object(p)&&p.type==='text').map((p:RecordValue)=>p.text||'').join(' '):'';break}}
  // Only replace an explicitly requested Graphic report, never a general founder/reliability brief.
  if(!/graphic(?:[ _-]+bible|_signup_funnel|[ _-]+story)/i.test(request))return null
  // An earlier assistant message must not borrow a later turn's data.
  for(let i=index;i>=0;i--){
    const m=messages[i] as RecordValue
    if(!object(m))continue
    if(m.role==='user')break
    const parts=Array.isArray(m.content)?m.content:[]
    for(let j=parts.length-1;j>=0;j--){
      const p=parts[j]
      if(!object(p)||p.isError||!TOOLS.has(p.toolName))continue
      if(p.toolName==='tool_call' && !JSON.stringify(p.args??{}).includes('mcp__cartha_ops__get_growth_metrics'))continue
      const found=unwrapGrowth(p.result)
      if(found)return found
    }
  }
  return null
}

export function reportView(data: RecordValue) {
  const f=data.graphic_signup_funnel
  const available=data.connection==='direct_posthog'&&data.status==='available'&&object(f)&&f.status==='available'
  const valid=available&&[f.arriving_posthog_identities,f.linked_signups_so_far,f.matured_arriving_identities,f.matured_linked_signups].every(count)
    && f.linked_signups_so_far<=f.arriving_posthog_identities && f.matured_arriving_identities<=f.arriving_posthog_identities && f.matured_linked_signups<=f.matured_arriving_identities
  const state=!valid?'unavailable':f.arriving_posthog_identities===0?'empty':f.matured_arriving_identities===0?'waiting':'ready'
  const rate=state==='ready'?`${(100*f.matured_linked_signups/f.matured_arriving_identities).toFixed(1)}%`:'—'
  return {state,arrivals:valid?String(f.arriving_posthog_identities):'—',signups:valid?String(f.linked_signups_so_far):'—',rate,
    headline:state==='waiting'?'Shared links are being opened.':state==='empty'?'No qualifying shared-link arrivals yet.':state==='ready'?'Here’s what shared links led to.':'Signup attribution needs a check.',
    badge:state==='waiting'?'Too early to judge':state==='empty'?'No qualifying arrivals':state==='ready'?'Observed results':'Data unavailable',
    explanation:state==='waiting'?'None of these arrival cohorts has had a full 7 days to sign up. This is not a 0% conversion rate.':state==='empty'?'No matching non-self arrivals were recorded. That does not prove there was no sharing or that tracking is complete.':state==='ready'?`The rate uses only ${f.matured_arriving_identities} identities with a complete 7-day window—not every recent arrival.`:'No verified denominator is available. Missing data is not zero; check the connection and source details.',
    lookback:valid&&count(f.lookback_days)?f.lookback_days:null}
}
