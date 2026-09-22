"""Apple Shortcuts (Siri) integration.

Two groups of endpoints:

* Signed-in app endpoints (JWT) to manage API keys and shortcut settings.
* Shortcut endpoints (API key) the phone calls: ``GET /shortcuts/config``
  (``?type=income`` for the Add Income shortcut) and ``POST /shortcuts/add``. These always answer with a ``message`` the
  shortcut can show or speak, including on errors, because the Shortcuts app
  has no good way to surface an HTTP error body otherwise.
"""
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db, require_admin
from app.models.api_key import ApiKey
from app.models.app_setting import AppSetting
from app.models.category import Category
from app.models.transaction import TransactionType
from app.models.user import User
from app.rate_limit import limiter
from app.routers.transactions import create_transaction
from app.schemas.transaction import TransactionCreate
from app.services import shortcut_service
from app.utils.app_date import get_app_date

router = APIRouter(prefix="/shortcuts", tags=["shortcuts"])

ShortcutKind = Literal["expense", "income"]

# app_settings keys holding the shared iCloud link for each shortcut.
SHORTCUT_LINK_KEYS: dict[str, str] = {
    "expense": "shortcut_icloud_url_expense",
    "income": "shortcut_icloud_url_income",
}


# ---- Schemas ----

class ApiKeyOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    key_prefix: str
    created_at: datetime
    last_used_at: Optional[datetime] = None


class ApiKeyCreated(ApiKeyOut):
    key: str


class ApiKeyCreate(BaseModel):
    name: str = Field(default="iPhone", min_length=1, max_length=100)


class ShortcutOptions(BaseModel):
    """Settings for one shortcut (Add Expense or Add Income)."""

    ask_description: bool
    ask_category: bool
    ask_account: bool
    default_account_id: Optional[uuid.UUID] = None
    default_category_id: Optional[uuid.UUID] = None


class ShortcutSettingsBody(BaseModel):
    expense: ShortcutOptions
    income: ShortcutOptions
    auto_category: bool
    confirmation: Literal["notify", "speak", "none"]


class ShortcutSettingsOut(ShortcutSettingsBody):
    expense_shortcut_url: Optional[str] = None
    income_shortcut_url: Optional[str] = None


