import json
import uuid
from typing import Optional
from pydantic import BaseModel, EmailStr, field_validator

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update as sa_update, delete as sa_delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, require_admin, get_db
from app.models.user import User, UserRole
from app.models.transaction import Transaction
from app.models.recurring_item import RecurringItem
from app.schemas.auth import UserOut, UserPreferencesUpdate
from app.utils.security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


def _validate_username(v: str) -> str:
    if not v.replace("_", "").replace("-", "").isalnum():
        raise ValueError("Username must be alphanumeric (underscores and hyphens allowed)")
    if len(v) < 3 or len(v) > 50:
        raise ValueError("Username must be 3-50 characters")
    return v


def _validate_password(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Password must be at least 8 characters")
    return v


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: UserRole = UserRole.member

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        return _validate_username(v)

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        return _validate_password(v)


class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    role: Optional[UserRole] = None

    @field_validator("username")
    @classmethod
    def _username(cls, v: Optional[str]) -> Optional[str]:
        return _validate_username(v) if v is not None else v

    @field_validator("password")
    @classmethod
    def _password(cls, v: Optional[str]) -> Optional[str]:
        return _validate_password(v) if v is not None else v


class RoleUpdate(BaseModel):
    role: UserRole


@router.get("", response_model=list[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    result = await db.execute(
        select(User).where(User.deleted_at.is_(None)).order_by(User.username)
    )
    return result.scalars().all()


@router.post("", response_model=UserOut, status_code=201)
async def create_user(
    data: UserCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    existing = await db.execute(
        select(User).where((User.username == data.username) | (User.email == data.email))
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username or email already exists")
    user = User(
        username=data.username,
        email=data.email,
        password_hash=hash_password(data.password),
        role=data.role,
        is_active=True,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        detail = "An admin already exists" if data.role == UserRole.admin else "Username or email already exists"
        raise HTTPException(status_code=409, detail=detail) from exc
    await db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserOut)
async def get_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.admin and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    is_admin = current_user.role == UserRole.admin
    if not is_admin and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    # Only admins may change is_active or role
    if not is_admin and (data.is_active is not None or data.role is not None):
        raise HTTPException(status_code=403, detail="Admins only may change role or status")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if data.username:
        user.username = data.username
    if data.email:
        user.email = data.email
    if data.password:
        user.password_hash = hash_password(data.password)
    if data.is_active is not None:
        if not data.is_active and user.id == current_user.id:
            raise HTTPException(status_code=400, detail="Cannot deactivate yourself")
        user.is_active = data.is_active
    if data.role is not None:
        user.role = data.role
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Username or email already exists, or an admin already exists",
        ) from exc
    await db.refresh(user)
    return user


@router.put("/{user_id}/role", response_model=UserOut)
async def update_role(
    user_id: uuid.UUID,
    data: RoleUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.role = data.role
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="An admin already exists") from exc
    await db.refresh(user)
    return user


@router.patch("/{user_id}/preferences", response_model=UserOut)
async def update_preferences(
    user_id: uuid.UUID,
    data: UserPreferencesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.admin and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    if data.theme_dark is not None:
        user.theme_dark = data.theme_dark
    if data.dashboard_hidden_accounts is not None:
        user.dashboard_hidden_accounts = json.dumps(data.dashboard_hidden_accounts)
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=204)
async def deactivate_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if str(user.id) == str(admin.id):
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself")
    user.is_active = False
    await db.commit()


@router.delete("/{user_id}/permanent", status_code=204)
async def delete_user_permanently(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Hard-delete a user. Reassigns authored transactions and recurring items
    to the acting admin so FK RESTRICT constraints don't block the delete."""
    if str(user_id) == str(admin.id):
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Reassign content authored by this user so FK RESTRICT doesn't block deletion
    await db.execute(
        sa_update(Transaction).where(Transaction.created_by == user_id).values(created_by=admin.id)
    )
    await db.execute(
        sa_update(RecurringItem).where(RecurringItem.created_by == user_id).values(created_by=admin.id)
    )
    # refresh_tokens have ondelete=CASCADE — they'll be removed automatically.
    await db.delete(user)
    await db.commit()
