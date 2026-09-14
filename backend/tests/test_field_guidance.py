from sorbonne.services.field_guidance import may_write


def test_each_app_answers_about_itself() -> None:
    assert may_write("syllabus-field", {"syllabus": "admin"}, platform_admin=False) is True
    assert may_write("syllabus-field", {"syllabus": "member"}, platform_admin=False) is False
    assert may_write("teacher", {"syllabus": "admin"}, platform_admin=False) is False
    assert may_write("teacher-requisition", {"teachers": "admin"}, platform_admin=False) is True


def test_a_form_no_app_claims_is_the_platform_administrators_alone() -> None:
    """So a form added later cannot quietly become writable by whoever it was added for."""
    assert may_write("something-new", {"syllabus": "admin"}, platform_admin=False) is False
    assert may_write("something-new", {}, platform_admin=True) is True


def test_whoever_hands_out_the_accounts_is_never_locked_out() -> None:
    assert may_write("teacher", {}, platform_admin=True) is True
