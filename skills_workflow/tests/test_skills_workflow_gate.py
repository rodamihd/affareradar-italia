import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from skills_workflow_gate import EXPECTED, route, validate

MANIFEST = json.loads((ROOT / 'skills-workflow-manifest.json').read_text(encoding='utf-8'))


class SkillsWorkflowTest(unittest.TestCase):
    def test_complete_catalog(self):
        self.assertEqual(len(EXPECTED), 22)
        self.assertEqual(validate(MANIFEST), [])

    def test_five_projects(self):
        self.assertEqual(len(MANIFEST['projects']), 5)

    def test_no_automation(self):
        for project, data in MANIFEST['projects'].items():
            self.assertFalse(data['runtime_enabled'], project)
            for s in data['stages']:
                self.assertTrue(s['requires_human_review'])
                self.assertIn(s['action'], ('ADVISORY', 'REVIEW', 'HOLD'))

    def test_routing_is_advisory_only(self):
        for project, data in MANIFEST['projects'].items():
            for s in data['stages']:
                result = route(MANIFEST, project, s['id'])
                self.assertFalse(result['automatic_execution'])
                self.assertFalse(result['runtime_skill_invocation'])
                self.assertTrue(result['requires_human_review'])
                self.assertIn(result['status'], ('HUMAN_REVIEW_REQUIRED', 'REFERENCE_ONLY'))

    def test_broken_catalog_blocks(self):
        bad = copy.deepcopy(MANIFEST)
        bad['skills'].remove('integration-evidence-gates')
        self.assertIn('skill_catalog_mismatch', validate(bad))
        self.assertEqual(route(bad, 'quotai', 'provider-ingest')['status'], 'BLOCKED')

    def test_autonomy_attempt_blocks(self):
        bad = copy.deepcopy(MANIFEST)
        bad['policy']['automatic_execution'] = True
        self.assertIn('automatic_execution_must_be_false', validate(bad))

    def test_gate_removed_blocks(self):
        bad = copy.deepcopy(MANIFEST)
        bad['projects']['assuranceos']['hard_stops'] = []
        self.assertIn('assuranceos:missing_hard_stop', validate(bad))

    def test_wrong_freshness_blocks(self):
        bad = copy.deepcopy(MANIFEST)
        bad['projects']['quotai']['freshness_seconds']['live'] = 600
        self.assertIn('quotai:freshness_policy_mismatch', validate(bad))

    def test_unknown_route_not_configured(self):
        self.assertEqual(route(MANIFEST, 'quotai', 'place-bet')['status'], 'NOT_CONFIGURED')

    def test_paused_project_reference_only(self):
        self.assertEqual(route(MANIFEST,'sceltasemplice','tariff-design')['status'], 'REFERENCE_ONLY')

    def test_duplicate_stage_blocks(self):
        bad = copy.deepcopy(MANIFEST)
        bad['projects']['agentos']['stages'].append(copy.deepcopy(bad['projects']['agentos']['stages'][0]))
        self.assertIn('agentos:duplicate_stages', validate(bad))

    def test_unrouted_skill_blocks(self):
        bad = copy.deepcopy(MANIFEST)
        for project in bad['projects'].values():
            for step in project['stages']:
                step['skills'] = [x for x in step['skills'] if x != 'structured-data-schema-audit']
        self.assertTrue(any(x.startswith('unrouted_skills:') for x in validate(bad)))


if __name__ == '__main__':
    unittest.main()
