"""ONTAP REST counter-table performance collection."""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple
from urllib.parse import quote

from ontap_api_connector import OntapConnector


COUNTER_TABLES_ENDPOINT = "/api/cluster/counter/tables"
DEFAULT_MAX_RECORDS = 1000
MAX_SAMPLE_VALUES = 50000

PERF_HANDLER_SOURCES = {
    "volume": "VolumePerfHandler",
}

# The REST catalog is authoritative. These aliases only identify the legacy
# objects we want to carry forward; absent objects are skipped per table.
LEGACY_OBJECT_TABLE_ALIASES = {
    "volume": ("volume",),
    "disk": ("disk",),
    "lun": ("lun",),
    "aggregate": ("aggregate", "aggr"),
    "vfiler": ("vfiler", "vserver"),
    "qtree": ("qtree",),
    "quota": ("quota",),
    "system": ("system:node", "system"),
    "icmp": ("icmp",),
    "ifnet": ("ifnet",),
    "ip": ("ip",),
    "fcp": ("fcp",),
    "nfsv3": ("nfsv3",),
    "iscsi": ("iscsi",),
    "udp": ("udp",),
    "tcp": ("tcp",),
    "perf": ("perf",),
    # ONTAP exposes the node-level processor rows through this alias.
    "processor": ("processor_node", "processor"),
    "wafl": ("wafl",),
}


