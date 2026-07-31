import fnmatch
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountType
from app.models.category import Category, CategoryType
from app.models.mortgage_detail import MortgageDetail
from app.models.recurring_item import RecurringItem
from app.models.transaction import Transaction, TransactionType
from app.utils.app_date import get_app_date
from app.utils.date_utils import advance_by_frequency, rewind_by_frequency


async def mark_paid(
    item: RecurringItem,
    db: AsyncSession,
    created_by: uuid.UUID,
    payment_date: date | None = None,
    amount=None,
    description: str | None = None,
    account_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    source_account_id: uuid.UUID | None = None,
    category_id_provided: bool = False,
) -> Transaction:
    txn_date = payment_date or await get_app_date(db)
    txn_amount = amount if amount is not None else item.amount
    resolved_account_id = account_id or item.account_id
    resolved_category_id = (
        category_id
        if category_id_provided or category_id is not None
        else item.category_id
    )

    account = await db.get(Account, resolved_account_id)

    # Mortgage payment: create two paired transactions (mirrors record_mortgage_payment)
    if account and account.type == AccountType.mortgage and source_account_id:
        src_account = await db.get(Account, source_account_id)

        # Calculate principal/interest split from mortgage details
        mtg_result = await db.execute(
            select(MortgageDetail).where(MortgageDetail.account_id == account.id)
        )
        mortgage = mtg_result.scalar_one_or_none()
        if mortgage and account.current_balance != 0:
            monthly_rate = mortgage.interest_rate / 100 / 12
            monthly_interest = abs(account.current_balance) * monthly_rate
            principal = max(txn_amount - monthly_interest, Decimal("0.01"))
        else:
            principal = txn_amount

        # Auto-find mortgage/loan category (fallback to item category)
        cat_result = await db.execute(
            select(Category).where(
                Category.deleted_at == None,
                Category.type == CategoryType.expense,
                or_(
                    func.lower(Category.name).contains("mortgage"),
                    func.lower(Category.name).contains("loan"),
                ),
            ).limit(1)
        )
        mtg_category = cat_result.scalar_one_or_none()
        mtg_category_id = mtg_category.id if mtg_category else resolved_category_id

        desc = description if description is not None else item.name

        src_txn = Transaction(
            account_id=source_account_id,
            category_id=mtg_category_id,
            recurring_item_id=item.id,
            expense_account_id=item.expense_account_id,
            amount=txn_amount,
            type=TransactionType.expense,
            description=desc,
            date=txn_date,
            created_by=created_by,
        )
        mtg_txn = Transaction(
            account_id=account.id,
            category_id=mtg_category_id,
            amount=principal,
            type=TransactionType.income,
            description=desc + " — principal",
            date=txn_date,
            created_by=created_by,
        )
        db.add(src_txn)
        db.add(mtg_txn)

        if src_account:
            src_account.current_balance -= txn_amount
        account.current_balance += principal

        item.next_due_date = advance_by_frequency(item.next_due_date, item.frequency)
        await db.flush()

        src_txn.paired_transaction_id = mtg_txn.id
        mtg_txn.paired_transaction_id = src_txn.id

        item.last_paid_date = txn_date
        item.last_paid_amount = txn_amount
        item.last_paid_transaction_id = src_txn.id

        await db.commit()
        return src_txn

    # Normal bill/subscription/income: single transaction
    txn_type = TransactionType.income if item.type.value == "income" else TransactionType.expense

    txn = Transaction(
        account_id=resolved_account_id,
        category_id=resolved_category_id,
        recurring_item_id=item.id,
        expense_account_id=item.expense_account_id,
        amount=txn_amount,
        type=txn_type,
        description=description if description is not None else item.name,
        date=txn_date,
        created_by=created_by,
    )
    db.add(txn)

    if account:
        if txn_type == TransactionType.expense:
            account.current_balance -= txn_amount
        else:
            account.current_balance += txn_amount

    item.next_due_date = advance_by_frequency(item.next_due_date, item.frequency)
    await db.flush()
    item.last_paid_date = txn_date
    item.last_paid_amount = txn_amount
    item.last_paid_transaction_id = txn.id
    await db.commit()
    await db.refresh(txn)

    return txn


async def mark_paid_no_transaction(
    item: RecurringItem,
    db: AsyncSession,
    payment_date: date | None = None,
    amount=None,
) -> None:
    txn_date = payment_date or await get_app_date(db)
    txn_amount = amount if amount is not None else item.amount

    item.last_paid_date = txn_date
    item.last_paid_amount = txn_amount
    item.last_paid_transaction_id = None
    item.next_due_date = advance_by_frequency(item.next_due_date, item.frequency)
    await db.commit()


