import copy

import pytest

from nova.core.config import REPO_ROOT
from nova.tenancy.config_validation import InvalidTenantConfig, validate_tenant_config
from tests.conftest import EXAMPLE

SCHEMA = REPO_ROOT / "config" / "tenant.schema.json"


def bad(mutator):
    c = copy.deepcopy(EXAMPLE)
    mutator(c)
    with pytest.raises(InvalidTenantConfig) as e:
        validate_tenant_config(c, SCHEMA)
    return " ".join(e.value.errors)


def test_source_derived_example_is_valid():
    assert validate_tenant_config(copy.deepcopy(EXAMPLE), SCHEMA)["slug"] == "hyderabadi-irani"


def test_schema_errors():
    assert "tax" in bad(lambda c: c.pop("tax"))
    assert "default_rate" in bad(lambda c: c["tax"].update(default_rate=0.9))
    assert "mode" in bad(lambda c: c["tax"].update(mode="whatever"))
    assert "slug" in bad(lambda c: c.update(slug="Bad Slug!"))


def test_business_rules():
    assert "increasing" in bad(lambda c: c["delivery"].update(fee_slabs=[{"up_to_km": 3, "fee": 10}, {"up_to_km": 2, "fee": 20}]))
    assert "max_km" in bad(lambda c: c["delivery"].update(max_km=2))
    assert "HH:MM" in bad(lambda c: c["payments"]["cod"].update(disabled_windows=[{"from": "25:00", "to": "06:00"}]))
    assert "unknown statuses" in bad(lambda c: c["operations"]["flows"].update({"delivery": ["placed", "teleported"]}))
    assert "unknown order type" in bad(lambda c: c["operations"]["flows"].update({"drone": ["placed"]}))
    assert "start with" in bad(lambda c: c["operations"]["flows"].update({"takeaway": ["ready", "completed"]}))
    assert "earn_per_rupees" in bad(lambda c: c["loyalty"].update(earn_per_rupees=0))


def test_secrets_are_rejected_in_config():
    assert "never secret values" in bad(lambda c: c["integrations"]["razorpay"].update(secret_ref="rzp_live_ABCDEFGH12345678"))  # scan-secrets: allow
    assert "never secret values" in bad(lambda c: c["integrations"]["whatsapp"].update(project="mongodb+srv://u:p@h/db"))