def _numeric(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _schema_map(table: Mapping[str, Any]) -> Dict[str, Mapping[str, Any]]:
    schemas = table.get("counter_schemas", [])
    if not isinstance(schemas, list):
        return {}
    return {
        str(schema.get("name")): schema
        for schema in schemas
        if isinstance(schema, Mapping) and schema.get("name")
    }


def _counter_scalar_values(row: Mapping[str, Any]) -> Dict[str, Any]:
    values: Dict[str, Any] = {}
    counters = row.get("counters", [])
    if not isinstance(counters, list):
        return values
    for counter in counters:
        if not isinstance(counter, Mapping) or not counter.get("name"):
            continue
        name = str(counter["name"])
        if "value" in counter:
            values[name] = counter["value"]
        elif "values" in counter:
            values[name] = counter["values"]
        elif "counters" in counter:
            values[name] = counter["counters"]
    return values


def _property_values(row: Mapping[str, Any]) -> Dict[str, Any]:
    """Flatten REST properties while preserving the raw properties array."""
    values: Dict[str, Any] = {}
    properties = row.get("properties", [])
    if not isinstance(properties, list):
        return values
    for prop in properties:
        if not isinstance(prop, Mapping) or not prop.get("name") or "value" not in prop:
            continue
        # Splunk field names are easier to use when REST dotted names become
        # ordinary underscore-separated fields (node.name -> node_name).
        name = str(prop["name"]).replace(".", "_")
        values[name] = prop["value"]
    return values


def _add_volume_legacy_fields(event: Dict[str, Any]) -> None:
    """Add the volume fields used by searches from the legacy performance TA."""
    aliases = {
        "instance_name": "name",
        "instance_uuid": "uuid",
        "vserver_name": "svm_name",
        "avg_latency_average": "average_latency_average",
    }
    for legacy_name, rest_name in aliases.items():
        value = event.get(rest_name)
        if value is not None and value != "":
            event.setdefault(legacy_name, value)


def _derived_value(
    counter_type: str,
    current: Any,
    previous: Optional[Mapping[str, Any]],
    denominator_current: Any = None,
    denominator_previous: Optional[Mapping[str, Any]] = None,
) -> Tuple[Optional[str], Any]:
    """Return (suffix, derived value), or (None, None) when not calculable."""
    suffix_by_type = {
        "rate": "rate",
        "delta": "delta",
        "average": "average",
        "percent": "percent",
    }
    suffix = suffix_by_type.get(counter_type.lower())
    if suffix is None or previous is None:
        return None, None

    current_number = _numeric(current)
    previous_number = _numeric(previous.get("value"))
    if current_number is None or previous_number is None:
        return None, None
    difference = current_number - previous_number
    if difference < 0:
        # A counter reset/failover must not create a false negative rate or
        # percentage. The next sample becomes the new baseline.
        return None, None

    if counter_type.lower() == "rate":
        elapsed = _numeric(previous.get("elapsed"))
        if elapsed is None or elapsed <= 0:
            return None, None
        return suffix, difference / elapsed
    if counter_type.lower() == "delta":
        return suffix, difference

    denominator_number = _numeric(denominator_current)
    denominator_previous_number = _numeric(
        denominator_previous.get("value") if denominator_previous else None
    )
    if denominator_number is None or denominator_previous_number is None:
        return None, None
    denominator_difference = denominator_number - denominator_previous_number
    if denominator_difference <= 0:
        return None, None
    if counter_type.lower() == "percent":
        return suffix, 100 * difference / denominator_difference
    return suffix, difference / denominator_difference


class OntapPerfRestCollector:
    """Collect supported ONTAP counter tables and calculate safe derivatives."""

    def __init__(
        self,
        base_url: str,
        username: str,
        password: str,
        verify_ssl: bool,
        timeout: int,
        logger: Optional[logging.Logger] = None,
        account: str = "",
        max_records: int = DEFAULT_MAX_RECORDS,
    ):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.verify_ssl = verify_ssl
        self.timeout = timeout
        self.logger = logger or logging.getLogger(__name__)
        self.account = account
        self.max_records = max(1, int(max_records))
        self.connector = OntapConnector(
            base_url,
            self.logger,
            "perf",
            verify_ssl=verify_ssl,
            timeout=timeout,
        )

    def _build_url(self, endpoint_or_href: str) -> str:
        return self.connector._build_url(endpoint_or_href)

    def _request_json(
        self, url: str, params: Optional[Mapping[str, Any]] = None
    ) -> Mapping[str, Any]:
        return self.connector.request_json(
            self.username,
            self.password,
            url,
            params=dict(params) if params else None,
        )

    def _iter_records(
        self, endpoint: str, params: Optional[Mapping[str, Any]] = None
    ) -> Iterable[Mapping[str, Any]]:
        url = endpoint
        request_params = dict(params) if params else None
        visited = set()
        while url:
            absolute_url = self._build_url(url)
            if absolute_url in visited:
                raise ValueError(f"Repeated ONTAP pagination URL: {absolute_url}")
            visited.add(absolute_url)
            payload = self._request_json(absolute_url, request_params)
            records = payload.get("records")
            if not isinstance(records, list):
                raise ValueError(f"ONTAP response has no records array: {absolute_url}")
            for record in records:
                if isinstance(record, Mapping):
                    yield record
            next_href = payload.get("_links", {}).get("next", {}).get("href")
            url = next_href or ""
            request_params = None

    def discover_tables(self) -> Dict[str, Mapping[str, Any]]:
        tables = {}
        params = {
            "fields": "name,description",
            "return_records": "true",
            "max_records": self.max_records,
        }
        for table in self._iter_records(COUNTER_TABLES_ENDPOINT, params):
            if table.get("name"):
                tables[str(table["name"])] = table
        return tables

    def _table_details(
        self, table_name: str, table_summary: Mapping[str, Any]
    ) -> Mapping[str, Any]:
        """Read schemas from the table resource when the catalog omits them."""
        if "counter_schemas" in table_summary:
            return table_summary
        endpoint = f"{COUNTER_TABLES_ENDPOINT}/{quote(table_name, safe='')}"
        detail = self._request_json(
            endpoint,
            {"fields": "name,description,counter_schemas"},
        )
        records = detail.get("records")
        if isinstance(records, list) and records:
            detail = records[0]
        if not isinstance(detail, Mapping):
            raise ValueError(f"ONTAP table details are not an object: {table_name}")
        merged = dict(table_summary)
        merged.update(detail)
        return merged

    @staticmethod
    def _select_tables(
        tables: Mapping[str, Mapping[str, Any]],
    ) -> List[Tuple[str, str, Mapping[str, Any]]]:
        selected = []
        used_table_names = set()
        for object_name, aliases in LEGACY_OBJECT_TABLE_ALIASES.items():
            for alias in aliases:
                if alias in tables and alias not in used_table_names:
                    selected.append((object_name, alias, tables[alias]))
                    used_table_names.add(alias)
                    break
        return selected

    def _collect_table_rows(
        self,
        object_name: str,
        table_name: str,
        table: Mapping[str, Any],
        prior_samples: Mapping[str, Mapping[str, Any]],
        collected_at: float,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
        row_endpoint = f"{COUNTER_TABLES_ENDPOINT}/{quote(table_name, safe='')}/rows"
        params = {
            "fields": "*",
            "return_records": "true",
            "max_records": self.max_records,
        }
        schemas = _schema_map(table)
        events = []
        next_samples: Dict[str, Dict[str, Any]] = {}
        for row in self._iter_records(row_endpoint, params):
            row_id = str(row.get("id", ""))
            current_values = _counter_scalar_values(row)
            event = dict(row)
            event.update(_property_values(row))
            event.update(current_values)
            event.update(
                {
                    "object": object_name,
                    "table": table_name,
                    "instance_id": row_id,
                    "source_account": self.account,
                    "collected_at": collected_at,
                }
            )
            for counter_name, current_value in current_values.items():
                sample_key = f"{table_name}|{row_id}|{counter_name}"
                previous = prior_samples.get(sample_key)
                previous_with_elapsed = None
                if previous:
                    previous_with_elapsed = dict(previous)
                    previous_with_elapsed["elapsed"] = collected_at - float(
                        previous.get("timestamp", collected_at)
                    )
                schema = schemas.get(counter_name, {})
                denominator_name = (
                    schema.get("denominator", {}).get("name")
                    if isinstance(schema.get("denominator"), Mapping)
                    else None
                )
                denominator_previous = (
                    prior_samples.get(f"{table_name}|{row_id}|{denominator_name}")
                    if denominator_name
                    else None
                )
                suffix, derived = _derived_value(
                    str(schema.get("type", "")),
                    current_value,
                    previous_with_elapsed,
                    current_values.get(denominator_name),
                    denominator_previous,
                )
                if suffix is not None:
                    event[f"{counter_name}_{suffix}"] = derived
                if _numeric(current_value) is not None:
                    next_samples[sample_key] = {
                        "timestamp": collected_at,
                        "value": current_value,
                    }
            if object_name == "volume":
                _add_volume_legacy_fields(event)
            events.append(event)
        return events, next_samples

    def collect(
        self, prior_samples: Optional[Mapping[str, Mapping[str, Any]]] = None
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]], List[str]]:
        prior = prior_samples or {}
        collected_at = time.time()
        tables = self.discover_tables()
        selected = self._select_tables(tables)
        selected_names = {table_name for _, table_name, _ in selected}
        skipped = [
            object_name
            for object_name, aliases in LEGACY_OBJECT_TABLE_ALIASES.items()
            if not any(alias in selected_names for alias in aliases)
        ]
        for object_name in skipped:
            self.logger.info(
                "Skipping unavailable ONTAP performance object %s", object_name
            )

        events: List[Dict[str, Any]] = []
        next_samples: Dict[str, Dict[str, Any]] = {}
        for object_name, table_name, table in selected:
            try:
                table = self._table_details(table_name, table)
                table_events, table_samples = self._collect_table_rows(
                    object_name,
                    table_name,
                    table,
                    prior,
                    collected_at,
                )
                events.extend(table_events)
                next_samples.update(table_samples)
            except Exception as error:  # isolate one unavailable table
                self.logger.warning(
                    "Skipping ONTAP performance table %s: %s", table_name, error
                )
                skipped.append(object_name)

        if len(next_samples) > MAX_SAMPLE_VALUES:
            next_samples = dict(list(next_samples.items())[-MAX_SAMPLE_VALUES:])
        return events, next_samples, sorted(set(skipped))
