#!/usr/bin/env python3
"""
Debug script to investigate P95 Latency discrepancy between React and Streamlit UIs.

This script queries Prometheus directly to see what values are being returned
for the P95 Latency metric.
"""

import requests
import json
import os
from datetime import datetime

# Configuration
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "https://thanos-querier-openshift-monitoring.apps.cpolab34.lab.upshift.rdu2.redhat.com")
THANOS_TOKEN = os.getenv("THANOS_TOKEN", "")
VERIFY_SSL = os.getenv("VERIFY_SSL", "false").lower() == "true"

# Test model - update this to match your environment
MODEL_NAME = "meta-llama/Llama-3.2-3B-Instruct"
NAMESPACE = "demo3"

def query_prometheus(query, params=None):
    """Query Prometheus and return results"""
    headers = {"Authorization": f"Bearer {THANOS_TOKEN}"}
    url = f"{PROMETHEUS_URL}/api/v1/query"

    query_params = {"query": query}
    if params:
        query_params.update(params)

    print(f"\n🔍 Querying: {query}")
    print(f"   Params: {query_params}")

    response = requests.get(
        url,
        headers=headers,
        params=query_params,
        verify=VERIFY_SSL,
        timeout=30,
    )
    response.raise_for_status()
    result = response.json()

    print(f"   Status: {result.get('status')}")
    if result.get('status') == 'success':
        data = result.get('data', {})
        result_type = data.get('resultType')
        results = data.get('result', [])
        print(f"   Result Type: {result_type}")
        print(f"   Number of results: {len(results)}")
        return results
    else:
        print(f"   Error: {result.get('error')}")
        return []

