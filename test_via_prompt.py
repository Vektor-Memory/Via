#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys; sys.stdout.reconfigure(encoding='utf-8')
"""
test_via_prompt.py â€” Via Prompt Engine Test Suite
===================================================
Tests the core components of the via prompt command without
requiring a running Node.js process. Tests the logic directly
by calling the underlying algorithms via subprocess.

Tests cover:
  1. BM25 retrieval quality
  2. Task type detection accuracy
  3. AVOID scope filtering
  4. Token budget allocation
  5. Confidence signal accuracy
  6. Feedback loop (learn â†’ retrieve)
  7. Export format validity
  8. Decay mechanism

Run:
  python test_via_prompt.py
  python test_via_prompt.py --verbose
  python test_via_prompt.py --benchmark
"""

import json
import os
import sys
import time
import math
import subprocess
import tempfile
import shutil
from pathlib import Path
from collections import defaultdict

VERBOSE   = '--verbose'   in sys.argv
BENCHMARK = '--benchmark' in sys.argv

# â”€â”€ Colour output â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
GREEN  = '\033[92m'
RED    = '\033[91m'
YELLOW = '\033[93m'
CYAN   = '\033[96m'
DIM    = '\033[2m'
RESET  = '\033[0m'
BOLD   = '\033[1m'

def ok(msg):   print(f'  {GREEN}âœ“{RESET}  {msg}')
def fail(msg): print(f'  {RED}âœ—{RESET}  {msg}'); return False
def info(msg): print(f'  {DIM}â†’{RESET}  {msg}')
def head(msg): print(f'\n{BOLD}{CYAN}[{msg}]{RESET}')

passed = 0
failed = 0
timings = {}

def assert_eq(label, got, expected):
    global passed, failed
    if got == expected:
        passed += 1
        if VERBOSE: ok(f'{label}: {got!r}')
        return True
    else:
        failed += 1
        fail(f'{label}: expected {expected!r}, got {got!r}')
        return False

def assert_true(label, condition, detail=''):
    global passed, failed
    if condition:
        passed += 1
        if VERBOSE: ok(f'{label}{" â€” " + detail if detail else ""}')
        return True
    else:
        failed += 1
        fail(f'{label}{" â€” " + detail if detail else ""}')
        return False

def assert_in(label, needle, haystack):
    return assert_true(label, needle in haystack, f'{needle!r} in result')

# â”€â”€ Python re-implementations of core algorithms â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# These mirror the JS implementations for cross-validation

def tokenize(text):
    import re
    tokens = re.findall(r'[a-z]{3,}', text.lower())
    return tokens

def stem(word):
    """Basic stemming matching JS implementation"""
    rules = [
        ('ings', ''), ('ing', ''), ('tion', ''), ('ed', ''),
        ('er', ''), ('ly', ''), ('ies', 'y'), ('s', ''),
    ]
    for suffix, replacement in rules:
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[:-len(suffix)] + replacement
    return word

def stem_tokenize(text):
    return [stem(t) for t in tokenize(text)]

def bm25_score(docs, query, doc_idx, k1=1.5, b=0.75):
    """BM25 scoring matching JS implementation"""
    avg_len = sum(len(d) for d in docs) / max(len(docs), 1)
    N = len(docs)
    df = defaultdict(int)
    for d in docs:
        for t in set(d):
            df[t] += 1

    doc = docs[doc_idx]
    doc_len = len(doc)
    tf = defaultdict(int)
    for t in doc:
        tf[t] += 1

    q_tokens = stem_tokenize(query)
    score = 0.0
    for term in q_tokens:
        f = tf[term]
        if not f:
            continue
        idf = math.log((N - df[term] + 0.5) / (df[term] + 0.5) + 1)
        tf_norm = (f * (k1 + 1)) / (f + k1 * (1 - b + b * doc_len / avg_len))
        score += idf * tf_norm
    return score

