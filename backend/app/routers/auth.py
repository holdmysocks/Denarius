from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.rate_limit import limiter
from app.schemas.auth import LoginRequest, RefreshRequest, RegisterRequest, TokenResponse, UserOut
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

settings = get_settings()

# Browsers keep the refresh token in an HttpOnly cookie so the session survives
# app restarts (iOS home-screen apps wipe sessionStorage when closed) without
# exposing the long-lived credential to page JavaScript. The cookie is scoped to
# the auth endpoints and SameSite=Strict, so other sites cannot make the browser
# send it. Non-browser API clients may still pass the token in the JSON body.
REFRESH_COOKIE_NAME = "denarius_refresh"
REFRESH_COOKIE_PATH = "/api/v1/auth"


def _is_https(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
    return forwarded_proto == "https" or request.url.scheme == "https"


def _set_refresh_cookie(response: Response, request: Request, refresh_token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        refresh_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        # Browsers drop Secure cookies over plain HTTP (e.g. a LAN IP), so only
        # require it when the request actually arrived over HTTPS.
        secure=_is_https(request),
        samesite="strict",
    )


def _refresh_token_from(request: Request, body: RefreshRequest | None) -> str | None:
    if body and body.refresh_token:
        return body.refresh_token
    return request.cookies.get(REFRESH_COOKIE_NAME)


@router.post("/register", response_model=TokenResponse, status_code=201)
@limiter.limit("3/hour")
async def register(
    request: Request,
    response: Response,
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    user, access_token, refresh_token = await auth_service.register_user(body, db)
    _set_refresh_cookie(response, request, refresh_token)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/15minutes")
async def login(
    request: Request,
    response: Response,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    user, access_token, refresh_token = await auth_service.login_user(body, db)
    _set_refresh_cookie(response, request, refresh_token)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("60/minute")
async def refresh(
    request: Request,
    response: Response,
    body: RefreshRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    raw_refresh = _refresh_token_from(request, body)
    if not raw_refresh:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")
    user, access_token, new_refresh = await auth_service.refresh_tokens(raw_refresh, db)
    _set_refresh_cookie(response, request, new_refresh)
    return TokenResponse(access_token=access_token, refresh_token=new_refresh)


@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    response: Response,
    body: RefreshRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    raw_refresh = _refresh_token_from(request, body)
    if raw_refresh:
        await auth_service.logout_user(raw_refresh, db)
    response.delete_cookie(
        REFRESH_COOKIE_NAME,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=_is_https(request),
        samesite="strict",
    )


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/claim-admin", response_model=UserOut)
async def claim_admin(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await auth_service.claim_admin(current_user, db)
