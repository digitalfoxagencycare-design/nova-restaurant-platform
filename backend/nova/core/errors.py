from __future__ import annotations

from fastapi import HTTPException


class ApiError(HTTPException):
    """HTTP error with a stable machine-readable code (clients localise by code)."""

    def __init__(self, status: int, code: str, message: str, **extra):
        super().__init__(status_code=status, detail={"code": code, "message": message, **extra})


def unauthorized(msg="Not authenticated"):
    return ApiError(401, "UNAUTHORIZED", msg)


def forbidden(msg="Not allowed"):
    return ApiError(403, "FORBIDDEN", msg)


def not_found(msg="Not found"):
    return ApiError(404, "NOT_FOUND", msg)


def bad_request(code: str, msg: str):
    return ApiError(400, code, msg)