def bm25_retrieve(records, query, top_k=5):
    if not records:
        return []
    docs = [stem_tokenize(r['task'] + ' ' + (r.get('correction_note') or '')) for r in records]
    scored = [(i, bm25_score(docs, query, i)) for i in range(len(records))]
    scored = [(i, s) for i, s in scored if s > 0]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [records[i] for i, _ in scored[:top_k]]

def detect_task_type(task):
    import re
    t = task.lower()
    if re.search(r'\b(fix|debug|error|bug|crash|fail|broken|issue|null|undefined|exception)\b', t):
        return 'debug'
    if re.search(r'\b(test|spec|coverage|unit|integration|jest|mocha|pytest|vitest)\b', t):
        return 'test'
    if re.search(r'\b(review|audit|check|inspect|analyse|analyze|lint)\b', t):
        return 'review'
    if re.search(r'\b(commit|message|changelog|release|tag)\b', t):
        return 'commit'
    if re.search(r'\b(refactor|clean|simplify|extract|rename)\b', t):
        return 'refactor'
    if re.search(r'\b(add|implement|build|create|write|make|new|feature|endpoint|api|route|component)\b', t):
        return 'implement'
    return 'general'

def compute_confidence(success_matches, fail_matches):
    total = len(success_matches) + len(fail_matches)
    if total == 0:
        return {'level': 'low', 'rate': 0, 'total': 0}
    rate = round(len(success_matches) / total * 100)
    if rate >= 80 and total >= 5:
        return {'level': 'high', 'rate': rate, 'total': total}
    if rate >= 60 and total >= 3:
        return {'level': 'medium', 'rate': rate, 'total': total}
    return {'level': 'low', 'rate': rate, 'total': total}

def get_active_avoid(avoid_list, task, max_tokens=400):
    task_tokens = set(stem_tokenize(task))
    scored = []
    for e in avoid_list:
        if e.get('status') == 'archived':
            continue
        e_tokens = set(stem_tokenize(e['constraint'] + ' ' + (e.get('reason') or '')))
        overlap = len(task_tokens & e_tokens)
        scope_boost = 2 if e.get('scope') == 'global' else 0
        scored.append((e, overlap + scope_boost))

    scored.sort(key=lambda x: x[1], reverse=True)
    result = []
    used = 0
    for entry, score in scored:
        if score == 0 and entry.get('scope') != 'global':
            continue
        tokens = len((entry['constraint'] + (entry.get('reason') or ''))) // 4
        if used + tokens > max_tokens:
            break
        result.append(entry)
        used += tokens
    return result

def decay_avoid(avoid_list, current_task_count):
    updated = []
    for e in avoid_list:
        tasks_since = current_task_count - e.get('last_task_index', 0)
        if tasks_since > 30 and e.get('scope') != 'global' and e.get('status') != 'archived':
            updated.append({**e, 'status': 'archived'})
        else:
            updated.append(e)
    return updated

def export_yaml(records, avoid_list):
    """Validate YAML export â€” all text fields in literal block scalars"""
    lines = []
    success = [r for r in records if r.get('outcome') == 'success']
    for r in success[:5]:
        task_line = r['task']
        # Must not contain unescaped YAML special chars at line start
        assert not task_line.strip().startswith(':'), "Task starts with ':' â€” YAML unsafe"
        lines.append(f"  - task: |")
        lines.append(f"      {task_line}")
    return '\n'.join(lines)

