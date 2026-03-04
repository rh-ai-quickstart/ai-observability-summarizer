#!/bin/bash
# Verify that all dependency files use exact version pinning (==) not ranges (>=, ~=, etc.)

set -e

echo "🔍 Verifying dependency version locks..."
echo ""

ERRORS=0

# Check pyproject.toml for >= operators in dependencies
echo "Checking pyproject.toml..."
if grep -E 'dependencies|dependency-groups' -A 50 pyproject.toml | grep -E '>=|~=|\^' | grep -v '#'; then
    echo "❌ FAIL: Found range operators (>=, ~=, ^) in pyproject.toml dependencies"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ PASS: All dependencies in pyproject.toml use exact versions"
fi
echo ""

# Check requirements.txt files
for reqfile in src/mcp_server/requirements.txt src/ui/requirements.txt tests/alert-example/app/requirements.txt; do
    if [ -f "$reqfile" ]; then
        echo "Checking $reqfile..."
        if grep -v '^#' "$reqfile" | grep -v '^$' | grep -E '>=|~=|\^|<|>'; then
            echo "❌ FAIL: Found range operators in $reqfile"
            ERRORS=$((ERRORS + 1))
        else
            echo "✅ PASS: All dependencies in $reqfile use exact versions"
        fi
        echo ""
    fi
done

# Check Dockerfiles for unpinned pip installs (excluding -r requirements.txt)
echo "Checking Dockerfiles for unpinned dependencies..."
for dockerfile in src/mcp_server/Dockerfile src/ui/Dockerfile src/alerting/Dockerfile; do
    if [ -f "$dockerfile" ]; then
        echo "Checking $dockerfile..."
        # Look for pip install without == version pins (but allow -r requirements.txt)
        if grep 'pip install' "$dockerfile" | grep -v '==' | grep -v '^#' | grep -v '\-r' | grep -v 'upgrade pip'; then
            echo "❌ FAIL: Found unpinned pip install in $dockerfile"
            ERRORS=$((ERRORS + 1))
        else
            echo "✅ PASS: All pip installs in $dockerfile use exact versions or requirements files"
        fi
        echo ""
    fi
done

# Check Python version consistency
echo "Checking Python version consistency..."
PYTHON_VERSION=$(cat .python-version | tr -d '\n')
echo "Python version in .python-version: $PYTHON_VERSION"

# Check pyproject.toml
PYPROJECT_PYTHON=$(grep 'requires-python' pyproject.toml | grep -oE '[0-9]+\.[0-9]+' | head -1)
echo "Python version in pyproject.toml: $PYPROJECT_PYTHON"

if [ "$PYTHON_VERSION" != "$PYPROJECT_PYTHON" ]; then
    echo "⚠️  WARNING: Python version mismatch between .python-version and pyproject.toml"
    ERRORS=$((ERRORS + 1))
fi

# Check Dockerfiles
for dockerfile in src/mcp_server/Dockerfile src/ui/Dockerfile src/alerting/Dockerfile; do
    if [ -f "$dockerfile" ]; then
        DOCKER_PYTHON=$(grep 'FROM.*python-' "$dockerfile" | grep -oE 'python-[0-9]+' | sed 's/python-//')
        if [ -n "$DOCKER_PYTHON" ]; then
            # Convert 311 to 3.11
            DOCKER_PYTHON_FORMATTED="${DOCKER_PYTHON:0:1}.${DOCKER_PYTHON:1}"
            echo "Python version in $dockerfile: $DOCKER_PYTHON_FORMATTED"
            if [ "$PYTHON_VERSION" != "$DOCKER_PYTHON_FORMATTED" ]; then
                echo "❌ FAIL: Python version mismatch in $dockerfile (expected $PYTHON_VERSION, got $DOCKER_PYTHON_FORMATTED)"
                ERRORS=$((ERRORS + 1))
            else
                echo "✅ PASS: Python version matches in $dockerfile"
            fi
        fi
    fi
done
echo ""

# Check Node.js version consistency (openshift-plugin)
if [ -f "openshift-plugin/.nvmrc" ] && [ -f "openshift-plugin/package.json" ]; then
    echo "Checking Node.js version consistency..."
    NODE_VERSION=$(cat openshift-plugin/.nvmrc | tr -d '\n')
    echo "Node version in .nvmrc: $NODE_VERSION"

    # Check package.json engines field
    if grep -q '"engines"' openshift-plugin/package.json; then
        PACKAGE_NODE=$(grep -A 2 '"engines"' openshift-plugin/package.json | grep '"node"' | grep -oE '[0-9]+' | head -1)
        if [ -n "$PACKAGE_NODE" ]; then
            echo "Node version in package.json engines: $PACKAGE_NODE.x"
            if [ "$NODE_VERSION" != "$PACKAGE_NODE" ]; then
                echo "❌ FAIL: Node version mismatch in package.json engines"
                ERRORS=$((ERRORS + 1))
            else
                echo "✅ PASS: Node version matches in package.json"
            fi
        fi
    else
        echo "⚠️  WARNING: No engines field in package.json"
    fi

    # Check Dockerfile.react-ui
    if [ -f "openshift-plugin/Dockerfile.react-ui" ]; then
        DOCKER_NODE=$(grep 'FROM node:' openshift-plugin/Dockerfile.react-ui | grep -oE 'node:[0-9]+' | cut -d':' -f2)
        if [ -n "$DOCKER_NODE" ]; then
            echo "Node version in Dockerfile.react-ui: $DOCKER_NODE"
            if [ "$NODE_VERSION" != "$DOCKER_NODE" ]; then
                echo "❌ FAIL: Node version mismatch in Dockerfile.react-ui (expected $NODE_VERSION, got $DOCKER_NODE)"
                ERRORS=$((ERRORS + 1))
            else
                echo "✅ PASS: Node version matches in Dockerfile.react-ui"
            fi
        fi
    fi

    # Check CI workflow
    if [ -f ".github/workflows/run_tests.yml" ]; then
        CI_NODE=$(grep 'node-version:' .github/workflows/run_tests.yml | grep -oE '[0-9]+' | head -1)
        if [ -n "$CI_NODE" ]; then
            echo "Node version in CI: $CI_NODE"
            if [ "$NODE_VERSION" != "$CI_NODE" ]; then
                echo "❌ FAIL: Node version mismatch in CI (expected $NODE_VERSION, got $CI_NODE)"
                ERRORS=$((ERRORS + 1))
            else
                echo "✅ PASS: Node version matches in CI"
            fi
        fi
    fi

    # Check for yarn.lock
    if [ -f "openshift-plugin/yarn.lock" ]; then
        echo "✅ PASS: yarn.lock exists (dependencies locked)"
    else
        echo "❌ FAIL: yarn.lock missing (dependencies not locked)"
        ERRORS=$((ERRORS + 1))
    fi
    echo ""
fi

# Summary
echo "=================================="
if [ $ERRORS -eq 0 ]; then
    echo "✅ All version locks verified successfully!"
    exit 0
else
    echo "❌ Found $ERRORS issue(s) with version locks"
    exit 1
fi
