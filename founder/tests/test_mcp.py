"""Real stdio transport smoke test, using disposable operations data."""
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from mcp import ClientSession,StdioServerParameters
from mcp.client.stdio import stdio_client

class MCPTests(unittest.IsolatedAsyncioTestCase):
    async def test_tools_and_missing_data(self):
        with tempfile.TemporaryDirectory() as directory:
            server=StdioServerParameters(command=sys.executable,args=[str(Path(__file__).resolve().parents[1]/'ops.py')],
                env={**os.environ,'CARTHA_OPS_HOME':directory,'CARTHA_POSTHOG_DISABLED':'1'})
            async with stdio_client(server) as (read,write):
                async with ClientSession(read,write) as client:
                    await client.initialize()
                    names={t.name for t in (await client.list_tools()).tools}
                    self.assertEqual(len(names),13)
                    self.assertFalse(names & {'terminal','send_email','query_database','execute_sql','send_message'})
                    response=await client.call_tool('get_growth_metrics',{})
                    self.assertFalse(response.isError)
                    self.assertEqual(json.loads(response.content[0].text)['status'],'unavailable')
                    response=await client.call_tool('create_followup',{'request_id':'x','contact_id':'absent','due_at':'2026-09-16T09:00:00-07:00','action':'Ask'})
                    self.assertTrue(response.isError)

if __name__=='__main__':unittest.main()