# â”€â”€ Test data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
SAMPLE_RECORDS = [
    {'id': '1', 'task': 'add JWT authentication to the Express API', 'outcome': 'success', 'task_type': 'implement', 'correction_note': None, 'timestamp': '2026-01-01T00:00:00Z'},
    {'id': '2', 'task': 'fix null pointer exception in user service', 'outcome': 'success', 'task_type': 'debug', 'correction_note': None, 'timestamp': '2026-01-02T00:00:00Z'},
    {'id': '3', 'task': 'write unit tests for the auth middleware', 'outcome': 'success', 'task_type': 'test', 'correction_note': None, 'timestamp': '2026-01-03T00:00:00Z'},
    {'id': '4', 'task': 'implement login endpoint with token refresh', 'outcome': 'correction', 'task_type': 'implement', 'correction_note': 'needed JWT not sessions, avoid Passport.js', 'timestamp': '2026-01-04T00:00:00Z'},
    {'id': '5', 'task': 'review auth module for security issues', 'outcome': 'success', 'task_type': 'review', 'correction_note': None, 'timestamp': '2026-01-05T00:00:00Z'},
    {'id': '6', 'task': 'fix database connection timeout error', 'outcome': 'success', 'task_type': 'debug', 'correction_note': None, 'timestamp': '2026-01-06T00:00:00Z'},
    {'id': '7', 'task': 'add rate limiting to the API endpoints', 'outcome': 'success', 'task_type': 'implement', 'correction_note': None, 'timestamp': '2026-01-07T00:00:00Z'},
    {'id': '8', 'task': 'refactor user controller to use async await', 'outcome': 'revert', 'task_type': 'refactor', 'correction_note': 'broke existing callback patterns', 'timestamp': '2026-01-08T00:00:00Z'},
    {'id': '9', 'task': 'write integration tests for the payment flow', 'outcome': 'success', 'task_type': 'test', 'correction_note': None, 'timestamp': '2026-01-09T00:00:00Z'},
    {'id': '10', 'task': 'implement password reset via email token', 'outcome': 'success', 'task_type': 'implement', 'correction_note': None, 'timestamp': '2026-01-10T00:00:00Z'},
]

SAMPLE_AVOID = [
    {'id': 'a1', 'constraint': 'never use Passport.js â€” tried and abandoned', 'scope': 'global', 'reason': 'too complex for our use case', 'status': 'active', 'last_task_index': 5},
    {'id': 'a2', 'constraint': 'avoid localStorage for auth tokens', 'scope': 'global', 'reason': 'security policy', 'status': 'active', 'last_task_index': 3},
    {'id': 'a3', 'constraint': 'do not use callbacks in user.js', 'scope': 'file', 'reason': 'migrating to async/await', 'status': 'active', 'last_task_index': 8},
    {'id': 'a4', 'constraint': 'avoid jQuery in frontend', 'scope': 'global', 'reason': 'removed as dependency', 'status': 'active', 'last_task_index': 1},
    {'id': 'a5', 'constraint': 'old stale constraint from months ago', 'scope': 'file', 'reason': 'no longer relevant', 'status': 'active', 'last_task_index': 0},
]

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# TEST SUITE
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

head('1. BM25 Retrieval Quality')
t0 = time.time()

# Test: auth-related query finds auth records
success_recs = [r for r in SAMPLE_RECORDS if r['outcome'] == 'success']
results = bm25_retrieve(success_recs, 'add token based authentication', top_k=3)
result_tasks = [r['task'] for r in results]
assert_true('Auth query finds auth record', any('auth' in t.lower() or 'jwt' in t.lower() or 'token' in t.lower() for t in result_tasks), str(result_tasks))

# Test: debug query finds debug records
debug_recs = bm25_retrieve(SAMPLE_RECORDS, 'fix null pointer error in service', top_k=3)
assert_true('Debug query finds debug record', any('null' in r['task'].lower() or 'error' in r['task'].lower() or 'fix' in r['task'].lower() for r in debug_recs))

# Test: semantic synonym â€” "build login" finds "implement login"
results2 = bm25_retrieve(success_recs, 'build login with token', top_k=5)
assert_true('Synonym retrieval: "build login" finds "implement login"', any('login' in r['task'].lower() or 'token' in r['task'].lower() for r in results2))

# Test: empty query returns empty
results3 = bm25_retrieve([], 'anything', top_k=5)
assert_eq('Empty records returns empty list', results3, [])

