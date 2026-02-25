"""Tests for extract_namespace_from_question() in question_classification module."""

import pytest
from core.question_classification import extract_namespace_from_question


@pytest.mark.parametrize("question,expected", [
    # Explicit patterns
    ("Any pods failing in jianrong namespace?", "jianrong"),
    ("Check metrics in namespace llm-serving", "llm-serving"),
    ("What's happening in the namespace default?", "default"),
    ("Show alerts for namespace kube-system", "kube-system"),
    ("On namespace openshift-ai, any issues?", "openshift-ai"),
    ("ns:my-app show pod status", "my-app"),
    ("namespace=prod-ml check GPU usage", "prod-ml"),

    # No namespace
    ("What's the cluster CPU usage?", None),
    ("Show me GPU temperature", None),
    ("Any alerts firing?", None),

    # False positive guards
    ("Switch to namespace scoped mode", None),
    ("Use namespace specific filter", None),
])
def test_extract_namespace_from_question(question, expected):
    assert extract_namespace_from_question(question) == expected
