import json
import logging

import import_declare_test  # noqa: F401
from solnlib import conf_manager, log
from splunklib import modularinput as smi

from ontap_api_connector import OntapConnector


ADDON_NAME = "Splunk_TA_NetApp_ontap"
DEFAULT_REQUEST_TIMEOUT = 30
TRUE_VALUES = ("1", "true", "True", "yes", "Yes", "on", "On", True, 1)


def logger_for_input(input_name: str) -> logging.Logger:
    return log.Logs().get_logger(f"{ADDON_NAME.lower()}_{input_name}")


def get_account_conf(session_key: str):
    cfm = conf_manager.ConfManager(
        session_key,
        ADDON_NAME,
        realm=f"__REST_CREDENTIAL__#{ADDON_NAME}#configs/conf-splunk_ta_netapp_ontap_account",
    )
    return cfm.get_conf("splunk_ta_netapp_ontap_account")


def get_account_credentials(session_key: str, account_name: str):
    account_conf_file = get_account_conf(session_key)
    account = account_conf_file.get(account_name)
    username = account.get("username")
    password = account.get("password")
    if not username or not password:
        raise ValueError(f"Account '{account_name}' is missing username or password.")
    return username, password


def get_base_url(session_key: str, account_name: str):
    account_conf_file = get_account_conf(session_key)
    host = account_conf_file.get(account_name).get("host")
    if not host:
        raise ValueError(f"Account '{account_name}' is missing ONTAP host.")
    return host


def get_verify_ssl(session_key: str, account_name: str):
    account_conf_file = get_account_conf(session_key)
    account = account_conf_file.get(account_name)
    return account.get("verify_tls", "false") in TRUE_VALUES


def get_request_timeout(session_key: str, logger: logging.Logger):
    try:
        cfm = conf_manager.ConfManager(session_key, ADDON_NAME)
        settings_conf_file = cfm.get_conf("splunk_ta_netapp_ontap_settings")
        data_collection = settings_conf_file.get("data_collection")
        timeout = int(data_collection.get("request_timeout", DEFAULT_REQUEST_TIMEOUT))
        if timeout < 1:
            raise ValueError("request_timeout must be at least 1")
        return timeout
    except Exception as e:
        logger.warning(
            f"Could not read request_timeout setting, using {DEFAULT_REQUEST_TIMEOUT}: {e}"
        )
        return DEFAULT_REQUEST_TIMEOUT


def get_sourcetype(input_name: str):
    return f"apiontap:{input_name.lower()}"


def get_index(input_item: dict):
    return input_item["index"]


def validate_input(definition):
    return


def stream_events(inputs: smi.InputDefinition, event_writer: smi.EventWriter):
    # inputs.inputs is a Python dictionary object like:
    # {
    #   "qtree-list-iter://<input_name>": {
    #     "account": "<account_name>",
    #     "disabled": "0",
    #     "host": "$decideOnStartup",
    #     "index": "<index_name>",
    #     "interval": "<interval_value>",
    #     "python.version": "python3",
    #   },
    # }
    for input_name, input_item in inputs.inputs.items():
        normalized_input_name = input_name.split("://")[0]
        sourcetype = get_sourcetype(normalized_input_name)
        logger = logger_for_input(normalized_input_name)
        try:
            session_key = inputs.metadata["session_key"]
            log_level = conf_manager.get_log_level(
                logger=logger,
                session_key=session_key,
                app_name=ADDON_NAME,
                conf_name="splunk_ta_netapp_ontap_settings",
            )
            logger.setLevel(log_level)
            log.modular_input_start(logger, input_name)
            account_name = input_item.get("account")
            if not account_name:
                raise ValueError(f"Input '{input_name}' is missing an account.")
            index_name = get_index(input_item)
            base_url = get_base_url(session_key, account_name)
            username, password = get_account_credentials(session_key, account_name)
            verify_ssl = get_verify_ssl(session_key, account_name)
            request_timeout = get_request_timeout(session_key, logger)
            # Initialize OntapConnector object
            oc = OntapConnector(
                base_url,
                logger,
                normalized_input_name,
                verify_ssl=verify_ssl,
                timeout=request_timeout,
            )
            data = oc.get_data_from_api(username, password)
            if data is not None:
                for line in data:
                    event_writer.write_event(
                        smi.Event(
                            data=json.dumps(line, ensure_ascii=False, default=str),
                            index=index_name,
                            sourcetype=sourcetype,
                        )
                    )
                log.events_ingested(
                    logger,
                    input_name,
                    sourcetype,
                    len(data),
                    index_name,
                    account=input_item.get("account"),
                )
                log.modular_input_end(logger, input_name)
            else:
                logger.info("No data to ingest")
        except Exception as e:
            log.log_exception(
                logger,
                e,
                "TA NETAPP ONTAP ERROR",
                msg_before=f"Exception raised while ingesting data for {input_name} input: ",
            )
