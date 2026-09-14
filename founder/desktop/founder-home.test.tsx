import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
const insert=vi.fn();const focus=vi.fn()
vi.mock('@/app/chat/composer/focus',()=>({requestComposerInsert:(...args:unknown[])=>insert(...args),requestComposerFocus:(...args:unknown[])=>focus(...args)}))
import { FounderHome, FOUNDER_WORKFLOWS } from './founder-home'
afterEach(()=>{cleanup();vi.clearAllMocks()})
describe('Founder home',()=>{
  it('exposes clear workflows and honest integration limits',()=>{
    render(<FounderHome />)
    expect(screen.getByRole('heading',{name:'What needs your attention?'})).toBeTruthy()
    for(const w of FOUNDER_WORKFLOWS)expect(screen.getByRole('button',{name:new RegExp(w.title)})).toBeTruthy()
    expect(screen.getByText(/Direct PostHog queries/)).toBeTruthy()
    expect(screen.getByText(/Outreach requires your approval/)).toBeTruthy()
  })
  it('prepares a read-only brief without submitting or replacing a draft',()=>{
    render(<FounderHome />);fireEvent.click(screen.getByRole('button',{name:/Prepare my brief/}))
    expect(insert).toHaveBeenCalledWith(expect.stringContaining('Call founder_brief'),{mode:'block',target:'main'})
    expect(focus).toHaveBeenCalledWith('main')
    expect(screen.getByRole('status').textContent).toContain('Review it, then send')
  })
  it.each(FOUNDER_WORKFLOWS)('$title loads its matching guarded prompt',w=>{
    render(<FounderHome />);fireEvent.click(screen.getByRole('button',{name:new RegExp(w.title)}))
    expect(insert).toHaveBeenCalledWith(w.prompt,{mode:'block',target:'main'})
  })
})
