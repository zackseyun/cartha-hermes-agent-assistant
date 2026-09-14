import sys,tempfile,unittest,json,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import ops
from refresh import atomic_json
from run_founder import clean_environment

class OperationsTests(unittest.TestCase):
    def setUp(self):
        self.previous=os.environ.get('CARTHA_POSTHOG_DISABLED');os.environ['CARTHA_POSTHOG_DISABLED']='1'
        self.temp=tempfile.TemporaryDirectory();ops.HOME=Path(self.temp.name)
        ops.update_contact('lead','Test Person','Test Church','churches','lead','fixture')
    def tearDown(self):
        self.temp.cleanup()
        if self.previous is None:os.environ.pop('CARTHA_POSTHOG_DISABLED',None)
        else:os.environ['CARTHA_POSTHOG_DISABLED']=self.previous
    def test_followup_idempotency_and_due_dates(self):
        for _ in range(2):ops.create_followup('one','lead','2026-09-16T09:00:00-07:00','Ask for feedback')
        self.assertEqual(len(ops.get_stale_leads('2026-09-16T17:00:00Z')['followups']),1)
        self.assertEqual(len(ops.get_stale_leads('2026-09-15T17:00:00Z')['followups']),0)
        with self.assertRaises(ValueError):ops.create_followup('one','lead','2026-09-17T09:00:00-07:00','Changed')
        ops.complete_followup('one');self.assertEqual(ops.get_stale_leads('2026-09-17T17:00:00Z')['followups'],[])
    def test_suppression(self):
        ops.update_contact('lead','Test','Church','churches','do_not_contact','fixture')
        with self.assertRaises(ValueError):ops.create_followup('two','lead','2026-09-16T09:00:00-07:00','Ask')
        with self.assertRaises(ValueError):ops.update_contact('lead','Test','Church','churches','lead','fixture')
    def test_naive_time_rejected(self):
        with self.assertRaises(ValueError):ops.timestamp('2026-09-16T09:00:00')
    def test_missing_not_zero(self):
        self.assertEqual(ops.get_growth_metrics()['status'],'unavailable')
        self.assertIsNone(ops.get_calendar()['events'])
    def test_stale_report(self):
        atomic_json(ops.HOME/'growth.json',{'data':{'generated_at':'2020-01-01T00:00:00Z'}})
        self.assertEqual(ops.get_growth_metrics()['status'],'stale')
    def test_request_not_dispatched(self):
        r=ops.create_codex_task('req','Fix attribution','Missing funnel','Add tests','fixture')
        self.assertFalse(r['dispatched']);self.assertEqual(r['state'],'awaiting_approval')
        with self.assertRaises(ValueError):ops.create_codex_task('req','Different','Missing funnel','Add tests','fixture')
    def test_experiment(self):
        ops.record_experiment('test','pob','Sharing improves','shares/readers','unknown','predeclare','stop if harmful','2026-09-20T09:00:00-07:00','fixture')
        self.assertEqual(ops.get_experiment_results()[0]['status'],'proposed')
    def test_unknown_stage(self):
        with self.assertRaises(ValueError):ops.update_contact('x','Test','Church','churches','interested_from_open','fixture')
    def test_sql_is_data(self):
        ops.list_contacts(limit=10)
        self.assertEqual(ops.get_codex_task_status("' OR 1=1 --"),[])
    def test_no_inherited_provider_or_cloud_keys(self):
        env=clean_environment({'PATH':'/bin','OPENROUTER_API_KEY':'secret','OPENAI_API_KEY':'secret','AWS_PROFILE':'production','PYTHONPATH':'/unsafe'})
        self.assertEqual(env['PATH'],'/bin')
        for key in ('OPENROUTER_API_KEY','OPENAI_API_KEY','AWS_PROFILE','PYTHONPATH'):self.assertNotIn(key,env)
    def test_review_schedule_reports_only_enabled_future_job(self):
        ops.HOME=Path(self.temp.name)/'operations'
        cron=ops.HOME.parent/'cron';cron.mkdir()
        p=cron/'jobs.json'
        job={'id':'d98241cad25c','enabled':True,'next_run_at':'2099-01-01T09:00:00-08:00'}
        p.write_text(json.dumps({'jobs':[job]}))
        self.assertEqual(ops.get_review_schedule()['status'],'scheduled')
        job['enabled']=False;p.write_text(json.dumps({'jobs':[job]}))
        self.assertEqual(ops.get_review_schedule()['status'],'unavailable')

if __name__=='__main__':unittest.main()