async def auto_post_due_items(db: AsyncSession) -> int:
    today = await get_app_date(db)
    result = await db.execute(
        select(RecurringItem)
        .join(Account, RecurringItem.account_id == Account.id)
        .where(
            RecurringItem.auto_post == True,
            RecurringItem.is_active == True,
            RecurringItem.next_due_date <= today,
            RecurringItem.deleted_at == None,
            Account.deleted_at == None,
            Account.is_active == True,
        )
        .with_for_update(skip_locked=True)
    )
    items = result.scalars().all()

    pairs: list[tuple[RecurringItem, Transaction]] = []
    for item in items:
        txn_type = TransactionType.income if item.type.value == "income" else TransactionType.expense
        txn = Transaction(
            account_id=item.account_id,
            category_id=item.category_id,
            recurring_item_id=item.id,
            expense_account_id=item.expense_account_id,
            amount=item.amount,
            type=txn_type,
            description=f"{item.name} (auto-posted)",
            date=item.next_due_date,
            created_by=item.created_by,
        )
        db.add(txn)

        account = await db.get(Account, item.account_id)
        if account:
            if txn_type == TransactionType.expense:
                account.current_balance -= item.amount
            else:
                account.current_balance += item.amount

        prev_due = item.next_due_date
        item.next_due_date = advance_by_frequency(item.next_due_date, item.frequency)
        item.last_paid_date = prev_due
        item.last_paid_amount = item.amount
        pairs.append((item, txn))

    if not pairs:
        return 0

    await db.flush()
    for item, txn in pairs:
        item.last_paid_transaction_id = txn.id

    await db.commit()
    return len(pairs)


def _amount_in_range(txn_amount: Decimal, item: RecurringItem) -> bool:
    """Return True if txn_amount falls within the item's configured amount range."""
    if item.amount_min is not None and item.amount_max is not None:
        return item.amount_min <= txn_amount <= item.amount_max
    # Fixed amount: allow ±5% tolerance
    tolerance = item.amount * Decimal("0.05")
    return abs(txn_amount - item.amount) <= tolerance


def _keywords_match(description: str | None, keyword_match: str) -> bool:
    """Return True if any comma-separated keyword matches the description (case-insensitive).

    Plain keywords match as substrings anywhere in the description.
    Keywords containing * or ? are treated as glob patterns matched against the full description.
    Examples: "Netflix" matches "NETFLIX SUBSCRIPTION"; "AMZN*" matches "AMZN MARKETPLACE 123";
    "*PRIME*" matches "AMAZON PRIME VIDEO".
    """
    desc = (description or "").lower()
    keywords = [k.strip().lower() for k in keyword_match.split(",") if k.strip()]
    for k in keywords:
        if "*" in k or "?" in k:
            if fnmatch.fnmatch(desc, k):
                return True
        else:
            if k in desc:
                return True
    return False


def _attach_to_item(txn: Transaction, item: RecurringItem) -> None:
    """Link a transaction to a recurring item and advance its tracking fields."""
    txn.recurring_item_id = item.id
    item.next_due_date = advance_by_frequency(item.next_due_date, item.frequency)
    item.last_paid_date = txn.date
    item.last_paid_amount = txn.amount
    item.last_paid_transaction_id = txn.id


