import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from skills_workflow_gate import EXPECTED, ACTIVATION_PENDING, route, validate

MANIFEST = json.loads((ROOT / 'skills-workflow-manifest.json').read_text(encoding='utf-8'))


class SkillsWorkflowTest(unittest.TestCase):
    def test_complete_catalog(self):
        self.assertEqual(len(EXPECTED), 24)
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


    def test_two_skills_pending_discovery(self):
        self.assertEqual(ACTIVATION_PENDING, {'test-driven-development', 'agent-browser'})
        self.assertEqual(set(MANIFEST['activation_pending_ids']), ACTIVATION_PENDING)

    def test_missing_pending_status_blocks(self):
        bad = copy.deepcopy(MANIFEST)
        bad['activation_pending_ids'] = []
        self.assertIn('activation_pending_evidence_required', validate(bad))
        self.assertEqual(route(bad, 'agentos', 'change-review')['status'], 'BLOCKED')

    def test_pending_skills_are_not_eligible_for_invocation(self):
        for project, config in MANIFEST['projects'].items():
            for stage in config['stages']:
                result = route(MANIFEST, project, stage['id'])
                self.assertFalse(set(result['candidate_skills']) & ACTIVATION_PENDING)
                self.assertEqual(set(result['pending_skill_ids']),
                                 set(stage['skills']) & ACTIVATION_PENDING)
                self.assertFalse(result['automatic_execution'])

    def test_new_skills_routed_to_all_five_projects(self):
        for project, config in MANIFEST['projects'].items():
            all_skills = {skill for stage in config['stages'] for skill in stage['skills']}
            self.assertIn('test-driven-development', all_skills, project)
            self.assertIn('agent-browser', all_skills, project)

    def test_browser_stages_require_isolated_previews(self):
        for project, config in MANIFEST['projects'].items():
            for stage in config['stages']:
                if 'agent-browser' in stage['skills']:
                    self.assertIn('approved_nonproduction_preview',
                                  stage['required_evidence'])
                    self.assertTrue(stage['requires_human_review'])

    def test_quotai_and_assuranceos_browser_stages_are_supervised(self):
        for project, stage_id in [('quotai', 'shadow-console-ui'),
                                  ('assuranceos', 'studio-ui-review')]:
            stage = next(stage for stage in MANIFEST['projects'][project]['stages']
                         if stage['id'] == stage_id)
            self.assertEqual(stage['action'], 'REVIEW')
            self.assertIn('agent-browser', stage['skills'])
            self.assertIn('webapp-acceptance-tests', stage['skills'])


if __name__ == '__main__':
    unittest.main()