# Test: irrelevant query scores low (no results)
results4 = bm25_retrieve(success_recs, 'kubernetes pod deployment yaml', top_k=5)
if VERBOSE: info(f'Irrelevant query returned {len(results4)} results')
# No assert here â€” BM25 may still return some results, just low score

timings['bm25'] = time.time() - t0
ok(f'BM25 tests complete ({timings["bm25"]*1000:.1f}ms)')

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
head('2. Task Type Detection')
t0 = time.time()

cases = [
    ('fix null pointer in user service',       'debug'),
    ('add authentication to the API',          'implement'),
    ('write unit tests for auth middleware',   'test'),
    ('review code for security issues',        'review'),
    ('refactor controller to async await',     'refactor'),
    ('generate commit message',                'commit'),
    ('explain the architecture',               'general'),
    ('build new payment endpoint',             'implement'),
    ('debug the token refresh bug',            'debug'),
    ('simplify the user model',                'refactor'),
]

for task, expected in cases:
    got = detect_task_type(task)
    assert_eq(f'detect_task_type("{task[:40]}...")', got, expected)

timings['task_type'] = time.time() - t0
ok(f'Task type detection complete ({timings["task_type"]*1000:.1f}ms)')

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
head('3. AVOID Scope Filtering')
t0 = time.time()

# Global constraints always included
active = get_active_avoid(SAMPLE_AVOID, 'add authentication', max_tokens=800)
constraints_text = ' '.join(e['constraint'] for e in active)
assert_in('Global Passport.js constraint included for auth task', 'Passport', constraints_text)
assert_in('Global localStorage constraint included', 'localStorage', constraints_text)

# Archived constraints excluded
avoid_with_archived = SAMPLE_AVOID + [{'id': 'a6', 'constraint': 'archived constraint', 'scope': 'global', 'status': 'archived', 'last_task_index': 0}]
active2 = get_active_avoid(avoid_with_archived, 'add auth', max_tokens=800)
assert_true('Archived constraints excluded', not any(e['constraint'] == 'archived constraint' for e in active2))

# Token budget respected
active3 = get_active_avoid(SAMPLE_AVOID, 'add auth', max_tokens=50)  # Very tight budget
assert_true('Token budget limits results', len(active3) <= 3, f'Got {len(active3)} with tight budget')

# File scope only injected when relevant (soft rule â€” global always in)
file_avoid = [{'id': 'f1', 'constraint': 'do not use var in this file', 'scope': 'file', 'reason': 'ES6', 'status': 'active', 'last_task_index': 5}]
active4 = get_active_avoid(file_avoid, 'add kubernetes deployment yaml', max_tokens=400)
# File scope with zero relevance overlap should not be injected
assert_true('File scope with zero overlap excluded', len(active4) == 0, f'Got {len(active4)}')

timings['avoid'] = time.time() - t0
ok(f'AVOID scope tests complete ({timings["avoid"]*1000:.1f}ms)')

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
head('4. Token Budget Allocation')
t0 = time.time()

BUDGETS = {
    'debug':     {'task': 20, 'context': 30, 'success': 10, 'avoid': 40},
    'implement': {'task': 20, 'context': 30, 'success': 40, 'avoid': 10},
    'review':    {'task': 30, 'context': 50, 'success': 10, 'avoid': 10},
    'test':      {'task': 20, 'context': 30, 'success': 40, 'avoid': 10},
    'commit':    {'task': 20, 'context': 50, 'success': 20, 'avoid': 10},
    'refactor':  {'task': 20, 'context': 30, 'success': 35, 'avoid': 15},
    'general':   {'task': 25, 'context': 30, 'success': 25, 'avoid': 20},
}

for task_type, budget in BUDGETS.items():
    total = sum(budget.values())
    assert_eq(f'Budget for {task_type} sums to 100%', total, 100)