async def find_and_attach_recurring(txn: Transaction, db: AsyncSession) -> RecurringItem | None:
    """
    Attempt to link a transaction to a recurring item.

    Pass 1 — category match (once_per_month categories only):
      If the transaction has a category that is marked once_per_month, find the
      active recurring item for that category and link immediately (no keyword/amount
      check needed — the category constraint is already explicit user intent).

    Pass 2 — keyword + amount match (auto_match items only):
      Fallback for transactions without a once_per_month category. Requires
      auto_match=True on the recurring item plus keyword and amount criteria.

    Returns the matched RecurringItem (with next_due_date already advanced) or None.
    """
    # Pass 1: category-first for once_per_month categories
    if txn.category_id:
        stmt = (
            select(RecurringItem)
            .join(Category, RecurringItem.category_id == Category.id)
            .where(
                RecurringItem.category_id == txn.category_id,
                RecurringItem.is_active == True,
                RecurringItem.deleted_at == None,
                Category.once_per_month == True,
                Category.deleted_at == None,
            )
        )
        cat_match = (await db.execute(stmt)).scalar_one_or_none()
        if cat_match:
            _attach_to_item(txn, cat_match)
            return cat_match

    # Pass 2: keyword + amount matching (requires auto_match=True)
    result = await db.execute(
        select(RecurringItem).where(
            RecurringItem.auto_match == True,
            RecurringItem.is_active == True,
            RecurringItem.deleted_at == None,
        )
    )
    candidates = result.scalars().all()

    txn_amount = abs(txn.amount)

    for item in candidates:
        # Must have at least a keyword or category configured to avoid false positives
        if not item.keyword_match and not item.category_id:
            continue

        # Keyword check
        if item.keyword_match and not _keywords_match(txn.description, item.keyword_match):
            continue

        # Amount range check
        if not _amount_in_range(txn_amount, item):
            continue

        # Category check — only a hard filter when both sides specify a category
        if item.category_id and txn.category_id and item.category_id != txn.category_id:
            continue

        # Match found — link and advance
        _attach_to_item(txn, item)
        return item

    return None


async def match_unlinked_current_month(item: RecurringItem, db: AsyncSession) -> bool:
    """
    After editing a recurring item, find and attach the most recent unlinked
    transaction from the current calendar month that matches the item's criteria.

    Only runs when auto_match is enabled and the item is not already marked paid
    for the current period. Returns True if a transaction was linked.
    """
    if not item.auto_match:
        return False
    if not item.keyword_match and not item.category_id:
        return False

    today = await get_app_date(db)
    month_start = today.replace(day=1)
    if item.last_paid_date is not None and month_start <= item.last_paid_date <= today:
        return False

    result = await db.execute(
        select(Transaction).where(
            Transaction.recurring_item_id == None,
            Transaction.deleted_at == None,
            Transaction.date >= month_start,
            Transaction.date <= today,
        ).order_by(Transaction.date.desc())
    )

    for txn in result.scalars().all():
        txn_amount = abs(txn.amount)
        if item.keyword_match and not _keywords_match(txn.description, item.keyword_match):
            continue
        if not _amount_in_range(txn_amount, item):
            continue
        if item.category_id and txn.category_id and item.category_id != txn.category_id:
            continue

        txn.recurring_item_id = item.id
        item.next_due_date = advance_by_frequency(item.next_due_date, item.frequency)
        item.last_paid_date = txn.date
        item.last_paid_amount = txn.amount
        item.last_paid_transaction_id = txn.id
        return True

    return False


async def detach_recurring(txn: Transaction, db: AsyncSession) -> None:
    """Detach one payment and restore the recurring item to the remaining history.

    Every linked transaction advances ``next_due_date`` once. Deleting any linked
    payment must therefore rewind it once, not only when deleting the most recent
    payment. The last-paid fields are then derived from the newest payment that
    remains active.
    """
    if txn.recurring_item_id is None:
        return
    item = await db.get(RecurringItem, txn.recurring_item_id)
    if item is None:
        return
    item.next_due_date = rewind_by_frequency(item.next_due_date, item.frequency)

    result = await db.execute(
        select(Transaction)
        .where(
            Transaction.recurring_item_id == item.id,
            Transaction.deleted_at == None,
            Transaction.id != txn.id,
        )
        .order_by(
            Transaction.date.desc(),
            Transaction.created_at.desc(),
            Transaction.id.desc(),
        )
        .limit(1)
    )
    previous_payment = result.scalar_one_or_none()
    if previous_payment is None:
        item.last_paid_date = None
        item.last_paid_amount = None
        item.last_paid_transaction_id = None
    else:
        item.last_paid_date = previous_payment.date
        item.last_paid_amount = previous_payment.amount
        item.last_paid_transaction_id = previous_payment.id


async def update_recurring_item(
    txn: Transaction,
    db: AsyncSession,
    previous_date: date | None = None,
) -> None:
    """If the transaction is linked to a recurring item, update the item's details."""
    if txn.recurring_item_id is None:
        return

    item = await db.get(RecurringItem, txn.recurring_item_id)
    if not item:
        return

    is_current_payment = (
        item.last_paid_transaction_id == txn.id
        or (
            item.last_paid_transaction_id is None
            and item.last_paid_date in {txn.date, previous_date}
        )
    )
    if is_current_payment:
        item.last_paid_date = txn.date
        item.last_paid_amount = txn.amount
        item.amount = txn.amount
