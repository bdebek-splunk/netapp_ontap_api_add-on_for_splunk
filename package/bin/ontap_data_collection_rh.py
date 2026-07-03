import import_declare_test  # noqa: F401

from splunktaucclib.rest_handler.admin_external import AdminExternalHandler
from splunktaucclib.rest_handler.error import RestError
from solnlib import log
import splunk.rest as rest  # type: ignore[import-not-found]
import urllib.parse
import logging
import json
import os
from typing import Any

ADDON_NAME = "Splunk_TA_NetApp_ontap"

logger = logging.getLogger(f"{ADDON_NAME.lower()}_data_collection_rh")

# globalConfig.json is at <app_root>/appserver/static/js/build/globalConfig.json
# __file__ is in <app_root>/bin/
_APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_GLOBAL_CONFIG_PATH = os.path.join(
    _APP_ROOT, "appserver", "static", "js", "build", "globalConfig.json"
)


def _build_maps():
    """
    Dynamically build INPUT_FIELD_MAP and DEFAULT_STANZA from globalConfig.json
    by reading all input service names.

    INPUT_FIELD_MAP: { "collect_<name>": "<input_type>" }
    DEFAULT_STANZA:  base fields + { "collect_<name>": "1" } for every service
    """
    field_map = {}
    default_stanza = {
        "account": "",
        "index": "default",
        "interval": "300",
        "request_timeout": "30",
    }
    try:
        with open(_GLOBAL_CONFIG_PATH, "r") as f:
            config = json.load(f)
        services = config.get("pages", {}).get("inputs", {}).get("services", [])
        for service in services:
            name = service.get("name", "").strip()
            if not name:
                continue
            field_key = f"collect_{name}"
            field_map[field_key] = name
            default_stanza[field_key] = "1"
    except Exception as e:
        logger.warning(
            f"Could not build maps from globalConfig.json: {e}. Falling back to empty map."
        )
    return field_map, default_stanza


# Built once at module load — safe because globalConfig.json is static at runtime.
INPUT_FIELD_MAP, DEFAULT_STANZA = _build_maps()


def _eai_path(input_type, name=None, action=None):
    """Build the EAI REST path (no host) for use with splunk.rest.simpleRequest."""
    base = f"/servicesNS/nobody/{ADDON_NAME}/data/inputs/{input_type}"
    if name:
        base = f"{base}/{urllib.parse.quote(name, safe='')}"
    if action:
        base = f"{base}/{action}"
    return base


def _input_name_for(account: str, kind: str) -> str:
    """Unique input stanza name: <account>_<kind>, e.g. mycluster_qtrees."""
    return f"{account}_{kind}"


def _short_input_name(name):
    return name.split("://", 1)[1] if "://" in name else name


def _list_inputs(session_key, endpoint):
    """Return dict of {short_name: entry} for all inputs of the given endpoint."""
    path = _eai_path(endpoint)
    server_response, server_content = rest.simpleRequest(
        path,
        sessionKey=session_key,
        getargs={"output_mode": "json", "count": "0"},
        raiseAllErrors=False,
    )
    status = int(server_response.get("status", 200))
    logger.debug(f"LIST {path} -> {status}: {str(server_content)[:300]}")
    if status == 404:
        return {}
    if status >= 400:
        raise Exception(
            f"LIST {path} returned HTTP {status}: {str(server_content)[:200]}"
        )
    result = {}
    for entry in json.loads(server_content).get("entry", []):
        result[_short_input_name(entry["name"])] = entry
    return result


def _create_input(session_key, endpoint, name, account, index, interval):
    path = _eai_path(endpoint)
    postargs = {
        "name": name,
        "account": account,
        "index": index,
        "interval": str(interval),
    }
    server_response, server_content = rest.simpleRequest(
        path,
        sessionKey=session_key,
        getargs={"output_mode": "json"},
        postargs=postargs,
        raiseAllErrors=False,
    )
    status = int(server_response.get("status", 200))
    logger.debug(f"CREATE {path} name={name} -> {status}: {str(server_content)[:300]}")
    if status >= 400:
        raise Exception(
            f"CREATE {path}/{name} returned HTTP {status}: {str(server_content)[:200]}"
        )


def _update_input(session_key, endpoint, name, account, index, interval):
    path = _eai_path(endpoint, name)
    postargs = {
        "account": account,
        "index": index,
        "interval": str(interval),
    }
    server_response, server_content = rest.simpleRequest(
        path,
        sessionKey=session_key,
        getargs={"output_mode": "json"},
        postargs=postargs,
        raiseAllErrors=False,
    )
    status = int(server_response.get("status", 200))
    logger.debug(f"UPDATE {path} -> {status}: {str(server_content)[:300]}")
    if status >= 400:
        raise Exception(
            f"UPDATE {path} returned HTTP {status}: {str(server_content)[:200]}"
        )


def _set_input_state(session_key, endpoint, name, enable: bool):
    action = "enable" if enable else "disable"
    path = _eai_path(endpoint, name, action)
    server_response, server_content = rest.simpleRequest(
        path,
        sessionKey=session_key,
        method="POST",
        getargs={"output_mode": "json"},
        raiseAllErrors=False,
    )
    status = int(server_response.get("status", 200))
    logger.debug(f"{action.upper()} {path} -> {status}: {str(server_content)[:300]}")
    if status >= 400:
        raise Exception(
            f"{action.upper()} {path} returned HTTP {status}: {str(server_content)[:200]}"
        )