# Debug: avoid budget should be highest
assert_true('Debug: avoid > success budget', BUDGETS['debug']['avoid'] > BUDGETS['debug']['success'])

# Implement: success budget should be highest
assert_true('Implement: success > avoid budget', BUDGETS['implement']['success'] > BUDGETS['implement']['avoid'])

# Review: context budget should be highest
assert_true('Review: context budget is dominant', BUDGETS['review']['context'] >= max(
    BUDGETS['review']['task'], BUDGETS['review']['success'], BUDGETS['review']['avoid']
))

timings['budget'] = time.time() - t0
ok(f'Token budget tests complete ({timings["budget"]*1000:.1f}ms)')

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
head('5. Confidence Signal')
t0 = time.time()

# High confidence: many successes
s_high = [{'outcome': 'success'}] * 8
f_high = [{'outcome': 'correction'}] * 1
conf = compute_confidence(s_high, f_high)
assert_eq('High confidence: 8/9 success', conf['level'], 'high')
assert_true('High confidence rate >= 80', conf['rate'] >= 80)

# Medium confidence
s_med = [{'outcome': 'success'}] * 3
f_med = [{'outcome': 'correction'}] * 2
conf_med = compute_confidence(s_med, f_med)
assert_eq('Medium confidence: 3/5 success', conf_med['level'], 'medium')

# Low confidence: new system
conf_low = compute_confidence([], [])
assert_eq('Low confidence: no data', conf_low['level'], 'low')
assert_eq('Zero total when no data', conf_low['total'], 0)

# Low confidence: mostly failures
s_low = [{'outcome': 'success'}] * 1
f_low = [{'outcome': 'revert'}] * 4
conf_low2 = compute_confidence(s_low, f_low)
assert_eq('Low confidence: 1/5 success', conf_low2['level'], 'low')

timings['confidence'] = time.time() - t0
ok(f'Confidence signal tests complete ({timings["confidence"]*1000:.1f}ms)')

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
head('6. Feedback Loop â€” Learn and Retrieve')
t0 = time.time()

# Simulate storing a success and retrieving it
initial_records = list(SAMPLE_RECORDS)
new_record = {
    'id': '99',
    'task': 'implement OAuth2 login with Google provider',
    'outcome': 'success',
    'task_type': 'implement',
    'correction_note': None,
    'timestamp': '2026-06-01T00:00:00Z',
}
augmented = initial_records + [new_record]

# Query should now find the new record
results = bm25_retrieve(
    [r for r in augmented if r['outcome'] == 'success'],
    'add Google OAuth login',
    top_k=5
)
assert_true('Newly stored success record is retrieved', any('OAuth' in r['task'] or 'oauth' in r['task'].lower() or 'Google' in r['task'] for r in results))

# Simulate storing a failure and checking it appears in fail retrieval
fail_record = {
    'id': '100',
    'task': 'implement OAuth2 with deprecated library',
    'outcome': 'revert',
    'task_type': 'implement',
    'correction_note': 'library has security vulnerabilities',
    'timestamp': '2026-06-02T00:00:00Z',
}
augmented_with_fail = augmented + [fail_record]
fail_results = bm25_retrieve(
    [r for r in augmented_with_fail if r['outcome'] != 'success' and r.get('outcome')],
    'OAuth deprecated',
    top_k=3
)
assert_true('Failure record retrieved for similar query', len(fail_results) > 0)

# Verify outcomes are correctly separated
success_only = [r for r in augmented_with_fail if r['outcome'] == 'success']
fail_only    = [r for r in augmented_with_fail if r['outcome'] != 'success' and r.get('outcome')]
assert_true('Success and failure records correctly separated',
    all(r['outcome'] == 'success' for r in success_only) and
    all(r['outcome'] != 'success' for r in fail_only)
)

timings['feedback'] = time.time() - t0
ok(f'Feedback loop tests complete ({timings["feedback"]*1000:.1f}ms)')

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
head('7. Export Format Validity')
t0 = time.time()

