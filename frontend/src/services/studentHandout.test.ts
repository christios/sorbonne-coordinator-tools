import { describe, expect, it } from "vitest";

import {
  buildHandoutBuffer,
  classCell,
  courseHeading,
  explain,
  groupHeading,
  handoutName,
  inReadingOrder,
  labelValue,
  singular,
  whatYouBelongTo,
} from "@/services/studentHandout";
import { EMPTY_REQUEST, EMPTY_SECTION, type CatalogueScope } from "@/services/studentDatabase";

const scope = (over: Partial<CatalogueScope>): CatalogueScope => ({
  id: "s-cm", code: "CM", name: "Lectures", note: "", termId: "t1", kind: "shared", parentScopeId: "",
  openToAll: false, cohortId: "c1", tab: "", groupColumn: "", columnIndex: 0,
  courses: [{ id: "c1", code: "MATH001", name: "Pre-calculus 1", component: "CM", request: EMPTY_REQUEST }],
  groups: [{ id: "g1", label: "1", capacity: 0, note: "", parentGroupId: "", assigned: 0, crns: { c1: { ...EMPTY_SECTION, crn: "22151", teacher: "Bilal Maaz" } } }],
  ...over,
});

describe("the file the students get", () => {
  it("is named the way the ones already sent are named", () => {
    expect(handoutName("FYS", "2026-27", "FYS-S1")).toBe("FYS-2026-27-S1_Your-Groups_STUDENTS.xlsx");
    // Licence 2's sheets are S3, and its handout says so too.
    expect(handoutName("BSc-L2", "2026-27", "BSc-L2-S3")).toBe("BSc-L2-2026-27-S3_Your-Groups_STUDENTS.xlsx");
    expect(handoutName("", "", "")).toBe("Groups_Your-Groups_STUDENTS.xlsx");
  });

  it("heads a column with the set's own name, singular, and never its code", () => {
    // CM and TD are the department's shorthand and mean nothing to a seventeen-year-old.
    expect(groupHeading(scope({}))).toBe("YOUR\nLECTURE\nGROUP");
    expect(groupHeading(scope({ name: "Tutorials" }))).toBe("YOUR\nTUTORIAL\nGROUP");
    // A word that already ends in a double s keeps it.
    expect(singular({ code: "RDNS", name: "Maths Readiness" })).toBe("Maths Readiness");
    // Nothing named falls back to the code, since a blank heading helps nobody.
    expect(groupHeading({ code: "TP", name: "" })).toBe("YOUR\nTP\nGROUP");
  });

  it("writes the class out rather than leaving a number to look up", () => {
    expect(classCell("23561", "Samar Ghantous")).toBe("CRN 23561\nSamar Ghantous");
    expect(classCell("23561", "")).toBe("CRN 23561");
    // A group that takes no class of this course says so, rather than sitting empty.
    expect(classCell("", "Samar Ghantous")).toBe("—");
    expect(courseHeading({ code: "MATH001", name: "Pre-calculus 1" })).toBe("Pre-calculus 1\nMATH001");
    expect(courseHeading({ code: "MATH001", name: "" })).toBe("MATH001");
  });

  it("counts the groups it actually has when it says what they are", () => {
    const said = whatYouBelongTo([scope({}), scope({ id: "s-td", code: "TD", name: "Tutorials" })]);
    // Two sets, so two — the file must not tell a cohort it belongs to three.
    expect(said).toContain("two groups");
    expect(said).toContain("a LECTURES group (blue)");
    expect(said).toContain("a TUTORIALS group (green)");
    expect(whatYouBelongTo([scope({})])).toContain("one group");
    expect(whatYouBelongTo([])).toBe("Find your row below.");
  });

  it("explains a set in the coordinator's words where they have written any", () => {
    expect(explain(scope({ note: "Everyone attends these." }))).toBe("Everyone attends these.");
    expect(explain(scope({}))).toContain("You are in one lecture group.");
    expect(explain(scope({}))).toContain("It decides your class for Pre-calculus 1.");
    expect(explain(scope({ courses: [] }))).toContain("It carries no courses yet.");
  });

  it("is alphabetical by family name, which is what it tells students to expect", () => {
    const order = inReadingOrder([
      { studentId: "A3", family: "Younes", first: "Grace", programme: "", groups: {} },
      { studentId: "A1", family: "ABDELREHIEM", first: "Youssef", programme: "", groups: {} },
      { studentId: "A2", family: "Abdalla", first: "Ali", programme: "", groups: {} },
    ]);

    // Case is not a sorting fact: the registrar writes some names in capitals.
    expect(order.map((student) => student.family)).toEqual(["Abdalla", "ABDELREHIEM", "Younes"]);
  });

  it("keeps a numbered group a number, so 10 comes after 9", () => {
    expect(labelValue("10")).toBe(10);
    expect(labelValue("B")).toBe("B");
    expect(labelValue("3A")).toBe("3A");
    expect(labelValue("")).toBe("");
  });
});


describe("a group whose majors are taught different things", () => {
  it("gives each student their own major's lecture, not the other's", async () => {
    // L1's CM as one group: MATH-113 for the mathematicians, PHYS-118 for the physicists.
    const cm = scope({
      courses: [
        { id: "c-m113", code: "MATH-113", name: "Philosophy of AI", component: "CM", request: EMPTY_REQUEST },
        { id: "c-p118", code: "PHYS-118", name: "Optics", component: "CM", request: EMPTY_REQUEST },
      ],
      groups: [
        {
          id: "cm-1", label: "1", capacity: 120, note: "", parentGroupId: "", assigned: 2,
          crns: { "c-m113": { ...EMPTY_SECTION, crn: "23307" }, "c-p118": { ...EMPTY_SECTION, crn: "22150" } },
          majors: [
            { id: "m-math", program: "MATH - Mathematics", seats: 100, assigned: 1 },
            { id: "m-phys", program: "PHYS - Physics", seats: 20, assigned: 1 },
          ],
          byMajor: {
            "m-math": { "c-p118": { ...EMPTY_SECTION, notTaught: true } },
            "m-phys": { "c-m113": { ...EMPTY_SECTION, notTaught: true } },
          },
        },
      ],
    });
    const buffer = await buildHandoutBuffer({
      cohortName: "L1-S1", semester: "Semester 1", year: "2026-27", scopes: [cm],
      students: [{ studentId: "A2", family: "Physicist", first: "", programme: "PHYS", groups: { "s-cm": "1" }, majors: { "s-cm": "m-phys" } }],
    });
    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);
    const row = book.worksheets[0].getRow(8);
    const cells: string[] = [];
    row.eachCell((cell) => cells.push(String(cell.value ?? "")));

    expect(cells.join(" ")).toContain("22150");
    expect(cells.join(" ")).not.toContain("23307");
  });
});
