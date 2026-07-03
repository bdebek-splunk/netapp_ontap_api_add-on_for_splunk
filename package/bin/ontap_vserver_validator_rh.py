import urllib.parse
import requests
import logging

import import_declare_test  # noqa: F401
from splunktaucclib.rest_handler.admin_external import AdminExternalHandler
from solnlib.conf_manager import ConfManager
from typing import Any

from ontap_api_connector import API_MAPPER


logger = logging.getLogger(__name__)

ADDON_NAME = "Splunk_TA_NetApp_ontap"
SPLUNK_BASE = "https://localhost:8089"
DEFAULT_REQUEST_TIMEOUT = 30
TRUE_VALUES = ("1", "true", "True", "yes", "Yes", "on", "On", True, 1)

# All modular input kinds provided by this add-on — derived from API_MAPPER so
# adding a new input kind to ontap_api_connector.py is the only change needed.
INPUT_KINDS = list(API_MAPPER.keys())

# ── Helpers ───────────────────────────────────────────────────────────────────


def _eai_url(kind, name=None):
    """Build the EAI endpoint URL for a given input kind."""
    base = f"{SPLUNK_BASE}/servicesNS/nobody/{ADDON_NAME}/data/inputs/{kind}"
    return f"{base}/{urllib.parse.quote(name, safe='')}" if name else base


def _auth_headers(session_key):
    return {"Authorization": f"Splunk {session_key}"}


def _short_input_name(name):
    return name.split("://", 1)[1] if "://" in name else name


def _get_conf_manager(session_key, app_name):
    return ConfManager(
        session_key,
        app_name,
        realm=f"__REST_CREDENTIAL__#{ADDON_NAME}#configs/conf-{app_name.lower()}_account",
    )


def _get_vserver_status(
    host, username, password, verify_tls=False, timeout=DEFAULT_REQUEST_TIMEOUT
):
    """Attempt to connect to the ONTAP vserver and return a status string."""
    try:
        response = requests.get(
            f"{host}/api/storage/volumes/",
            auth=(username, password),
            verify=verify_tls,
            timeout=timeout,
            params={"max_records": 1},
        )
    except requests.exceptions.Timeout as e:
        return f"Connection timeout: {e}"
    except requests.exceptions.RequestException as e:
        return f"Connection error: {e}"

    if response.status_code != 200:
        return (
            f"Failed to connect to the vserver. "
            f"Status: {response.status_code}, message: {response.text}"
        )
    return "Connected"


def _connect_and_return_status(confInfo, account_conf):
    for account_name, account_info in confInfo.items():
        host = account_info.get("host", "")
        username = account_info.get("username", "")
        verify_host = account_info.get("verify_host", "false")
        verify_tls = account_info.get("verify_tls", "false") in TRUE_VALUES

        if verify_host in TRUE_VALUES:
            try:
                password = account_conf.get(account_name).get("password")
            except Exception as e:
                account_info["server_status"] = f"Error decrypting password: {e}"
                continue
            try:
                status = _get_vserver_status(host, username, password, verify_tls)
            except Exception as e:
                status = f"Connection failed: {e}"
        else:
            status = "Not checked"

        account_info["server_status"] = status
        account_conf.update(account_name, {"server_status": status})


def _delete_inputs_for_account(session_key: str, account_name: str):
    """
    Delete all EAI inputs that belong to *account_name* via the Splunk REST API.
    """
    for kind in INPUT_KINDS:
        try:
            resp = requests.get(
                _eai_url(kind),
                headers=_auth_headers(session_key),
                params={"output_mode": "json", "count": 0},
                verify=False,
                timeout=10,
            )
            if resp.status_code == 404:
                continue
            resp.raise_for_status()
            for entry in resp.json().get("entry", []):
                if entry.get("content", {}).get("account") == account_name:
                    name = _short_input_name(entry["name"])
                    del_resp = requests.delete(
                        _eai_url(kind, name),
                        headers=_auth_headers(session_key),
                        params={"output_mode": "json"},
                        verify=False,
                        timeout=10,
                    )
                    del_resp.raise_for_status()
                    logger.info(
                        f"Deleted input {kind}://{name} for removed account '{account_name}'."
                    )
        except Exception as e:
            logger.warning(
                f"Could not clean up inputs of kind '{kind}' for account '{account_name}': {e}"
            )


# ── REST handlers ──────────────────────────────────────────────────────────────


class CustomAccountValidator(AdminExternalHandler):
    def __init__(self, *args, **kwargs):
        AdminExternalHandler.__init__(self, *args, **kwargs)

    def _validate_and_update_status(self, confInfo):
        session_key = self.getSessionKey()
        conf_mgr = _get_conf_manager(session_key, self.appName)
        account_conf = conf_mgr.get_conf(f"{self.appName.lower()}_account")
        _connect_and_return_status(confInfo, account_conf)

    def handleList(self, confInfo) -> Any:
        AdminExternalHandler.handleList(self, confInfo)

    def handleCreate(self, confInfo) -> Any:
        AdminExternalHandler.handleCreate(self, confInfo)
        self._validate_and_update_status(confInfo)

    def handleEdit(self, confInfo) -> Any:
        AdminExternalHandler.handleEdit(self, confInfo)
        self._validate_and_update_status(confInfo)

    def handleRemove(self, confInfo) -> Any:
        session_key = self.getSessionKey()
        for account_name in confInfo.keys():
            _delete_inputs_for_account(session_key, account_name)
        AdminExternalHandler.handleRemove(self, confInfo)
