from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.refresh_token import RefreshToken
from app.models.user import User, UserRole
from app.schemas.auth import LoginRequest, RegisterRequest
from app.utils.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    refresh_token_expiry,
    verify_password,
)


async def register_user(request: RegisterRequest, db: AsyncSession) -> tuple[User, str, str]:
    existing = await db.execute(
        select(User).where((User.username == request.username) | (User.email == request.email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username or email already exists")

    count_result = await db.execute(
        select(func.count()).select_from(User).where(User.deleted_at == None)
    )
    user_count = count_result.scalar()
    role = UserRole.admin if user_count == 0 else UserRole.member

    password_hash = hash_password(request.password)

    user = User(
        username=request.username,
        email=request.email,
        password_hash=password_hash,
        role=role,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        duplicate = await db.scalar(
            select(User.id).where(
                (User.username == request.username) | (User.email == request.email)
            )
        )
        if duplicate is not None or role != UserRole.admin:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username or email already exists",
            )

        # Another registration won the race to become the first admin. Retry
        # this otherwise-valid registration as a member.
        user = User(
            username=request.username,
            email=request.email,
            password_hash=password_hash,
            role=UserRole.member,
        )
        db.add(user)
        try:
            await db.flush()
        except IntegrityError as exc:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username or email already exists",
            ) from exc

    access_token, raw_refresh = await _issue_tokens(user, db)
    await db.commit()
    await db.refresh(user)
    return user, access_token, raw_refresh


async def login_user(request: LoginRequest, db: AsyncSession) -> tuple[User, str, str]:
    result = await db.execute(select(User).where(User.username == request.username, User.is_active == True))
    user = result.scalar_one_or_none()
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    access_token, raw_refresh = await _issue_tokens(user, db)
    await db.commit()
    return user, access_token, raw_refresh


async def refresh_tokens(raw_refresh_token: str, db: AsyncSession) -> tuple[User, str, str]:
    token_hash = hash_refresh_token(raw_refresh_token)
    now = datetime.now(timezone.utc)

    # Consume the old token with one conditional UPDATE. PostgreSQL locks and
    # updates the matching row atomically, so only one of two concurrent
    # refreshes can receive a replacement token.
    result = await db.execute(
        update(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked_at == None,
            RefreshToken.expires_at > now,
        ).values(revoked_at=now).returning(RefreshToken.user_id)
    )
    user_id = result.scalar_one_or_none()
    if user_id is None:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    user_result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))
    user = user_result.scalar_one_or_none()
    if not user:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    access_token, new_raw_refresh = await _issue_tokens(user, db)
    await db.commit()
    return user, access_token, new_raw_refresh


async def claim_admin(user: User, db: AsyncSession) -> User:
    admin_count_result = await db.execute(
        select(func.count()).select_from(User).where(
            User.role == UserRole.admin, User.deleted_at == None, User.is_active == True
        )
    )
    if admin_count_result.scalar() > 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An admin already exists")
    user.role = UserRole.admin
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An admin already exists",
        ) from exc
    await db.refresh(user)
    return user


async def logout_user(raw_refresh_token: str, db: AsyncSession) -> None:
    token_hash = hash_refresh_token(raw_refresh_token)
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    token_row = result.scalar_one_or_none()
    if token_row:
        token_row.revoked_at = datetime.now(timezone.utc)
        await db.commit()


async def _issue_tokens(user: User, db: AsyncSession) -> tuple[str, str]:
    await _cleanup_stale_refresh_tokens(db)
    access_token = create_access_token({
        "sub": str(user.id),
        "username": user.username,
        "role": user.role.value,
    })
    raw_refresh = generate_refresh_token()
    refresh_row = RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(raw_refresh),
        expires_at=refresh_token_expiry(),
        created_at=datetime.now(timezone.utc),
    )
    db.add(refresh_row)
    return access_token, raw_refresh


async def _cleanup_stale_refresh_tokens(db: AsyncSession, batch_size: int = 100) -> None:
    """Remove a small batch of unusable credentials during normal auth traffic."""
    now = datetime.now(timezone.utc)
    stale_ids = (
        select(RefreshToken.id)
        .where(
            or_(
                RefreshToken.expires_at <= now,
                RefreshToken.revoked_at.is_not(None),
            )
        )
        .order_by(RefreshToken.expires_at)
        .limit(batch_size)
    )
    await db.execute(delete(RefreshToken).where(RefreshToken.id.in_(stale_ids)))
