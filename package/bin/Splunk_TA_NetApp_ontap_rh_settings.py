import import_declare_test  # noqa: F401

from splunktaucclib.rest_handler.endpoint import (
    field,
    validator,
    RestModel,
    MultipleModel,
)
from splunktaucclib.rest_handler import admin_external, util
from ontap_data_collection_rh import DataCollectionHandler, _build_maps
import logging

util.remove_http_proxy_env_vars()

# Build data_collection fields dynamically from globalConfig.json
_, _default_stanza = _build_maps()

fields_data_collection = [
    field.RestField(
        "account", required=False, encrypted=False, default=None, validator=None
    ),
    field.RestField(
        "index",
        required=False,
        encrypted=False,
        default="default",
        validator=validator.String(
            max_len=80,
            min_len=1,
        ),
    ),
    field.RestField(
        "interval", required=False, encrypted=False, default="300", validator=None
    ),
    field.RestField(
        "request_timeout",
        required=False,
        encrypted=False,
        default="30",
        validator=validator.Number(
            max_val=300,
            min_val=1,
        ),
    ),
]

# Add one checkbox field per input service derived from globalConfig.json
for _field_key in _default_stanza:
    if _field_key.startswith("collect_"):
        fields_data_collection.append(
            field.RestField(
                _field_key,
                required=False,
                encrypted=False,
                default=True,
                validator=None,
            )
        )

model_data_collection = RestModel(fields_data_collection, name="data_collection")


fields_logging = [
    field.RestField(
        "loglevel",
        required=True,
        encrypted=False,
        default="INFO",
        validator=validator.Pattern(
            regex=r"""^DEBUG|INFO|WARNING|ERROR|CRITICAL$""",
        ),
    )
]
model_logging = RestModel(fields_logging, name="logging")


endpoint = MultipleModel(
    "splunk_ta_netapp_ontap_settings",
    models=[model_data_collection, model_logging],
    need_reload=False,
)


if __name__ == "__main__":
    logging.getLogger().addHandler(logging.NullHandler())
    admin_external.handle(
        endpoint,
        handler=DataCollectionHandler,
    )