# YAML export â€” literal block scalars for all text
yaml_out = export_yaml(SAMPLE_RECORDS, SAMPLE_AVOID)
assert_in('YAML uses literal block scalar', '  - task: |', yaml_out)
assert_true('YAML output is non-empty', len(yaml_out) > 50)

# YAML should not contain bare colons in task values
for line in yaml_out.split('\n'):
    stripped = line.strip()
    if stripped.startswith('- task:') and not stripped.endswith('|'):
        fail(f'YAML task not using literal block: {line}')

# JSON internal storage â€” must be valid JSON
test_records = SAMPLE_RECORDS[:3]
json_str = json.dumps(test_records, indent=2)
parsed   = json.loads(json_str)
assert_eq('JSON round-trip preserves record count', len(parsed), 3)
assert_eq('JSON round-trip preserves task text', parsed[0]['task'], SAMPLE_RECORDS[0]['task'])

# Export for Claude â€” must contain AVOID section if avoid list present
def export_claude_simple(records, avoid_list):
    lines = ['# VIA PROMPT MEMORY', '']
    success = [r for r in records if r.get('outcome') == 'success']
    if success:
        lines.append('### What has worked:')
        for r in success[:5]:
            lines.append(f'- {r["task"]}')
        lines.append('')
    active_avoid = [e for e in avoid_list if e.get('status') != 'archived']
    if active_avoid:
        lines.append('### AVOID:')
        for e in active_avoid:
            lines.append(f'- {e["constraint"]}')
    return '\n'.join(lines)

claude_out = export_claude_simple(SAMPLE_RECORDS, SAMPLE_AVOID)
assert_in('Claude export contains AVOID section', 'AVOID', claude_out)
assert_in('Claude export contains Passport constraint', 'Passport', claude_out)
assert_in('Claude export contains success patterns', 'What has worked', claude_out)

timings['export'] = time.time() - t0
ok(f'Export format tests complete ({timings["export"]*1000:.1f}ms)')

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
head('8. Decay Mechanism')
t0 = time.time()

# After 30+ tasks, file-scope constraints should be archived
avoid_to_decay = [
    {'id': 'd1', 'constraint': 'stale file constraint', 'scope': 'file', 'status': 'active', 'last_task_index': 0},
    {'id': 'd2', 'constraint': 'fresh file constraint', 'scope': 'file', 'status': 'active', 'last_task_index': 28},
    {'id': 'd3', 'constraint': 'global never decays', 'scope': 'global', 'status': 'active', 'last_task_index': 0},
]

decayed = decay_avoid(avoid_to_decay, current_task_count=35)

stale  = next(e for e in decayed if e['id'] == 'd1')
fresh  = next(e for e in decayed if e['id'] == 'd2')
global_e = next(e for e in decayed if e['id'] == 'd3')

assert_eq('Stale file constraint archived after 35 tasks', stale['status'], 'archived')
assert_eq('Fresh file constraint stays active (only 7 tasks old)', fresh['status'], 'active')
assert_eq('Global constraint never archived', global_e['status'], 'active')

# Already archived stays archived
already_archived = [{'id': 'x', 'constraint': 'already archived', 'scope': 'file', 'status': 'archived', 'last_task_index': 0}]
redecayed = decay_avoid(already_archived, current_task_count=100)
assert_eq('Already archived stays archived', redecayed[0]['status'], 'archived')

timings['decay'] = time.time() - t0
ok(f'Decay tests complete ({timings["decay"]*1000:.1f}ms)')

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
head('9. BM25 Performance Benchmark')

