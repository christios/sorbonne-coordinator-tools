from sorbonne.services import rich_text


def test_plain_text_written_before_any_of_this_is_left_alone() -> None:
    written = "Week 1 - 2-hour session\nChapter 1: The Laws of Geometric Optics"

    assert not rich_text.is_rich_text(written)
    assert rich_text.to_plain(written) == written


def test_a_list_keeps_the_markers_that_carry_its_meaning() -> None:
    written = "<p>Topics</p><ol><li>The nature of light</li><li>The speed of light</li></ol>"

    assert rich_text.to_plain(written) == "Topics\n1. The nature of light\n2. The speed of light"


def test_a_bulleted_list_reads_as_one() -> None:
    written = "<ul><li>Ray tracing</li><li>Thin lenses</li></ul>"

    assert rich_text.to_plain(written) == "• Ray tracing\n• Thin lenses"


def test_emphasis_survives_as_something_the_document_can_set() -> None:
    blocks = rich_text.blocks("<p>Read <strong>chapter 1</strong> and <em>skim</em> chapter 2</p>")

    assert len(blocks) == 1
    assert [(piece.text, piece.bold, piece.italic) for piece in blocks[0].pieces] == [
        ("Read ", False, False),
        ("chapter 1", True, False),
        (" and ", False, False),
        ("skim", False, True),
        (" chapter 2", False, False),
    ]


def test_a_heading_is_kept_apart_from_the_paragraphs_around_it() -> None:
    blocks = rich_text.blocks("<h3>Part I</h3><p>The nature of light</p>")

    assert [(block.kind, block.text) for block in blocks] == [
        ("heading", "Part I"),
        ("paragraph", "The nature of light"),
    ]


def test_a_list_nested_in_another_is_marked_and_stepped_in() -> None:
    written = "<ul><li>Optics</li><ul><li>Reflection</li><li>Refraction</li></ul></ul>"

    blocks = rich_text.blocks(written)

    assert [(block.level, block.text) for block in blocks] == [
        (0, "• Optics"),
        (1, "    ◦ Reflection"),
        (1, "    ◦ Refraction"),
    ]


def test_a_numbered_list_is_written_the_way_it_was_set() -> None:
    letters = rich_text.blocks('<ol type="a"><li>First</li><li>Second</li></ol>')
    romans = rich_text.blocks('<ol type="i"><li>First</li><li>Fourth</li><li>Third</li><li>Fourth</li></ol>')

    assert [block.marker for block in letters] == ["a.", "b."]
    assert [block.marker for block in romans] == ["i.", "ii.", "iii.", "iv."]


def test_the_second_heading_level_is_kept_apart_from_the_first() -> None:
    blocks = rich_text.blocks("<h3>Part I</h3><h4>Section 1</h4>")

    assert [block.kind for block in blocks] == ["heading", "subheading"]
