"""The department's programmes — Settings → Programmes: official names, course codes, courses.

Anybody signed in may read it: the pages that narrow their courses to a programme need it.
Only an administrator may change it, since it changes what those pages show everybody.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from sorbonne.config import config
from sorbonne.services.course_programs import CoursePrograms, InvalidCourseProgram
from sorbonne.services.engine import engine_for

router = APIRouter(prefix="/course-programs", tags=["course-programs"])


def get_programs() -> CoursePrograms:
    return CoursePrograms(engine_for(config.database_url))


def _administrator(request: Request) -> str:
    staff = getattr(request.state, "staff_user", None)
    if not getattr(staff, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an administrator can change the department's programmes.",
        )
    return str(getattr(staff, "email", "") or "")


class Prefixes(BaseModel):
    #: The starts of the course codes that count as the programme: ["MATH", "CPSC"].
    prefixes: list[str] = Field(default_factory=list, max_length=20)


class OfficialName(BaseModel):
    #: "Bachelor of Science in Mathematics"; "" for none.
    officialName: str = Field(default="", max_length=200)


class CourseProgramme(BaseModel):
    #: A programme's code, or "NONE".
    programme: str = Field(min_length=1, max_length=40)


@router.get("")
def read(programs: CoursePrograms = Depends(get_programs)) -> dict[str, Any]:
    return programs.state()


@router.put("/programmes/{programme}")
def set_prefixes(
    programme: str, body: Prefixes, request: Request, programs: CoursePrograms = Depends(get_programs)
) -> dict[str, Any]:
    actor = _administrator(request)
    try:
        return programs.set_prefixes(programme, body.prefixes, actor=actor)
    except InvalidCourseProgram as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


@router.put("/programmes/{programme}/name")
def set_official_name(
    programme: str, body: OfficialName, request: Request, programs: CoursePrograms = Depends(get_programs)
) -> dict[str, Any]:
    actor = _administrator(request)
    try:
        return programs.set_official_name(programme, body.officialName, actor=actor)
    except InvalidCourseProgram as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


@router.put("/courses/{course_code}")
def put_course(
    course_code: str, body: CourseProgramme, request: Request, programs: CoursePrograms = Depends(get_programs)
) -> dict[str, Any]:
    actor = _administrator(request)
    try:
        return programs.put_course(course_code, body.programme, actor=actor)
    except InvalidCourseProgram as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


@router.delete("/courses/{course_code}")
def clear_course(
    course_code: str, request: Request, programs: CoursePrograms = Depends(get_programs)
) -> dict[str, Any]:
    _administrator(request)
    return programs.clear_course(course_code)
