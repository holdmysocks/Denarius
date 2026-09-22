"""Apple Shortcuts (Siri) integration: API keys and quick-add resolution.

The shortcut installed on the phone is deliberately dumb. It asks Denarius
what to prompt for (``build_config``), collects answers as plain text, and
posts them back. Everything that needs judgement — matching names to rows,
picking a default account, guessing a category — happens here.
"""
import re
import secrets
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountType
from app.models.api_key import ApiKey
from app.models.category import Category, CategoryType
from app.models.shortcut_settings import ShortcutSettings
from app.models.transaction import Transaction, TransactionType
from app.models.user import User
from app.utils.security import hash_refresh_token

API_KEY_PREFIX = "dnr_"

# Accounts you would plausibly spend from or deposit into by voice. Loans,
# mortgages, property and investments are left out of the shortcut's lists.
SHORTCUT_ACCOUNT_TYPES = (
    AccountType.checking,
    AccountType.savings,
    AccountType.credit_card,
    AccountType.cash,
    AccountType.other,
)

TYPE_LABELS = {TransactionType.expense: "Expense", TransactionType.income: "Income"}
AUTO_CHOICE = "Auto"


# ---- API keys ----

def generate_api_key() -> tuple[str, str, str]:
    """Return (raw key, display prefix, hash)."""
    raw = API_KEY_PREFIX + secrets.token_urlsafe(32)
    return raw, raw[: len(API_KEY_PREFIX) + 6], hash_refresh_token(raw)


async def authenticate_api_key(authorization: str | None, db: AsyncSession) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Your Denarius API key is missing or was revoked. Create a new one in Denarius settings, under Shortcuts.",
    )
    if not authorization:
        raise unauthorized
    scheme, _, raw = authorization.partition(" ")
    raw = raw.strip()
    if scheme.lower() != "bearer" or not raw.startswith(API_KEY_PREFIX):
        raise unauthorized

    key = await db.scalar(
        select(ApiKey).where(ApiKey.key_hash == hash_refresh_token(raw), ApiKey.revoked_at == None)
    )
    if key is None:
        raise unauthorized
    user = await db.scalar(
        select(User).where(User.id == key.user_id, User.is_active == True, User.deleted_at == None)
    )
    if user is None:
        raise unauthorized

    key.last_used_at = datetime.now(timezone.utc)
    await db.commit()
    return user


# ---- Settings ----

async def get_settings(user_id: uuid.UUID, db: AsyncSession) -> ShortcutSettings:
    """Return the user's shortcut settings, or unsaved defaults."""
    settings = await db.get(ShortcutSettings, user_id)
    if settings is None:
        settings = ShortcutSettings(
            user_id=user_id,
            ask_description=True,
            ask_type=False,
            ask_category=False,
            ask_account=False,
            default_type=TransactionType.expense.value,
            default_account_id=None,
            default_category_id=None,
            auto_category=True,
            confirmation="notify",
        )
    return settings


async def shortcut_accounts(db: AsyncSession) -> list[Account]:
    result = await db.execute(
        select(Account)
        .where(
            Account.deleted_at == None,
            Account.is_active == True,
            Account.type.in_(SHORTCUT_ACCOUNT_TYPES),
        )
        .order_by(Account.sort_order, Account.name)
    )
    return list(result.scalars().all())


async def _categories(txn_type: TransactionType, db: AsyncSession) -> list[Category]:
    result = await db.execute(
        select(Category)
        .where(Category.deleted_at == None, Category.type == CategoryType(txn_type.value))
        .order_by(Category.sort_order, Category.name)
    )
    return list(result.scalars().all())


async def build_config(settings: ShortcutSettings, db: AsyncSession) -> dict:
    """What the shortcut should ask for, with the choices for each list.

    ``ask`` is a comma-separated string rather than booleans because a text
    "contains" test is the most reliable condition in the Shortcuts app.
    """
    ask = ["amount"]
    if settings.ask_description:
        ask.append("description")
    if settings.ask_type:
        ask.append("type")
    if settings.ask_category:
        ask.append("category")
    if settings.ask_account:
        ask.append("account")

    accounts = await shortcut_accounts(db)
    if settings.default_account_id:
        # Put the default first so it is the top choice in the list.
        accounts.sort(key=lambda a: a.id != settings.default_account_id)

    categories = {}
    for txn_type, label in TYPE_LABELS.items():
        # dict.fromkeys de-duplicates while keeping the configured order.
        names = dict.fromkeys(c.name for c in await _categories(txn_type, db))
        categories[label] = [AUTO_CHOICE, *names]

    return {
        "ask": ",".join(ask),
        "types": list(TYPE_LABELS.values()),
        "default_type": TYPE_LABELS[TransactionType(settings.default_type)],
        "categories": categories,
        "accounts": [a.name for a in accounts],
        "confirmation": settings.confirmation,
    }


