#!/usr/bin/env python3
"""Read-only validation and routing for ChatGPT Skills workflow manifests.

This CLI DOES NOT invoke Skills, read private evidence, post offers, place bets,
contact live APIs, deploy, sign audit opinions or change approval status.
"""
import argparse
import json
from pathlib import Path

EXPECTED = frozenset('''integration-evidence-gates evidence-first-verification repository-threat-review requirements-code-traceability audit-spreadsheet-review invariant-property-tests search-visibility-audit event-analytics-audit connector-schema-design change-diff-review webapp-acceptance-tests vercel-react-performance-review dependency-supply-chain-audit structured-data-schema-audit skill-discovery-governance find-skills agentos-systematic-debugging assuranceos-audit-workpapers assuranceos-reconciliations quotai-statistical-analysis quotai-data-validation affareradar-ui-review'''.split())
SCHEMA = 'skills-workflow-routing/1.0'


def validate(manifest):
    errors = []
    if manifest.get('schema') != SCHEMA:
        errors.append('wrong_schema')
    if manifest.get('policy', {}).get('runtime_skill_invocation') is not False:
        errors.append('runtime_skill_invocation_must_be_false')
    if manifest.get('policy', {}).get('automatic_execution') is not False:
        errors.append('automatic_execution_must_be_false')
    if manifest.get('policy', {}).get('require_human_approval') is not True:
        errors.append('require_human_approval_missing')
    declared = manifest.get('skills', [])
    if len(declared) != len(set(declared)):
        errors.append('duplicate_skill_ids')
    if set(declared) != EXPECTED:
        errors.append('skill_catalog_mismatch')
    projects = manifest.get('projects', {})
    for project_name, project in projects.items():
        if project.get('mode') not in {'SUPERVISED', 'SHADOW', 'PAUSED'}:
            errors.append(f'{project_name}:unsafe_project_mode')
        if project.get('runtime_enabled') is not False:
            errors.append(f'{project_name}:runtime_cannot_be_enabled')
        stages = project.get('stages', [])
        if not stages:
            errors.append(f'{project_name}:no_stages')
        ids = [s.get('id') for s in stages]
        if len(ids) != len(set(ids)):
            errors.append(f'{project_name}:duplicate_stages')
        for s in stages:
            if not s.get('id') or not s.get('name'):
                errors.append(f'{project_name}:missing_stage_identity')
            if not s.get('skills') or not set(s['skills']).issubset(EXPECTED):
                errors.append(f'{project_name}:{s.get("id")}:unknown_or_empty_skills')
            if s.get('action') not in {'ADVISORY', 'REVIEW', 'HOLD'}:
                errors.append(f'{project_name}:{s.get("id")}:unsafe_stage_action')
            if s.get('requires_human_review') is not True:
                errors.append(f'{project_name}:{s.get("id")}:requires_human_review')
    for proj, expected in [('agentos', 'NO_AUTONOMOUS_PROMOTION'), ('assuranceos', 'NO_HUMAN_SIGNOFF_NO_FINAL_OPINION'), ('quotai', 'NO_BET_EXECUTION'), ('affareradar', 'NO_AUTOMATIC_PUBLICATION')]:
        if proj in projects and expected not in projects[proj].get('hard_stops', []):
            errors.append(f'{proj}:missing_hard_stop')
    if 'quotai' in projects:
        freshness = projects['quotai'].get('freshness_seconds') or {}
        if freshness.get('prematch') != 120 or freshness.get('live') != 15:
            errors.append('quotai:freshness_policy_mismatch')
    if 'sceltasemplice' in projects and projects['sceltasemplice'].get('mode') != 'PAUSED':
        errors.append('sceltasemplice:unexpected_unpause')
    if set(projects) != {'agentos','assuranceos','quotai','affareradar','sceltasemplice'}:
        errors.append('project_coverage_mismatch')
    used = {skill for project in projects.values() for stage in project.get('stages', []) for skill in stage.get('skills', [])}
    if used != EXPECTED:
        errors.append('unrouted_skills:' + ','.join(sorted(EXPECTED - used)))
    return errors


def route(manifest, project, stage):
    errors = validate(manifest)
    if errors:
        return {'status': 'BLOCKED', 'errors': errors, 'automatic_execution': False}
    p = manifest['projects'].get(project)
    if not p:
        return {'status': 'NOT_CONFIGURED', 'automatic_execution': False}
    step = next((s for s in p['stages'] if s['id'] == stage), None)
    if not step:
        return {'status': 'NOT_CONFIGURED', 'automatic_execution': False}
    return {
        'status': 'REFERENCE_ONLY' if p['mode'] == 'PAUSED' else 'HUMAN_REVIEW_REQUIRED',
        'project': project, 'stage': stage, 'mode': p['mode'],
        'candidate_skills': step['skills'],
        'required_evidence': step.get('required_evidence', []),
        'requires_human_review': True,
        'runtime_skill_invocation': False, 'automatic_execution': False,
        'note': 'Skills are ChatGPT procedures, not imported executable services. Explicitly invoke relevant installed Skill during a supervised review.'
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--project')
    parser.add_argument('--stage')
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    if args.project or args.stage:
        if not args.project or not args.stage:
            parser.error('--project and --stage must appear together')
        result = route(manifest, args.project, args.stage)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))
        raise SystemExit(0 if result['status'] in {'HUMAN_REVIEW_REQUIRED','REFERENCE_ONLY'} else 2)
    errors = validate(manifest)
    print(json.dumps({'status': 'VALIDATED_OFFLINE' if not errors else 'BLOCKED', 'errors': errors, 'skills_count': len(manifest.get('skills', [])), 'projects_count': len(manifest.get('projects', {})), 'automatic_execution': False}, sort_keys=True))
    raise SystemExit(0 if not errors else 2)


if __name__ == '__main__':
    main()
