"""Timestamps keep their UTC offset when read back, and the rule exposes its driver boost.

SQLite returned stored timestamps without an offset; the API sent them without "Z" and
browsers showed them in the wrong time zone (e.g. "10:06" for a save at 12:06 in UTC+2).
"""

from datetime import datetime

from app.drivers import driver_boost


def aware(value: str) -> bool:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).utcoffset() is not None


def test_timestamps_read_back_carry_an_offset(admin):
    r = admin.post(
        "/api/systems", json={"name": "Time zone", "owner_name": "Owner", "criticality": 3}
    )
    assert r.status_code == 201, r.text
    r = admin.post(f"/api/systems/{r.json()['id']}/interviews")
    assert r.status_code == 201, r.text
    iv = admin.get(f"/api/interviews/{r.json()['id']}").json()  # fresh read from the database
    assert aware(iv["updated_at"])

    admin.patch("/api/l3/AO-CRE-01", json={"comments": "touched"})
    assert aware(admin.get("/api/l3/AO-CRE-01").json()["updated_at"])
    assert all(aware(e["at"]) for e in admin.get("/api/audit").json()[:5])


def test_rule_exposes_driver_boost_matching_its_priority(admin):
    admin.patch("/api/l2/AO-CRE", json={"risk_level": 4})
    admin.patch("/api/l3/AO-CRE-01", json={"implementation": 0.3})
    rule = admin.get("/api/l3/AO-CRE-01").json()
    l2 = admin.get("/api/l2/AO-CRE").json()
    links = len(l2["business_drivers"]) + len(l2["compliance_drivers"])
    assert rule["driver_boost"] == driver_boost(links)
    expected = round(
        rule["implementation_gap"] * rule["effective_risk"] / 5 * rule["driver_boost"], 4
    )
    assert rule["priority"] == expected
