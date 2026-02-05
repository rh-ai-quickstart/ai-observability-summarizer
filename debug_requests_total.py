#!/usr/bin/env python3
"""Debug script to check why Requests Total shows 0"""

import requests
import json

MCP_URL = "http://localhost:8000"

def test_metric_discovery():
    """Test 1: Check if vllm:request_success_total is discovered"""
    print("=" * 70)
    print("TEST 1: Metric Discovery")
    print("=" * 70)

    response = requests.post(
        f"{MCP_URL}/mcp",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream"
        },
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "get_vllm_metrics_tool",
                "arguments": {}
            }
        },
        timeout=15
    )

    if response.status_code == 200:
        result = response.json()
        text = result['result']['content'][0]['text']

        if 'Requests Total' in text:
            print("✅ 'Requests Total' found in metric mapping")
            # Extract the query
            for line in text.split('\n'):
                if 'Requests Total' in line:
                    print(f"   Query: {line.strip()}")
        else:
            print("❌ 'Requests Total' NOT found in metric mapping")
            print("\n📋 Available metrics (first 20 lines):")
            print('\n'.join(text.split('\n')[:20]))
    else:
        print(f"❌ Error: {response.status_code}")


def test_prometheus_direct():
    """Test 2: Query Prometheus directly for vllm:request_success_total"""
    print("\n" + "=" * 70)
    print("TEST 2: Direct Prometheus Query")
    print("=" * 70)

    response = requests.post(
        f"{MCP_URL}/mcp",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream"
        },
        json={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "execute_promql",
                "arguments": {
                    "query": "vllm:request_success_total"
                }
            }
        },
        timeout=15
    )

    if response.status_code == 200:
        result = response.json()
        text = result['result']['content'][0]['text']
        print("Query: vllm:request_success_total")
        print(f"Result:\n{text[:500]}")
    else:
        print(f"❌ Error: {response.status_code}")


def test_with_model_filter():
    """Test 3: Query with model name filter (as UI does)"""
    print("\n" + "=" * 70)
    print("TEST 3: Query with Model Filter")
    print("=" * 70)

    # First get available models
    response = requests.post(
        f"{MCP_URL}/mcp",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream"
        },
        json={
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "list_models",
                "arguments": {}
            }
        },
        timeout=15
    )

    if response.status_code == 200:
        result = response.json()
        models_text = result['result']['content'][0]['text']
        print(f"Available models:\n{models_text[:300]}")

        # Extract first model (format: "namespace | model_name")
        lines = [l.strip() for l in models_text.split('\n') if '|' in l and 'namespace' not in l.lower()]
        if lines:
            model = lines[0].replace('•', '').strip()
            print(f"\n🔍 Testing with model: {model}")

            # Parse namespace and model name
            if '|' in model:
                namespace, model_name = [s.strip() for s in model.split('|', 1)]

                # Test query with labels
                test_query = f'vllm:request_success_total{{model_name="{model_name}",namespace="{namespace}"}}'
                print(f"\n📊 Testing query: {test_query}")

                response2 = requests.post(
                    f"{MCP_URL}/mcp",
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json, text/event-stream"
                    },
                    json={
                        "jsonrpc": "2.0",
                        "id": 4,
                        "method": "tools/call",
                        "params": {
                            "name": "execute_promql",
                            "arguments": {
                                "query": test_query
                            }
                        }
                    },
                    timeout=15
                )

                if response2.status_code == 200:
                    result2 = response2.json()
                    text2 = result2['result']['content'][0]['text']
                    print(f"Result:\n{text2[:500]}")

                    if "value" in text2 or "metric" in text2:
                        print("\n✅ Metric returns data with model filter")
                    elif "Empty" in text2 or "no data" in text2.lower():
                        print("\n⚠️  Metric exists but returns no data for this model")
                        print("    Possible reasons:")
                        print("    1. Model name/namespace labels don't match")
                        print("    2. No requests have been made to this model yet")
                        print("    3. Metric labels use different names (check with search_metrics)")
                else:
                    print(f"❌ Error: {response2.status_code}")


def test_fetch_metrics_data():
    """Test 4: Full fetch_vllm_metrics_data flow"""
    print("\n" + "=" * 70)
    print("TEST 4: Full Metrics Fetch (as UI does)")
    print("=" * 70)

    # Get first model
    response = requests.post(
        f"{MCP_URL}/mcp",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream"
        },
        json={
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "list_models",
                "arguments": {}
            }
        },
        timeout=15
    )

    if response.status_code == 200:
        result = response.json()
        models_text = result['result']['content'][0]['text']
        lines = [l.strip() for l in models_text.split('\n') if '|' in l and 'namespace' not in l.lower()]

        if lines:
            model = lines[0].replace('•', '').strip()
            print(f"Testing with model: {model}")

            # Fetch metrics as UI does
            response2 = requests.post(
                f"{MCP_URL}/mcp",
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream"
                },
                json={
                    "jsonrpc": "2.0",
                    "id": 6,
                    "method": "tools/call",
                    "params": {
                        "name": "fetch_vllm_metrics_data",
                        "arguments": {
                            "model_name": model,
                            "time_range": "1h"
                        }
                    }
                },
                timeout=20
            )

            if response2.status_code == 200:
                result2 = response2.json()
                text2 = result2['result']['content'][0]['text']
                data = json.loads(text2)

                if 'Requests Total' in data['metrics']:
                    rt_data = data['metrics']['Requests Total']
                    print(f"\n✅ Requests Total metric found!")
                    print(f"   Latest value: {rt_data.get('latest_value')}")
                    print(f"   Time series points: {len(rt_data.get('time_series', []))}")

                    if rt_data.get('latest_value') == 0:
                        print("\n⚠️  Value is 0 - this could mean:")
                        print("    1. No requests have been processed")
                        print("    2. Metric counter hasn't incremented")
                        print("    3. Label filter doesn't match any time series")
                else:
                    print(f"\n❌ 'Requests Total' not in metrics data")
                    print(f"Available metrics: {list(data['metrics'].keys())[:10]}")


if __name__ == "__main__":
    print("\n🔍 Debugging 'Requests Total' showing 0\n")

    try:
        test_metric_discovery()
        test_prometheus_direct()
        test_with_model_filter()
        test_fetch_metrics_data()

        print("\n" + "=" * 70)
        print("✅ Diagnostic complete!")
        print("=" * 70)

    except Exception as e:
        print(f"\n❌ Error running diagnostic: {e}")
        import traceback
        traceback.print_exc()