def main():
    print("=" * 80)
    print("P95 Latency Diagnostic Tool")
    print("=" * 80)
    print(f"\nModel: {NAMESPACE} | {MODEL_NAME}")
    print(f"Prometheus URL: {PROMETHEUS_URL}")
    print(f"SSL Verification: {VERIFY_SSL}")

    # Test 1: Check if the histogram bucket metric exists
    print("\n" + "=" * 80)
    print("TEST 1: Check if histogram bucket metric exists")
    print("=" * 80)
    query1 = f'vllm:e2e_request_latency_seconds_bucket{{model_name="{MODEL_NAME}",namespace="{NAMESPACE}"}}'
    results1 = query_prometheus(query1)

    if results1:
        print(f"\n   ✅ Found {len(results1)} histogram buckets")
        # Show first few buckets
        for i, result in enumerate(results1[:5]):
            metric = result.get('metric', {})
            value = result.get('value', [])
            le = metric.get('le', 'unknown')
            val = value[1] if len(value) > 1 else 'N/A'
            print(f"      Bucket {i+1}: le={le}, value={val}")
        if len(results1) > 5:
            print(f"      ... and {len(results1) - 5} more buckets")
    else:
        print("   ❌ No histogram buckets found - metric may not be available")

    # Test 2: Check the rate over 5 minutes
    print("\n" + "=" * 80)
    print("TEST 2: Check rate(bucket[5m])")
    print("=" * 80)
    query2 = f'sum(rate(vllm:e2e_request_latency_seconds_bucket{{model_name="{MODEL_NAME}",namespace="{NAMESPACE}"}}[5m])) by (le)'
    results2 = query_prometheus(query2)

    if results2:
        print(f"\n   ✅ Rate calculation returned {len(results2)} buckets")
        for i, result in enumerate(results2[:5]):
            metric = result.get('metric', {})
            value = result.get('value', [])
            le = metric.get('le', 'unknown')
            val = value[1] if len(value) > 1 else 'N/A'
            print(f"      Bucket {i+1}: le={le}, rate={val}")
        if len(results2) > 5:
            print(f"      ... and {len(results2) - 5} more buckets")
    else:
        print("   ⚠️ Rate returned no results - no requests in last 5 minutes")

    # Test 3: The actual P95 latency query
    print("\n" + "=" * 80)
    print("TEST 3: Actual P95 Latency query (histogram_quantile)")
    print("=" * 80)
    query3 = f'histogram_quantile(0.95, sum(rate(vllm:e2e_request_latency_seconds_bucket{{model_name="{MODEL_NAME}",namespace="{NAMESPACE}"}}[5m])) by (le))'
    results3 = query_prometheus(query3)

    if results3:
        for result in results3:
            value = result.get('value', [])
            timestamp = value[0] if len(value) > 0 else 'N/A'
            p95_value = value[1] if len(value) > 1 else 'N/A'

            print(f"\n   📊 P95 Latency Result:")
            print(f"      Timestamp: {datetime.fromtimestamp(float(timestamp)) if timestamp != 'N/A' else 'N/A'}")
            print(f"      Value: {p95_value}")

            if p95_value != 'N/A':
                try:
                    p95_float = float(p95_value)
                    print(f"      Formatted: {p95_float:.2f}s = {p95_float*1000:.0f}ms")

                    if p95_float == 0:
                        print("      ✅ ZERO latency - no requests in last 5 minutes")
                    elif p95_float > 0:
                        print(f"      ⚠️ NON-ZERO latency: {p95_float}s")
                except:
                    print(f"      ❌ Could not parse value: {p95_value}")
    else:
        print("   ⚠️ No P95 latency value returned")

    # Test 4: Check without model filter (global P95)
    print("\n" + "=" * 80)
    print("TEST 4: Global P95 Latency (no model filter)")
    print("=" * 80)
    query4 = 'histogram_quantile(0.95, sum(rate(vllm:e2e_request_latency_seconds_bucket[5m])) by (le))'
    results4 = query_prometheus(query4)

    if results4:
        for result in results4:
            value = result.get('value', [])
            p95_value = value[1] if len(value) > 1 else 'N/A'
            print(f"   Global P95: {p95_value}")
    else:
        print("   ⚠️ No global P95 value")

    # Test 5: Check if there's an alternative metric
    print("\n" + "=" * 80)
    print("TEST 5: Check for alternative latency metrics")
    print("=" * 80)
    query5 = f'vllm:e2e_request_latency_seconds_sum{{model_name="{MODEL_NAME}",namespace="{NAMESPACE}"}}'
    results5 = query_prometheus(query5)

    if results5:
        for result in results5:
            value = result.get('value', [])
            val = value[1] if len(value) > 1 else 'N/A'
            print(f"   e2e_request_latency_seconds_sum: {val}")

    query6 = f'vllm:e2e_request_latency_seconds_count{{model_name="{MODEL_NAME}",namespace="{NAMESPACE}"}}'
    results6 = query_prometheus(query6)

    if results6:
        for result in results6:
            value = result.get('value', [])
            val = value[1] if len(value) > 1 else 'N/A'
            print(f"   e2e_request_latency_seconds_count: {val}")

    # Calculate average latency if both sum and count exist
    if results5 and results6:
        sum_val = float(results5[0].get('value', [None, '0'])[1])
        count_val = float(results6[0].get('value', [None, '0'])[1])
        if count_val > 0:
            avg = sum_val / count_val
            print(f"\n   Average Latency: {sum_val}/{count_val} = {avg:.2f}s = {avg*1000:.0f}ms")
        else:
            print("\n   Average Latency: N/A (no requests)")

    print("\n" + "=" * 80)
    print("CONCLUSION")
    print("=" * 80)
    print("\nNext steps:")
    print("1. If histogram_quantile returns a value > 0 but there's no recent activity,")
    print("   this means the query is using old bucket data.")
    print("2. If rate() returns 0 for all buckets, P95 should be 0 or NaN.")
    print("3. Check if the React UI is using instant query vs range query.")
    print("4. Verify the time range being used in both UIs.")

if __name__ == "__main__":
    main()
