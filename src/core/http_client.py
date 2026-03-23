"""
Centralized HTTP client service for observability APIs.

This module provides a unified HTTP client interface for making requests
to various observability services (Tempo, Prometheus, Thanos, etc.).
"""

import httpx
import requests
from typing import Dict, Any, Optional, List
import logging

from .config import VERIFY_SSL, K8S_SERVICE_ACCOUNT_TOKEN_PATH, DEV_FALLBACK_TOKEN

logger = logging.getLogger(__name__)


class HTTPClient:
    """Centralized HTTP client for observability services."""
    
    DEFAULT_TIMEOUT = 30.0
    DEFAULT_VERIFY_SSL = VERIFY_SSL
    
    def __init__(self, base_url: str, timeout: float = DEFAULT_TIMEOUT, verify_ssl: bool = DEFAULT_VERIFY_SSL):
        """
        Initialize HTTP client.
        
        Args:
            base_url: Base URL for the service
            timeout: Request timeout in seconds
            verify_ssl: Whether to verify SSL certificates
        """
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self.verify_ssl = verify_ssl
    
    def _get_service_account_token(self) -> str:
        """Get the service account token for authentication."""
        try:
            with open(K8S_SERVICE_ACCOUNT_TOKEN_PATH, 'r') as f:
                return f.read().strip()
        except FileNotFoundError:
            # Fallback for local development
            import os
            token = os.getenv("TEMPO_TOKEN") or os.getenv("THANOS_TOKEN")
            if token:
                return token
            return DEV_FALLBACK_TOKEN
    
    def _get_auth_headers(self, use_auth: bool = True) -> Dict[str, str]:
        """
        Get authentication headers.
        
        Args:
            use_auth: Whether to include authentication headers
            
        Returns:
            Dict containing authentication headers
        """
        headers = {}
        
        if use_auth:
            try:
                token = self._get_service_account_token()
                if token and token != DEV_FALLBACK_TOKEN:
                    headers["Authorization"] = f"Bearer {token}"
            except Exception as e:
                logger.debug(f"No service account token available: {e}")
        
        return headers
    
    async def get_async(self, endpoint: str, params: Optional[Dict] = None, 
                      headers: Optional[Dict] = None, use_auth: bool = True) -> Dict[str, Any]:
        """
        Make async GET request.
        
        Args:
            endpoint: API endpoint (without base URL)
            params: Query parameters
            headers: Additional headers
            use_auth: Whether to include authentication
            
        Returns:
            Response data as dictionary
        """
        url = f"{self.base_url}{endpoint}"
        request_headers = self._get_auth_headers(use_auth)
        
        if headers:
            request_headers.update(headers)
        
        try:
            async with httpx.AsyncClient(timeout=self.timeout, verify=self.verify_ssl) as client:
                logger.debug(f"Making async GET request to: {url}")
                response = await client.get(url, params=params, headers=request_headers)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPError as e:
            logger.error(f"Async GET request failed: {e}")
            raise
    
    def get_sync(self, endpoint: str, params: Optional[Dict] = None,
                headers: Optional[Dict] = None, use_auth: bool = True) -> Dict[str, Any]:
        """
        Make synchronous GET request.
        
        Args:
            endpoint: API endpoint (without base URL)
            params: Query parameters
            headers: Additional headers
            use_auth: Whether to include authentication
            
        Returns:
            Response data as dictionary
        """
        url = f"{self.base_url}{endpoint}"
        request_headers = self._get_auth_headers(use_auth)
        
        if headers:
            request_headers.update(headers)
        
        try:
            response = requests.get(
                url, 
                params=params, 
                headers=request_headers,
                verify=self.verify_ssl,
                timeout=self.timeout
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Sync GET request failed: {e}")
            raise
    
    async def post_async(self, endpoint: str, data: Optional[Dict] = None,
                        headers: Optional[Dict] = None, use_auth: bool = True) -> Dict[str, Any]:
        """
        Make async POST request.
        
        Args:
            endpoint: API endpoint (without base URL)
            data: Request body data
            headers: Additional headers
            use_auth: Whether to include authentication
            
        Returns:
            Response data as dictionary
        """
        url = f"{self.base_url}{endpoint}"
        request_headers = self._get_auth_headers(use_auth)
        
        if headers:
            request_headers.update(headers)
        
        try:
            async with httpx.AsyncClient(timeout=self.timeout, verify=self.verify_ssl) as client:
                logger.debug(f"Making async POST request to: {url}")
                response = await client.post(url, json=data, headers=request_headers)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPError as e:
            logger.error(f"Async POST request failed: {e}")
            raise


class TempoClient(HTTPClient):
    """Specialized HTTP client for Tempo/Jaeger APIs."""
    
    def __init__(self, tempo_url: str, tenant_id: str, timeout: float = 30.0):
        """
        Initialize Tempo client.
        
        Args:
            tempo_url: Base URL for Tempo service
            tenant_id: Tenant ID for multi-tenant setups
            timeout: Request timeout in seconds
        """
        super().__init__(tempo_url, timeout)
        self.tenant_id = tenant_id
    
    def _get_tempo_headers(self) -> Dict[str, str]:
        """Get headers specific to Tempo API requests."""
        headers = {
            "X-Scope-OrgID": self.tenant_id,
            "Content-Type": "application/json"
        }
        
        # Add authentication if available
        auth_headers = self._get_auth_headers()
        headers.update(auth_headers)
        
        return headers
    
    async def get_services(self) -> List[str]:
        """Get list of available services from Tempo/Jaeger."""
        try:
            endpoint = f"/api/traces/v1/{self.tenant_id}/api/services"
            response = await self.get_async(endpoint, headers=self._get_tempo_headers())
            return response.get("data", [])
        except Exception as e:
            logger.error(f"Error getting services: {e}")
            return []
    
    async def query_traces(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Query traces from Tempo/Jaeger.
        
        Args:
            params: Query parameters including start, end, service, limit
            
        Returns:
            Query response data
        """
        try:
            endpoint = f"/api/traces/v1/{self.tenant_id}/api/traces"
            response = await self.get_async(endpoint, params=params, headers=self._get_tempo_headers())
            return response
        except Exception as e:
            logger.error(f"Error querying traces: {e}")
            raise
    
    async def get_trace_details(self, trace_id: str) -> Dict[str, Any]:
        """
        Get detailed trace information.
        
        Args:
            trace_id: ID of the trace to fetch
            
        Returns:
            Trace details data
        """
        try:
            endpoint = f"/api/traces/v1/{self.tenant_id}/api/traces/{trace_id}"
            response = await self.get_async(endpoint, headers=self._get_tempo_headers())
            return response
        except Exception as e:
            logger.error(f"Error getting trace details: {e}")
            raise


class PrometheusClient(HTTPClient):
    """Specialized HTTP client for Prometheus/Thanos APIs."""
    
    def __init__(self, prometheus_url: str, token: Optional[str] = None, timeout: float = 30.0):
        """
        Initialize Prometheus client.
        
        Args:
            prometheus_url: Base URL for Prometheus/Thanos service
            token: Optional authentication token
            timeout: Request timeout in seconds
        """
        super().__init__(prometheus_url, timeout)
        self.token = token
    
    def _get_prometheus_headers(self) -> Dict[str, str]:
        """Get headers specific to Prometheus API requests."""
        headers = {}
        
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        
        return headers
