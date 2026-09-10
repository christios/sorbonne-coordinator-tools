"""Which checks are on, and how the two scopes settle against each other."""

from __future__ import annotations

from sorbonne.services.checks import BY_NAME, CHECKS, settled


def test_a_department_that_has_never_opened_the_panel_gets_the_defaults():
    # And the defaults are chosen from the real data, not from taste: thirty minutes is
    # what keeps a quarter-hour sport tail from becoming a warning about a person.
    found = settled([])

    assert set(found) == {check.name for check in CHECKS}
    assert found["collision"].enabled is True
    assert found["collision"].threshold == 30


def test_the_departments_answer_applies_to_every_cohort():
    found = settled([{"name": "collision", "cohort_id": "", "enabled": False, "threshold": 45}], cohort_id="c1")

    assert found["collision"].enabled is False
    assert found["collision"].threshold == 45


def test_a_cohorts_own_answer_wins_over_the_departments():
    rows = [
        {"name": "collision", "cohort_id": "", "enabled": True, "threshold": 30},
        {"name": "collision", "cohort_id": "c1", "enabled": False, "threshold": 0},
    ]

    assert settled(rows, cohort_id="c1")["collision"].enabled is False
    # And leaves every other cohort on the department's answer.
    assert settled(rows, cohort_id="c2")["collision"].enabled is True


def test_another_cohorts_row_is_not_this_cohorts_business():
    rows = [{"name": "collision", "cohort_id": "c9", "enabled": False, "threshold": 0}]

    assert settled(rows, cohort_id="c1")["collision"].enabled is True


def test_a_name_the_code_does_not_know_is_ignored_rather_than_obeyed():
    # A check removed from the code leaves its rows behind. They must not resurrect it,
    # and they must not crash the panel that lists what exists today.
    found = settled([{"name": "a_check_that_was_deleted", "cohort_id": "", "enabled": False, "threshold": 0}])

    assert "a_check_that_was_deleted" not in found


def test_every_check_says_what_its_threshold_counts_or_has_none():
    # A number with no unit beside it is a box nobody can fill in correctly.
    for check in CHECKS:
        assert bool(check.measures) == bool(check.threshold), check.name
    assert set(BY_NAME) == {check.name for check in CHECKS}
