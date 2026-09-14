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