def _sync_inputs_for_account(
    session_key, account, index, interval, stanza_info, _logger
):
    if not INPUT_FIELD_MAP:
        raise Exception(
            "No ONTAP input definitions were loaded from globalConfig.json."
        )
    failures = []
    for field, input_type in INPUT_FIELD_MAP.items():
        enabled = str(stanza_info.get(field, "1")).strip() in ("1", "true", "True")
        input_name = _input_name_for(account, input_type)
        _logger.debug(f"Syncing {input_type}: enabled={enabled}, name={input_name}")

        try:
            existing = _list_inputs(session_key, input_type)
            _logger.debug(f"Existing inputs for {input_type}: {list(existing.keys())}")
        except Exception as e:
            msg = f"Could not list inputs of kind '{input_type}': {e}"
            _logger.error(msg)
            failures.append(msg)
            continue

        if enabled:
            if input_name not in existing:
                try:
                    _create_input(
                        session_key, input_type, input_name, account, index, interval
                    )
                    _logger.info(f"Created and enabled {input_type}://{input_name}.")
                except Exception as e:
                    msg = f"Could not create {input_type}://{input_name}: {e}"
                    _logger.error(msg)
                    failures.append(msg)
            else:
                try:
                    _update_input(
                        session_key, input_type, input_name, account, index, interval
                    )
                    content = existing[input_name].get("content", {})
                    disabled = str(content.get("disabled", "0")) in (
                        "1",
                        "true",
                        "True",
                    )
                    if disabled:
                        _set_input_state(session_key, input_type, input_name, True)
                    _logger.info(
                        f"Updated and enabled existing {input_type}://{input_name}."
                    )
                except Exception as e:
                    msg = f"Could not update or enable {input_type}://{input_name}: {e}"
                    _logger.error(msg)
                    failures.append(msg)
        else:
            if input_name in existing:
                try:
                    _set_input_state(session_key, input_type, input_name, False)
                    _logger.info(f"Disabled {input_type}://{input_name}.")
                except Exception as e:
                    msg = f"Could not disable {input_type}://{input_name}: {e}"
                    _logger.error(msg)
                    failures.append(msg)
    if failures:
        raise Exception("; ".join(failures))


def _coerce_int(value, default, min_value, max_value, field_name):
    raw_value = str(value if value not in (None, "") else default).strip()
    try:
        int_value = int(raw_value)
    except ValueError:
        raise RestError(400, f"{field_name} must be an integer.")
    if int_value < min_value or int_value > max_value:
        raise RestError(
            400, f"{field_name} must be between {min_value} and {max_value}."
        )
    return str(int_value)


def _normalize_data_collection_payload(payload):
    stanza_info = dict(DEFAULT_STANZA)
    if payload:
        for key, value in payload.items():
            if key in stanza_info or key.startswith("collect_"):
                stanza_info[key] = value

    account = (stanza_info.get("account") or "").strip()
    index = (stanza_info.get("index") or "default").strip()
    interval = _coerce_int(stanza_info.get("interval"), "300", 10, 3600, "Interval")
    request_timeout = _coerce_int(
        stanza_info.get("request_timeout"),
        "30",
        1,
        300,
        "Request timeout",
    )
    if not account:
        raise RestError(
            400, "Account must be selected before saving Data Collection settings."
        )

    stanza_info["account"] = account
    stanza_info["index"] = index
    stanza_info["interval"] = interval
    stanza_info["request_timeout"] = request_timeout
    return account, index, interval, stanza_info


class DataCollectionHandler(AdminExternalHandler):
    def __init__(self, *args, **kwargs):
        AdminExternalHandler.__init__(self, *args, **kwargs)

    def _get_logger(self):
        try:
            return log.Logs().get_logger(f"{ADDON_NAME.lower()}_data_collection_rh")
        except Exception:
            return logger

    def handleList(self, confInfo) -> Any:
        _logger = self._get_logger()
        try:
            AdminExternalHandler.handleList(self, confInfo)
        except Exception as e:
            _logger.warning(f"Parent handleList failed (stanza may not exist yet): {e}")
            confInfo["data_collection"].update(DEFAULT_STANZA)

        try:
            session_key = self.getSessionKey()
            for stanza_name, stanza_info in confInfo.items():
                account = (stanza_info.get("account") or "").strip()
                if not account:
                    continue
                for field, input_type in INPUT_FIELD_MAP.items():
                    input_name = _input_name_for(account, input_type)
                    try:
                        existing = _list_inputs(session_key, input_type)
                        if input_name in existing:
                            content = existing[input_name].get("content", {})
                            disabled = str(content.get("disabled", "1"))
                            stanza_info[field] = (
                                "0" if disabled in ("1", "true", "True") else "1"
                            )
                    except Exception as e:
                        _logger.warning(
                            f"Could not read state for {input_type}://{input_name}: {e}"
                        )
        except Exception as e:
            _logger.error(f"Error overlaying input states in handleList: {e}")

    def handleEdit(self, confInfo) -> Any:
        _logger = self._get_logger()
        _logger.info("handleEdit called for DataCollectionHandler")
        try:
            payload = self.payload or {}
            account, index, interval, stanza_info = _normalize_data_collection_payload(
                payload
            )
            payload.update(stanza_info)
            self.payload = payload
        except RestError:
            raise

        try:
            AdminExternalHandler.handleEdit(self, confInfo)
        except Exception as e:
            _logger.error(f"Parent handleEdit failed: {e}")
            raise
        session_key = self.getSessionKey()
        try:
            _logger.info(
                f"handleEdit: account={account}, index={index}, interval={interval}, stanza={dict(stanza_info)}"
            )
            _sync_inputs_for_account(
                session_key, account, index, interval, stanza_info, _logger
            )
        except RestError:
            raise
        except Exception as e:
            _logger.error(f"Error syncing inputs: {e}")
            raise RestError(400, f"Settings saved but failed to sync inputs: {str(e)}")
