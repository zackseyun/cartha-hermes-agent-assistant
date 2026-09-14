import { useState } from 'react'
import { ArrowRight, BarChart3, BookOpen, Code2, FileText, FlaskConical, LockKeyhole, Plug, Users } from 'lucide-react'
import { requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { Button } from '@/components/ui/button'
import './founder-home.css'

export const FOUNDER_WORKFLOWS = [
  { title: 'Growth', detail: 'Understand product signals and data gaps.', icon: BarChart3,
    prompt: 'Use growth-analysis. Read get_growth_metrics and summarize the most important product signals, observation dates, and missing metrics. Query 7 days of direct PostHog aggregates using get_growth_metrics with window_days 7. Disclose cache age, event coverage and any report fallback. Do not modify records.' },
  { title: 'Sales & follow-ups', detail: 'Find the next step for each relationship.', icon: Users,
    prompt: 'Use sales-pipeline and follow-up-manager. Check get_stale_leads and list_contacts. Show explicitly due follow-ups first, then help me choose a small research cohort. Keep research leads separate from warm relationships. Draft only; do not send or modify records.' },
  { title: 'Experiments', detail: 'Turn a hypothesis into a clear decision.', icon: FlaskConical,
    prompt: 'Use experiment-tracker. Read get_experiment_results and show what is due for a decision. If the register is empty, ask for one hypothesis and help define its metric, baseline, success rule, stop rule and review date. Do not invent results or save until I provide the details.' },
  { title: 'Engineering', detail: 'Prepare a scoped request for approval.', icon: Code2,
    prompt: 'Use codex-engineering. Read get_codex_task_status and show requests awaiting approval. Help me draft one evidence-based engineering request with acceptance tests. A request is not a dispatched Codex task; do not dispatch or change production.' }
]

export function FounderHome() {
  const [selected, setSelected] = useState('')
  function choose(label: string, prompt: string) {
    requestComposerInsert(prompt, { mode: 'block', target: 'main' })
    requestComposerFocus('main')
    setSelected(label)
  }
  return (
    <section className="founder-home" aria-labelledby="founder-title">
      <header>
        <p className="founder-eyebrow">CARTHA / FOUNDER</p>
        <h1 id="founder-title">What needs your attention?</h1>
        <p className="founder-subtitle">One founder agent. Four focused ways to move forward.</p>
      </header>
      <Button variant="secondary" aria-label="Prepare my brief" className="founder-brief" onClick={() => choose('Founder brief',
        'Use founder-brief. Call founder_brief and give me the three most useful actions, followed by Growth, Sales, Experiments and Blockers. State observation dates and missing data. Read only; do not send messages or create records.')}>
        <FileText aria-hidden="true" />
        <span><strong>Prepare my brief</strong><small>Growth, follow-ups and experiments in one place</small></span>
        <ArrowRight aria-hidden="true" />
      </Button>
      <div className="founder-workflows" aria-label="Founder workflows">
        {FOUNDER_WORKFLOWS.map(({ title, detail, icon: Icon, prompt }) => (
          <Button key={title} aria-label={title} variant="outline" className="founder-workflow" onClick={() => choose(title, prompt)}>
            <Icon aria-hidden="true" /><span><strong>{title}</strong><small>{detail}</small></span><ArrowRight aria-hidden="true" />
          </Button>
        ))}
      </div>
      <div className="founder-boundaries">
        <span><Plug aria-hidden="true" />Direct PostHog queries · 5-minute cache</span>
        <span><LockKeyhole aria-hidden="true" />Outreach requires your approval</span>
      </div>
      <footer>
        <div className="founder-secondary">
          <Button variant="text" onClick={() => choose('Church research', 'Use church-research. Read get_business_context and help me prepare a focused church discovery conversation. Cite dated sources, distinguish facts from hypotheses, and do not contact anyone.')}><BookOpen aria-hidden="true" />Church research</Button>
          <Button variant="text" onClick={() => choose('Connections', 'Read founder_brief and explain which integrations actually have data, their freshness, and what is not connected. Distinguish direct PostHog results from any report fallback, reminders from calendar events, and engineering requests from dispatched tasks.')}><Plug aria-hidden="true" />Check connections</Button>
        </div>
        <p className="founder-guidance" role="status">{selected ? `${selected} prompt added below. Review it, then send.` : 'Choose a workflow to prepare a prompt—or just tell me what happened.'}</p>
        <p className="founder-schedule">Morning brief configured for 9 AM Pacific · Manage in Scheduled jobs</p>
      </footer>
    </section>
  )
}