class ShortcutLinkUpdate(BaseModel):
    kind: ShortcutKind
    shortcut_url: Optional[str] = None

    @field_validator("shortcut_url")
    @classmethod
    def must_be_icloud_link(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip() or None
        if v and not v.startswith("https://www.icloud.com/shortcuts/"):
            raise ValueError("Use the iCloud link from the shortcut's Share menu (https://www.icloud.com/shortcuts/...)")
        return v


class QuickAddRequest(BaseModel):
    # Loosely typed on purpose: Shortcuts may send numbers as text and leave
    # unanswered questions as empty strings.
    amount: object = None
    description: Optional[str] = None
    type: Optional[str] = None
    category: Optional[str] = None
    account: Optional[str] = None


# ---- Helpers ----

async def _settings_out(settings, db: AsyncSession) -> ShortcutSettingsOut:
    def options(kind: str) -> ShortcutOptions:
        plan = shortcut_service.plan_for(settings, TransactionType(kind))
        return ShortcutOptions(
            ask_description=plan.ask_description,
            ask_category=plan.ask_category,
            ask_account=plan.ask_account,
            default_account_id=plan.default_account_id,
            default_category_id=plan.default_category_id,
        )

    links = {}
    for kind, key in SHORTCUT_LINK_KEYS.items():
        row = await db.get(AppSetting, key)
        links[f"{kind}_shortcut_url"] = row.value if row else None

    return ShortcutSettingsOut(
        expense=options("expense"),
        income=options("income"),
        auto_category=settings.auto_category,
        confirmation=settings.confirmation,
        **links,
    )


def _shortcut_error(exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Something went wrong adding that."
    return JSONResponse(
        status_code=exc.status_code,
        content={"ok": False, "message": detail, "confirmation": "notify"},
    )


# ---- Signed-in app endpoints ----

@router.get("/keys", response_model=list[ApiKeyOut])
async def list_keys(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ApiKey)
        .where(ApiKey.user_id == current_user.id, ApiKey.revoked_at == None)
        .order_by(ApiKey.created_at.desc())
    )
    return result.scalars().all()


@router.post("/keys", response_model=ApiKeyCreated, status_code=201)
async def create_key(
    body: ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    raw, prefix, key_hash = shortcut_service.generate_api_key()
    key = ApiKey(
        user_id=current_user.id,
        name=body.name.strip(),
        key_prefix=prefix,
        key_hash=key_hash,
        created_at=datetime.now(timezone.utc),
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)
    return ApiKeyCreated(**ApiKeyOut.model_validate(key).model_dump(), key=raw)


@router.delete("/keys/{key_id}", status_code=204)
async def revoke_key(
    key_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    key = await db.scalar(
        select(ApiKey).where(
            ApiKey.id == key_id, ApiKey.user_id == current_user.id, ApiKey.revoked_at == None
        )
    )
    if key is None:
        raise HTTPException(status_code=404, detail="API key not found")
    key.revoked_at = datetime.now(timezone.utc)
    await db.commit()


@router.get("/settings", response_model=ShortcutSettingsOut)
async def get_shortcut_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    settings = await shortcut_service.get_settings(current_user.id, db)
    return await _settings_out(settings, db)


@router.put("/settings", response_model=ShortcutSettingsOut)
async def update_shortcut_settings(
    body: ShortcutSettingsBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    allowed_accounts = {a.id for a in await shortcut_service.shortcut_accounts(db)}
    for kind in ("expense", "income"):
        options: ShortcutOptions = getattr(body, kind)
        if options.default_account_id is not None and options.default_account_id not in allowed_accounts:
            raise HTTPException(status_code=400, detail=f"Default {kind} account not found")
        if options.default_category_id is not None:
            category = await db.get(Category, options.default_category_id)
            if category is None or category.deleted_at is not None:
                raise HTTPException(status_code=400, detail=f"Default {kind} category not found")
            if category.type.value != kind:
                raise HTTPException(
                    status_code=400,
                    detail=f"The default {kind} category must be an {kind} category",
                )

    settings = await shortcut_service.get_settings(current_user.id, db)
    for kind in ("expense", "income"):
        for field, value in getattr(body, kind).model_dump().items():
            setattr(settings, f"{kind}_{field}", value)
    settings.auto_category = body.auto_category
    settings.confirmation = body.confirmation
    db.add(settings)
    await db.commit()
    return await _settings_out(settings, db)


@router.put("/link", response_model=ShortcutLinkUpdate)
async def set_shortcut_link(
    body: ShortcutLinkUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    key = SHORTCUT_LINK_KEYS[body.kind]
    row = await db.get(AppSetting, key)
    if body.shortcut_url is None:
        if row is not None:
            await db.delete(row)
    elif row is None:
        db.add(AppSetting(key=key, value=body.shortcut_url))
    else:
        row.value = body.shortcut_url
    await db.commit()
    return body


# ---- Shortcut (API key) endpoints ----

@router.get("/config")
@limiter.limit("60/minute")
async def shortcut_config(
    request: Request,
    type: Optional[str] = None,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    try:
        user = await shortcut_service.authenticate_api_key(authorization, db)
    except HTTPException as exc:
        return _shortcut_error(exc)
    settings = await shortcut_service.get_settings(user.id, db)
    plan = shortcut_service.plan_for(settings, shortcut_service.parse_type(type))
    return {"ok": True, **await shortcut_service.build_config(plan, db)}


@router.post("/add")
@limiter.limit("30/minute")
async def shortcut_add(
    request: Request,
    body: QuickAddRequest,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    try:
        user = await shortcut_service.authenticate_api_key(authorization, db)
        settings = await shortcut_service.get_settings(user.id, db)
        txn_type = shortcut_service.parse_type(body.type)
        plan = shortcut_service.plan_for(settings, txn_type)

        amount = shortcut_service.parse_amount(body.amount)
        description = (body.description or "").strip()[:255] or None
        account = await shortcut_service.resolve_account(body.account, plan, db)
        category = await shortcut_service.resolve_category(body.category, description, plan, db)

        # Reuse the normal create path so balances, once-per-month rules and
        # recurring-bill matching behave exactly as in the app.
        await create_transaction(
            TransactionCreate(
                account_id=account.id,
                category_id=category.id if category else None,
                amount=amount,
                type=txn_type,
                description=description,
                date=await get_app_date(db),
            ),
            db=db,
            current_user=user,
        )
    except HTTPException as exc:
        return _shortcut_error(exc)

    return {
        "ok": True,
        "message": shortcut_service.confirmation_message(amount, txn_type, description, category, account),
        "confirmation": plan.confirmation,
    }