# ---- Quick add ----

_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def parse_amount(value: object) -> Decimal:
    """Accept 12.5, "12.50", "$1,234.56" or "12,50" (numbers or dictated text)."""
    if isinstance(value, bool):
        value = None
    if isinstance(value, (int, float, Decimal)):
        text = str(value)
    else:
        text = str(value or "").strip()
    if re.fullmatch(r"\d+,\d{1,2}", text):
        text = text.replace(",", ".")  # decimal comma, e.g. "12,50"
    match = _NUMBER.search(text)
    if not match:
        raise HTTPException(status_code=400, detail="I couldn't find an amount. Try saying just the number, like 12.50.")
    try:
        amount = Decimal(match.group(0).replace(",", "")).quantize(Decimal("0.01"))
    except InvalidOperation:
        raise HTTPException(status_code=400, detail="That amount didn't look like a number.")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="The amount must be more than zero.")
    return amount


def parse_type(value: str | None, settings: ShortcutSettings) -> TransactionType:
    text = (value or "").strip().lower()
    if text in ("expense", "income"):
        return TransactionType(text)
    return TransactionType(settings.default_type)


def _is_auto(value: str | None) -> bool:
    return (value or "").strip().lower() in ("", AUTO_CHOICE.lower())


async def resolve_account(value: str | None, settings: ShortcutSettings, db: AsyncSession) -> Account:
    accounts = await shortcut_accounts(db)
    name = (value or "").strip().lower()
    if name:
        for account in accounts:
            if account.name.lower() == name:
                return account
        raise HTTPException(status_code=400, detail=f"There's no account called \"{value}\".")
    if settings.default_account_id:
        for account in accounts:
            if account.id == settings.default_account_id:
                return account
    if len(accounts) == 1:
        return accounts[0]
    raise HTTPException(
        status_code=400,
        detail="Pick a default account in Denarius settings, under Shortcuts.",
    )


async def resolve_category(
    value: str | None,
    description: str | None,
    txn_type: TransactionType,
    settings: ShortcutSettings,
    db: AsyncSession,
) -> Category | None:
    categories = await _categories(txn_type, db)

    if not _is_auto(value):
        name = value.strip().lower()
        for category in categories:
            if category.name.lower() == name:
                return category
        raise HTTPException(status_code=400, detail=f"There's no {txn_type.value} category called \"{value}\".")

    if settings.auto_category and description:
        guessed = await guess_category(description, txn_type, categories, db)
        if guessed is not None:
            return guessed

    if settings.default_category_id:
        for category in categories:
            if category.id == settings.default_category_id:
                return category
    return None


async def guess_category(
    description: str,
    txn_type: TransactionType,
    categories: list[Category],
    db: AsyncSession,
) -> Category | None:
    """Reuse the category of the most recent transaction with the same
    description; otherwise match a category name mentioned in the description."""
    by_id = {c.id: c for c in categories}
    previous = await db.execute(
        select(Transaction.category_id)
        .where(
            func.lower(func.trim(Transaction.description)) == description.strip().lower(),
            Transaction.type == txn_type,
            Transaction.category_id.is_not(None),
            Transaction.deleted_at == None,
        )
        .order_by(Transaction.date.desc(), Transaction.created_at.desc())
        .limit(5)
    )
    for category_id in previous.scalars():
        if category_id in by_id:
            return by_id[category_id]

    words = set(re.findall(r"[a-z0-9]+", description.lower()))
    for category in categories:
        name_words = set(re.findall(r"[a-z0-9]+", category.name.lower()))
        if name_words and name_words <= words:
            return category
    return None


def confirmation_message(
    amount: Decimal,
    txn_type: TransactionType,
    description: str | None,
    category: Category | None,
    account: Account,
) -> str:
    kind = "expense" if txn_type == TransactionType.expense else "income"
    headline = f"Added ${amount:,.2f} {kind}"
    if description:
        headline += f" for {description}"
    details = [category.name, account.name] if category is not None else [account.name]
    return f"{headline} ({', '.join(details)})."
