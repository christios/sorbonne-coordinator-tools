"""What the Teams roster sync reports, and the gap it lets a cohort see."""

import pytest

from sorbonne.api import team_rosters as api
from sorbonne.services.student_database import StudentDatabase
from sorbonne.services.team_rosters import TeamRosterStore, address_of, missing_from_channel
from tests.conftest import TEST_DATABASE_URL


@pytest.fixture
def rosters() -> TeamRosterStore:
    return TeamRosterStore(TEST_DATABASE_URL)


@pytest.fixture
def database() -> StudentDatabase:
    return StudentDatabase(TEST_DATABASE_URL)


def test_a_student_id_becomes_the_address_the_roster_spells(rosters: TeamRosterStore) -> None:
    assert address_of("A00026871") == "a00026871@sorbonne.ae"
    assert address_of("  a00026871 ") == "a00026871@sorbonne.ae"


def test_the_latest_reading_is_the_one_answered(rosters: TeamRosterStore) -> None:
    rosters.record(channels={"L1 Students": ["a1@sorbonne.ae"]}, mode="dry run")
    rosters.record(channels={"L1 Students": ["a1@sorbonne.ae", "a2@sorbonne.ae"]}, mode="live")
    latest = rosters.latest()
    assert latest is not None
    assert latest["mode"] == "live"
    assert latest["channels"]["L1 Students"] == ["a1@sorbonne.ae", "a2@sorbonne.ae"]


def test_addresses_are_lowercased_and_deduplicated(rosters: TeamRosterStore) -> None:
    rosters.record(channels={" L1  Students ": ["A1@Sorbonne.ae", "a1@sorbonne.ae", "a2@sorbonne.ae"]})
    latest = rosters.latest()
    assert latest is not None
    assert latest["channels"] == {"L1 Students": ["a1@sorbonne.ae", "a2@sorbonne.ae"]}


def test_a_cohort_with_no_channel_is_not_compared() -> None:
    gap = missing_from_channel(channel="", student_ids=["A1"], reading={"channels": {}})
    assert gap["known"] is False
    assert gap["reason"] == "no_channel"
    assert gap["missing"] == []


def test_never_having_synced_is_not_the_same_as_nobody_missing() -> None:
    gap = missing_from_channel(channel="L1 Students", student_ids=["A1"], reading=None)
    assert gap["known"] is False
    assert gap["reason"] == "never_synced"


def test_a_channel_the_sync_did_not_see_is_not_an_empty_channel() -> None:
    reading = {"channels": {"L2 Students": []}, "syncedAt": "now"}
    gap = missing_from_channel(channel="L1 Students", student_ids=["A1"], reading=reading)
    assert gap["known"] is False
    assert gap["reason"] == "channel_not_in_sync"


def test_who_is_missing_ignores_spacing_and_case_in_the_channel_name() -> None:
    reading = {"channels": {"L1 Students": ["a00000001@sorbonne.ae"]}, "syncedAt": "now"}
    gap = missing_from_channel(
        channel="l1students", student_ids=["A00000001", "A00000002"], reading=reading
    )
    assert gap["known"] is True
    assert [m["studentId"] for m in gap["missing"]] == ["A00000002"]
    assert gap["missing"][0]["address"] == "a00000002@sorbonne.ae"
    assert gap["listed"] == 1


def test_a_cohort_remembers_its_channel(database: StudentDatabase) -> None:
    cohort = database.create_cohort(name="Licence 1", term="S1 2026-27")
    assert cohort["teamsChannel"] == ""
    updated = database.update_cohort(
        cohort["id"],
        name=cohort["name"],
        term=cohort["term"],
        notes="",
        teams_channel="L1 Students",
    )
    assert updated["teamsChannel"] == "L1 Students"
    assert database.get_cohort(cohort["id"])["teamsChannel"] == "L1 Students"


def test_the_endpoint_takes_a_list_of_channels_and_stores_a_map(
    rosters: TeamRosterStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The flow sends pairs; what is kept is one list of addresses per channel."""
    body = api.SyncInput(
        syncedBy="christian.khairallah@sorbonne.ae",
        mode="live",
        channels=[
            api.ChannelInput(channel="L1 Students", members=["A1@sorbonne.ae"]),
            api.ChannelInput(channel="", members=["ignored@sorbonne.ae"]),
        ],
        problems=[],
    )

    class Request:
        class state:
            staff_user = None

    monkeypatch.setattr(api, "get_rosters", lambda: rosters)
    answer = api.record_sync(body, Request(), rosters)
    kept = answer["sync"]["channels"]
    assert kept == {"L1 Students": ["a1@sorbonne.ae"]}
    assert answer["sync"]["syncedBy"] == "christian.khairallah@sorbonne.ae"