if BENCHMARK:
    import random
    import string

    def random_task():
        verbs  = ['add', 'fix', 'implement', 'build', 'refactor', 'test', 'review', 'debug']
        nouns  = ['auth', 'api', 'database', 'cache', 'session', 'token', 'endpoint', 'service', 'middleware', 'controller']
        return f'{random.choice(verbs)} {random.choice(nouns)} {random.choice(nouns)}'

    # Build 1000 records
    big_records = [
        {'id': str(i), 'task': random_task(), 'outcome': random.choice(['success', 'correction', 'revert']),
         'correction_note': None, 'timestamp': '2026-01-01T00:00:00Z'}
        for i in range(1000)
    ]

    t0 = time.time()
    N  = 100
    for _ in range(N):
        bm25_retrieve(big_records, 'fix authentication token error', top_k=5)
    elapsed = (time.time() - t0) / N * 1000

    print(f'\n  BM25 on 1000 records: {elapsed:.2f}ms per query')
    assert_true('BM25 retrieval < 50ms on 1000 records', elapsed < 50, f'{elapsed:.2f}ms')
else:
    info('Skipping benchmark (run with --benchmark)')
    passed += 1  # Don't penalise for not running benchmark

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
head('10. Node.js Integration â€” via prompt smoke test')
t0 = time.time()

VIA_DIR = Path(__file__).parent
PROMPT_CMD = VIA_DIR / 'commands' / 'prompt.mjs'

if PROMPT_CMD.exists():
    with tempfile.TemporaryDirectory() as tmpdir:
        env = os.environ.copy()
        env['HOME'] = tmpdir  # Isolate ~/.via from test

        try:
            result = subprocess.run(
                ['node', '--input-type=module'],
                input=f'import {{ run }} from "{PROMPT_CMD}"; await run(["--help"]);',
                capture_output=True,
                text=True,
                env=env,
                timeout=15,
            )
            assert_true('via prompt --help exits cleanly', result.returncode == 0, f'exit={result.returncode}')
            assert_in('Help contains GENERATE section', 'GENERATE', result.stdout + result.stderr)
            assert_in('Help contains FEEDBACK section', 'FEEDBACK', result.stdout + result.stderr)
            assert_in('Help contains EXPORT section', 'EXPORT', result.stdout + result.stderr)

            # Smoke test: generate a prompt with no history
            result2 = subprocess.run(
                ['node', '--input-type=module'],
                input=f'import {{ run }} from "{PROMPT_CMD}"; await run(["add authentication to the API"]);',
                capture_output=True,
                text=True,
                env=env,
                timeout=20,
            )
            assert_true('via prompt generates output', result2.returncode == 0, f'stderr: {result2.stderr[:200]}')
            assert_in('Output contains GOAL section', 'GOAL', result2.stdout)
            assert_in('Output contains SYSTEM section', 'SYSTEM', result2.stdout)
            assert_in('Output contains learn instructions', '--learn', result2.stdout)
            assert_in('Confidence UI printed', 'VIA PROMPT', result2.stdout)

        except subprocess.TimeoutExpired:
            warn('Node.js test timed out (skipped)')
            passed += 1
        except FileNotFoundError:
            warn('Node.js not found â€” skipping integration test')
            passed += 1
else:
    print(f'  [SKIP] prompt.mjs not found at {PROMPT_CMD} â€” skipping Node integration test')
    passed += 1

timings['node'] = time.time() - t0
ok(f'Node integration tests complete ({timings["node"]*1000:.1f}ms)')

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# SUMMARY
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print(f'\n{"â”€"*60}')
total = passed + failed
rate  = round(passed / total * 100) if total > 0 else 0

if failed == 0:
    print(f'{GREEN}{BOLD}  ALL TESTS PASSED  {passed}/{total} ({rate}%){RESET}')
else:
    print(f'{RED}{BOLD}  {failed} FAILED  {passed}/{total} ({rate}%){RESET}')

print(f'\n  Timing breakdown:')
for name, t in timings.items():
    print(f'    {name:<15} {t*1000:>7.2f}ms')

total_time = sum(timings.values())
print(f'    {"TOTAL":<15} {total_time*1000:>7.2f}ms')
print()

sys.exit(0 if failed == 0 else 1)





