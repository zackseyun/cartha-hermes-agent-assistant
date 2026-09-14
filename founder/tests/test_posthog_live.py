import json,tempfile,unittest,time
from datetime import datetime,timezone
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import posthog_live as live

class LiveAnalyticsTests(unittest.TestCase):
    def test_only_bounded_windows_and_aggregate_query(self):
        for value in (0,2,365,'1; DROP TABLE events',True):
            with self.assertRaises(ValueError):live.build_query(value,datetime.now(timezone.utc),{})
        sql=live.build_query(7,datetime(2026,9,14,tzinfo=timezone.utc),{})
        self.assertIn('2026-08-31',sql)
        self.assertIn('uniqIf(distinct_id',sql)
        self.assertNotIn('SELECT *',sql)
        self.assertIn('LIMIT 100',sql)
        self.assertIn('is_test_traffic',sql)
    @patch.dict('os.environ',{'CARTHA_POSTHOG_DISABLED':'0'})
    def test_live_cache_and_error_redaction(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(live,'config',return_value={}),patch.object(live,'query',return_value={'results':[['Auth Phone Failed','Unattributed / native',2,1,0,0,'2026-09-14']], 'is_cached':False}) as q:
                r=live.fetch(Path(d));self.assertEqual(r['connection'],'direct_posthog')
                self.assertTrue(live.fetch(Path(d))['served_from_cache']);self.assertEqual(q.call_count,1)
                self.assertNotIn('distinct_id',json.dumps(r))
        with tempfile.TemporaryDirectory() as d,patch.object(live,'config',side_effect=RuntimeError('secret-key')):
            r=live.fetch(Path(d));self.assertEqual(r['status'],'unavailable');self.assertNotIn('secret-key',json.dumps(r))
    @patch.dict('os.environ',{'CARTHA_POSTHOG_DISABLED':'0'})
    def test_rejects_unexpected_event_or_raw_rows(self):
        with tempfile.TemporaryDirectory() as d,patch.object(live,'config',return_value={}),patch.object(live,'query',return_value={'results':[['private-note','Cartha website',1,1,0,0,'2026-09-14']]}):
            self.assertEqual(live.fetch(Path(d))['status'],'unavailable')

if __name__=='__main__':unittest.main()
