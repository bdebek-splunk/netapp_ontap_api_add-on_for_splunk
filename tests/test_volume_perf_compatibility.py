import importlib
import logging
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


sys.path.insert(0, str(Path(__file__).parents[1] / "package" / "bin"))

from ontap_perf_collection import (  # noqa: E402
    PERF_HANDLER_SOURCES,
    OntapPerfRestCollector,
)


def http_response(payload):
    response = Mock()
    response.raise_for_status = Mock()
    response.json.return_value = payload
    return response


def make_collector():
    return OntapPerfRestCollector(
        "https://ontap.example",
        "api-user",
        "api-password",
        verify_ssl=True,
        timeout=15,
        account="production",
    )


class VolumePerfCompatibilityTests(unittest.TestCase):
    def test_volume_events_include_legacy_handler_fields(self):
        responses = [
            http_response(
                {
                    "records": [
                        {
                            "name": "volume",
                            "counter_schemas": [
                                {
                                    "name": "average_latency",
                                    "type": "average",
                                    "denominator": {"name": "operations"},
                                }
                            ],
                        }
                    ]
                }
            ),
            http_response(
                {
                    "records": [
                        {
                            "id": "vol-1",
                            "name": "data",
                            "uuid": "uuid-1",
                            "properties": [{"name": "svm.name", "value": "svm-a"}],
                            "counters": [
                                {"name": "average_latency", "value": 120},
                                {"name": "operations", "value": 20},
                            ],
                        }
                    ]
                }
            ),
        ]
        prior = {
            "volume|vol-1|average_latency": {"timestamp": 100, "value": 60},
            "volume|vol-1|operations": {"timestamp": 100, "value": 10},
        }

        with (
            patch("ontap_api_connector.requests.get", side_effect=responses),
            patch("ontap_perf_collection.time.time", return_value=160),
        ):
            events, _, skipped = make_collector().collect(prior)

        self.assertNotIn("volume", skipped)
        event = events[0]
        self.assertEqual(event["instance_name"], "data")
        self.assertEqual(event["instance_uuid"], "uuid-1")
        self.assertEqual(event["vserver_name"], "svm-a")
        self.assertEqual(event["average_latency_average"], 6.0)
        self.assertEqual(event["avg_latency_average"], 6.0)
        self.assertEqual(PERF_HANDLER_SOURCES["volume"], "VolumePerfHandler")

    def test_volume_aliases_are_not_created_without_source_values(self):
        responses = [
            http_response(
                {
                    "records": [
                        {
                            "name": "volume",
                            "counter_schemas": [
                                {
                                    "name": "average_latency",
                                    "type": "average",
                                    "denominator": {"name": "operations"},
                                }
                            ],
                        }
                    ]
                }
            ),
            http_response(
                {
                    "records": [
                        {
                            "id": "vol-1",
                            "counters": [{"name": "average_latency", "value": 120}],
                        }
                    ]
                }
            ),
        ]

        with (
            patch("ontap_api_connector.requests.get", side_effect=responses),
            patch("ontap_perf_collection.time.time", return_value=160),
        ):
            events, _, _ = make_collector().collect()

        for field in (
            "instance_name",
            "instance_uuid",
            "vserver_name",
            "avg_latency_average",
        ):
            self.assertNotIn(field, events[0])

    def test_perf_stream_sets_volume_handler_source_and_ontap_host(self):
        conf_manager = types.ModuleType("solnlib.conf_manager")
        conf_manager.get_log_level = Mock(return_value=logging.INFO)
        log_module = types.ModuleType("solnlib.log")
        for function_name in (
            "modular_input_start",
            "modular_input_end",
            "events_ingested",
            "log_exception",
        ):
            setattr(log_module, function_name, Mock())
        solnlib = types.ModuleType("solnlib")
        solnlib.conf_manager = conf_manager
        solnlib.log = log_module

        modularinput = types.ModuleType("splunklib.modularinput")
        modularinput.InputDefinition = object
        modularinput.EventWriter = object
        modularinput.ValidationDefinition = object
        modularinput.Event = object
        splunklib = types.ModuleType("splunklib")
        splunklib.modularinput = modularinput

        with patch.dict(
            sys.modules,
            {
                "import_declare_test": types.ModuleType("import_declare_test"),
                "solnlib": solnlib,
                "solnlib.conf_manager": conf_manager,
                "solnlib.log": log_module,
                "splunklib": splunklib,
                "splunklib.modularinput": modularinput,
            },
        ):
            helper = importlib.import_module("ontap_helper")

        inputs = types.SimpleNamespace(
            metadata={"session_key": "session"},
            inputs={
                "perf://production_collection": {
                    "account": "production",
                    "index": "ontap",
                }
            },
        )
        event_writer = Mock()
        collected_event = {"object": "volume", "average_latency_average": 6.0}
        event_factory = Mock(return_value="event")

        with (
            patch.object(
                helper, "logger_for_input", return_value=logging.getLogger("test")
            ),
            patch.object(helper, "get_base_url", return_value="https://ontap.example"),
            patch.object(
                helper, "get_account_credentials", return_value=("user", "password")
            ),
            patch.object(helper, "get_verify_ssl", return_value=True),
            patch.object(helper, "get_request_timeout", return_value=15),
            patch.object(
                helper, "_perf_state_path", return_value="/tmp/perf-state.json"
            ),
            patch.object(helper, "_load_perf_samples", return_value={}),
            patch.object(helper, "_save_perf_samples"),
            patch.object(helper, "OntapPerfRestCollector") as collector_class,
            patch.object(helper.smi, "Event", event_factory),
        ):
            collector_class.return_value.collect.return_value = (
                [collected_event],
                {},
                [],
            )
            helper.stream_events(inputs, event_writer)

        self.assertEqual(event_factory.call_args.kwargs["source"], "VolumePerfHandler")
        self.assertEqual(
            event_factory.call_args.kwargs["host"], "https://ontap.example"
        )
        self.assertEqual(event_factory.call_args.kwargs["sourcetype"], "apiontap:perf")


if __name__ == "__main__":
    unittest.main()
