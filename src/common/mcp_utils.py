"""
Common MCP Utilities

Shared utility functions for MCP result handling used by both UI and adapters.
This module breaks circular dependencies by providing common utilities.
"""

import json
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


def extract_text_from_mcp_result(result: Any) -> Optional[str]:
    """Helper function to extract text from MCP tool result.

    Args:
        result: MCP tool result (typically a list with dict items)

    Returns:
        Extracted text string, or None if extraction fails
    """
    try:
        if result and isinstance(result, list) and len(result) > 0:
            first_item = result[0]
            if isinstance(first_item, dict) and "text" in first_item:
                base_text = first_item["text"]
                # If the base_text itself is a serialized MCP content list, unwrap it
                try:
                    if isinstance(base_text, str):
                        parsed = json.loads(base_text)
                        if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict) and "text" in parsed[0]:
                            inner_text = parsed[0]["text"]
                            return inner_text
                except Exception:
                    # Fallback to base_text
                    pass
                return base_text
            else:
                return str(first_item)
        return None
    except Exception as e:
        logger.error(f"Error extracting text from MCP result: {e}")
        return None


def is_double_encoded_mcp_response(parsed_json: Any) -> bool:
    """Check if the parsed JSON is a double-encoded MCP response.

    A double-encoded MCP response is a list containing a dict with a 'text' key
    that contains another JSON string.

    Args:
        parsed_json: The parsed JSON object to check

    Returns:
        True if this appears to be a double-encoded MCP response
    """
    if not isinstance(parsed_json, list):
        return False

    if len(parsed_json) == 0:
        return False

    first_item = parsed_json[0]
    return isinstance(first_item, dict) and "text" in first_item


def extract_from_double_encoded_response(parsed_json: list) -> Optional[dict]:
    """Extract content from a double-encoded MCP response.

    Args:
        parsed_json: The list containing the double-encoded response

    Returns:
        The extracted and parsed inner JSON, or None if extraction fails
    """
    try:
        inner_text = parsed_json[0]["text"]
        logger.debug(f"Found double-encoded response, trying to parse inner text: {inner_text[:100]}...")

        inner_json = json.loads(inner_text)
        if isinstance(inner_json, dict):
            return inner_json
        else:
            logger.error(f"Inner JSON is not a dict: {type(inner_json)}")
            return None

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse inner JSON from double-encoded response: {e}")
        return None
    except Exception as e:
        logger.error(f"Error extracting from double-encoded response: {e}")
        return None
