import json
import logging
import requests

from urllib.parse import urlparse
from typing import Any, Dict, List


# Dictionary that maps input names to their corresponding API endpoints, returned datasets, and fields
API_MAPPER = {
    "qtrees": {"endpoint": "/api/storage/qtrees", "dataset": "records", "fields": "*"},
    "aggregates": {
        "endpoint": "/api/storage/aggregates",
        "dataset": "records",
        "fields": "*",
    },
    "volume": {"endpoint": "/api/storage/volumes", "dataset": "records", "fields": "*"},
    "svms": {"endpoint": "/api/svm/svms", "dataset": "records", "fields": "*"},
    "cluster_nodes": {
        "endpoint": "/api/cluster/nodes",
        "dataset": "records",
        "fields": "*",
    },
    "cluster_identity": {"endpoint": "/api/cluster", "dataset": "", "fields": "*"},
}


class OntapConnector:
    def __init__(
        self,
        base_url: str,
        logger: logging.Logger,
        input: str,
        verify_ssl: bool = False,
        timeout: int = 30,
    ):
        self.base_url = base_url.rstrip("/")
        self.logger = logger
        self.input = input
        self.verify_ssl = verify_ssl
        self.timeout = timeout

    def _get_input_config(self) -> Dict[str, str]:
        """Takes an input name and returns the corresponding API endpoint"""
        try:
            return API_MAPPER[self.input]
        except KeyError as e:
            self.logger.error(f"ONTAP API: Invalid input '{self.input}': {e}")
            raise ValueError(f"Invalid input '{self.input}'") from e

    def _get_dataset(self) -> str:
        """Takes an input name and returns the corresponding dataset"""
        try:
            dataset = API_MAPPER[self.input]["dataset"]
            self.logger.debug(
                f"Dataset for {self.input}: {dataset if dataset else '*'}"
            )
        except Exception as e:
            self.logger.error(
                f"ONTAP API: Error while getting dataset for {self.input}: {e}"
            )
            raise ValueError(f"Error while getting dataset for {self.input}")
        return dataset

    def _parse_response(self, response_json: Any, dataset: str) -> List[Dict[str, Any]]:
        """Parse the API response based on the expected dataset structure."""
        if dataset:
            if not isinstance(response_json, dict):
                raise ValueError(f"Expected object response for dataset '{dataset}'")
            if dataset not in response_json:
                raise ValueError(
                    f"Expected dataset '{dataset}' missing from ONTAP response"
                )
            if not isinstance(response_json[dataset], list):
                raise ValueError(f"Expected dataset '{dataset}' to be a list")
            return response_json[dataset]
        else:
            if isinstance(response_json, dict):
                return [response_json]
            elif isinstance(response_json, list):
                return response_json
            else:
                self.logger.error("ONTAP API: Unexpected response type")
                raise ValueError("Unexpected response type")

    def _build_url(self, endpoint_or_href: str) -> str:
        """Build an absolute ONTAP URL from a mapper endpoint or HAL link."""
        parsed = urlparse(endpoint_or_href)
        if parsed.scheme and parsed.netloc:
            return endpoint_or_href
        if endpoint_or_href.startswith("/"):
            return f"{self.base_url}{endpoint_or_href}"
        return f"{self.base_url}/{endpoint_or_href}"

    def _get_next_href(self, response_json: Any) -> str:
        if not isinstance(response_json, dict):
            return ""
        return response_json.get("_links", {}).get("next", {}).get("href", "")

    def get_data_from_api(self, username: str, password: str) -> List[Dict[str, Any]]:
        """Get data from ONTAP REST API"""
        self.logger.info("Getting data from an external API")
        input_config = self._get_input_config()
        endpoint = input_config["endpoint"]
        url = self._build_url(endpoint)
        params = {
            "fields": input_config.get("fields"),
            "return_records": "true",
        }
        self.logger.info(f"Requesting data from {url}")
        all_records = []
        seen_urls = set()
        try:
            dataset = self._get_dataset()
            while url:
                if url in seen_urls:
                    raise ValueError(f"Detected repeated pagination URL: {url}")
                seen_urls.add(url)

                response = requests.get(
                    url,
                    auth=(username, password),
                    params=params,
                    verify=self.verify_ssl,
                    timeout=self.timeout,
                )
                self.logger.info(f"Response status code: {response.status_code}")
                response.raise_for_status()
                response_json = response.json()
                all_records.extend(self._parse_response(response_json, dataset))

                next_href = self._get_next_href(response_json) if dataset else ""
                url = self._build_url(next_href) if next_href else ""
                params = None
            return all_records
        except (
            requests.exceptions.RequestException,
            ValueError,
            json.JSONDecodeError,
        ) as e:
            self.logger.error(f"ONTAP API: Error while requesting data from {url}: {e}")
            return []
