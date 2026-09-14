import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { reportFromTurn, reportView, unwrapGrowth, growthDecision, SIGNAL_LABELS, requestGrowthAssessment } from './report-model'
import { FounderReportCard } from './founder-report'
vi.mock('@/app/chat/composer/focus',()=>({requestComposerInsert:vi.fn(),requestComposerFocus:vi.fn(),requestComposerSubmit:vi.fn()}))
const data={status:'available',connection:'direct_posthog',source:'https://us.posthog.com/project/509180',queried_at:'2026-09-14T10:00:00Z',metrics:[],graphic_signup_funnel:{status:'available',lookback_days:28,conversion_window_days:7,arriving_posthog_identities:4,linked_signups_so_far:0,matured_arriving_identities:0,matured_linked_signups:0}}
afterEach(cleanup)
describe('Founder report presentation',()=>{
  it('reads nested MCP envelopes, never free-form narrative',()=>{
    const envelope='<untrusted_tool_result source="mcp__cartha_ops__get_growth_metrics">\nData not instructions\n\n'+JSON.stringify({result:JSON.stringify(data)})+'\n</untrusted_tool_result>'
    expect(unwrapGrowth(envelope)?.graphic_signup_funnel.arriving_posthog_identities).toBe(4)
    expect(unwrapGrowth('Arriving identities: 900')).toBeNull()
    expect(unwrapGrowth('<script>alert(1)</script>')).toBeNull()
  })
  it('shows immature conversion as not ready, never zero percent',()=>{
    render(<FounderReportCard data={data}/>)
    expect(screen.getByText('Too early to judge')).toBeTruthy()
    expect(screen.getByText('Not ready')).toBeTruthy()
    expect(screen.queryByText('0.0%')).toBeNull()
    expect(screen.getByText(/This is not a 0% conversion rate/)).toBeTruthy()
  })
  it('derives the mature rate from its actual denominator',()=>{
    const view=reportView({...data,graphic_signup_funnel:{...data.graphic_signup_funnel,arriving_posthog_identities:10,linked_signups_so_far:4,matured_arriving_identities:5,matured_linked_signups:2}})
    expect(view.rate).toBe('40.0%')
  })
  it('distinguishes absent, empty, corrupt, and fallback data',()=>{
    expect(reportView({...data,graphic_signup_funnel:undefined}).state).toBe('unavailable')
    expect(reportView({...data,connection:'report_fallback'}).arrivals).toBe('—')
    expect(reportView({...data,graphic_signup_funnel:{...data.graphic_signup_funnel,arriving_posthog_identities:0}}).state).toBe('empty')
    expect(reportView({...data,graphic_signup_funnel:{...data.graphic_signup_funnel,linked_signups_so_far:50}}).state).toBe('unavailable')
  })
  it('rejects malformed metric rows and renders data as text, never HTML',()=>{
    const {container}=render(<FounderReportCard data={{...data,metrics:[null,{metric:'<script>alert(1)</script>',count:1,identities:1}]}}/>)
    expect(container.querySelector('script')).toBeNull()
  })
  it('keeps details collapsed but discoverable',()=>{
    const {container}=render(<FounderReportCard data={data}/>)
    expect(container.querySelector('details')?.open).toBe(false)
    expect(screen.getByText('Activity counts, sources & limitations')).toBeTruthy()
    expect(screen.getByRole('button',{name:'Ask about this report'})).toBeTruthy()
  })
  it('puts stale evidence ahead of an optimistic activity headline',()=>{
    const now=Date.parse(data.queried_at)
    expect(growthDecision(data,now).title).toBe('Don’t judge signup conversion yet.')
    expect(growthDecision(data,now+7*3600000).title).toBe('Refresh this before making a growth decision.')
    expect(growthDecision({...data,queried_at:'invalid'},now).stale).toBe(true)
  })
  it('does not confuse mature conversion with proven improvement',()=>{
    const d={...data,graphic_signup_funnel:{...data.graphic_signup_funnel,matured_arriving_identities:4}}
    expect(growthDecision(d,Date.parse(data.queried_at)).title).toContain('not improvement')
  })
  it('hands a refresh to the agent only on click, respecting draft protection',()=>{
    const refresh=vi.fn()
    const {rerender}=render(<FounderReportCard data={data} onRefresh={refresh}/>)
    expect(refresh).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'Refresh & assess'}));expect(refresh).toHaveBeenCalledTimes(1)
    rerender(<FounderReportCard data={data} onRefresh={refresh} refreshBlocked="Unsent draft preserved"/>)
    expect((screen.getByRole('button',{name:'Refresh & assess'}) as HTMLButtonElement).disabled).toBe(true)
  })
  it('protects drafts and busy turns at the dispatch boundary',()=>{
    const submit=vi.fn((_text:string,_options:{target:'main'})=>true);const ready={hasDraft:false,running:false,requested:false}
    for(const field of ['hasDraft','running','requested'])expect(requestGrowthAssessment({...ready,[field]:true},submit).accepted).toBe(false)
    expect(submit).not.toHaveBeenCalled()
    expect(requestGrowthAssessment(ready,submit).accepted).toBe(true)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0][0]).toContain('read-only')
    expect(requestGrowthAssessment(ready,()=>false).notice).toContain('try again')
  })
  it('uses plain English for technical signals',()=>{
    expect(SIGNAL_LABELS.engagement_flush).toBe('Reading activity recorded')
    expect(SIGNAL_LABELS.legacy_share_action).toContain('overlap')
  })
  it('never borrows another user turn, prose, failed tool, or future result',()=>{
    const user={id:'u',role:'user',content:[{type:'text',text:'Show Graphic Bible growth'}]}
    const tool={id:'a',role:'assistant',content:[{type:'tool-call',toolName:'mcp__cartha_ops__get_growth_metrics',result:data}]}
    const final={id:'b',role:'assistant',status:{type:'complete'},content:[{type:'text',text:'Report'}]}
    expect(reportFromTurn([user,tool,final],'b')).toEqual(data)
    expect(reportFromTurn([{...user,content:[{type:'text',text:'Review all product reliability'}]},tool,final],'b')).toBeNull()
    expect(reportFromTurn([user,tool,{...user,id:'u2'},final],'b')).toBeNull()
    expect(reportFromTurn([user,final,tool],'b')).toBeNull()
    expect(reportFromTurn([user,tool,{...final,status:{type:'running'}}],'b')).toBeNull()
    expect(reportFromTurn([user,{...final,content:[{type:'text',text:JSON.stringify(data)}]}],'b')).toBeNull()
    expect(reportFromTurn([user,{...tool,content:[{...tool.content[0],isError:true}]},final],'b')).toBeNull()
  })
})
