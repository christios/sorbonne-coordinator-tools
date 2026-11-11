from sorbonne.api.syllabi import list_syllabus_templates
from sorbonne.services.syllabus_templates import DEFAULT_TEMPLATE_ID, FYS_TEMPLATE_ID, get_template


def test_description_and_delivery_are_one_section_in_the_order_each_document_prints_them() -> None:
    """November 2026 review: sections 3 and 4 merge on screen and the rest renumber.

    Stored content keeps its two keys, so history and older syllabi are unaffected.
    """
    scen = {section.id: section for section in get_template(DEFAULT_TEMPLATE_ID).sections}
    fys = {section.id: section for section in get_template(FYS_TEMPLATE_ID).sections}

    assert scen["description"].label == "3. Course description and delivery"
    assert scen["description"].content_parts == ("description", "delivery")
    assert fys["description"].content_parts == ("delivery", "description")
    assert "delivery" not in scen and "delivery" not in fys
    assert [section.label for section in get_template(DEFAULT_TEMPLATE_ID).sections] == [
        "1. Course identification",
        "2. Academic contacts",
        "3. Course description and delivery",
        "4. Learning outcomes",
        "5. Course schedule",
        "6. Bibliography",
        "7. Course assessment",
    ]
    assert [section.label for section in get_template(FYS_TEMPLATE_ID).sections][-1] == "8. Teaching schedule"


def test_the_template_list_tells_the_editor_which_parts_each_section_edits() -> None:
    templates = {template["id"]: template for template in list_syllabus_templates()["items"]}
    sections = {section["id"]: section for section in templates[DEFAULT_TEMPLATE_ID]["sections"]}

    assert sections["description"]["parts"] == ["description", "delivery"]
    assert sections["schedule"]["parts"] == ["schedule"]
