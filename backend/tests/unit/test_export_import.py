import io
import json
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException, UploadFile

from app.models.account import Account, AccountType
from app.models.category import Category, CategoryType
from app.models.recurring_item import RecurringItem
from app.models.transaction import Transaction, TransactionType
from app.routers.export import (
    PORTABLE_SETTING_KEYS,
    _dashboard_hidden_accounts_for_export,
    _dashboard_hidden_accounts_for_import,
    _remap_account_breakdown,
    _validate_import_payload,
    export_data,
    import_data,
)


class _Scalars:
    def __init__(self, values):
        self._values = values

    def all(self):
        return self._values


class _Result:
    def __init__(self, scalar=None, values=None):
        self._scalar = scalar
        self._values = values or []

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return _Scalars(self._values)


class _Savepoint:
    def __init__(self):
        self.is_active = True
        self.committed = False
        self.rolled_back = False

    async def commit(self):
        self.committed = True
        self.is_active = False

    async def rollback(self):
        self.rolled_back = True
        self.is_active = False


class _ImportDatabase:
    def __init__(self, *, account=None, category=None):
        self.account = account
        self.category = category
        self.added = []
        self.savepoints = []
        self.commit_count = 0
        self.flush_count = 0

    async def begin_nested(self):
        savepoint = _Savepoint()
        self.savepoints.append(savepoint)
        return savepoint

    async def execute(self, statement):
        sql = str(statement)
        if "FROM accounts" in sql:
            return _Result(scalar=self.account)
        if "FROM categories" in sql:
            return _Result(scalar=self.category)
        return _Result()

    async def get(self, model, key):
        if model is Account and self.account is not None and key == self.account.id:
            return self.account
        if model is Category and self.category is not None and key == self.category.id:
            return self.category
        for value in self.added:
            if isinstance(value, model) and getattr(value, "id", None) == key:
                return value
        return None

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        self.flush_count += 1
        for value in self.added:
            if getattr(value, "id", None) is None:
                value.id = uuid.uuid4()

    async def commit(self):
        self.commit_count += 1


async def _response_json(response):
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk.encode() if isinstance(chunk, str) else chunk)
    return json.loads(b"".join(chunks))


def _upload(payload: object) -> UploadFile:
    raw = json.dumps(payload).encode()
    return UploadFile(file=io.BytesIO(raw), filename="backup.json", size=len(raw))


class ExportSerializationTests(unittest.IsolatedAsyncioTestCase):
    async def test_date_filter_is_restorable_when_it_excludes_no_transactions(self):
        db = SimpleNamespace(
            scalar=AsyncMock(return_value=0),
            execute=AsyncMock(return_value=_Result(values=[])),
        )

        with patch(
            "app.routers.export.get_app_date",
            new=AsyncMock(return_value=date(2026, 7, 31)),
        ):
            response = await export_data(
                include_transactions=True,
                transaction_start_date=date(2025, 11, 3),
                db=db,
                current_user=SimpleNamespace(),
            )
        payload = await _response_json(response)

        self.assertTrue(payload["transaction_scope"]["complete"])
        db.scalar.assert_awaited_once()

    async def test_date_filter_is_archival_when_it_excludes_transactions(self):
        db = SimpleNamespace(
            scalar=AsyncMock(return_value=1),
            execute=AsyncMock(return_value=_Result(values=[])),
        )

        with patch(
            "app.routers.export.get_app_date",
            new=AsyncMock(return_value=date(2026, 7, 31)),
        ):
            response = await export_data(
                include_transactions=True,
                transaction_start_date=date(2026, 7, 1),
                db=db,
                current_user=SimpleNamespace(),
            )
        payload = await _response_json(response)

        self.assertFalse(payload["transaction_scope"]["complete"])

    async def test_financial_relationship_and_state_fields_are_exported(self):
        account_id = uuid.uuid4()
        category_id = uuid.uuid4()
        recurring_id = uuid.uuid4()
        transaction_id = uuid.uuid4()
        paired_id = uuid.uuid4()
        expense_account_id = uuid.uuid4()
        mortgage_id = uuid.uuid4()

        account = SimpleNamespace(
            id=account_id,
            name="Checking",
            type=AccountType.checking,
            institution="Bank",
            account_number="1234",
            current_balance=Decimal("500.25"),
            initial_balance=Decimal("100.00"),
            credit_limit=None,
            sort_order=1,
            notes="Primary",
            color="#112233",
            is_active=True,
            linked_mortgage_id=mortgage_id,
        )
        recurring = SimpleNamespace(
            id=recurring_id,
            name="Power",
            account_id=account_id,
            category_id=category_id,
            expense_account_id=expense_account_id,
            amount=Decimal("75.00"),
            amount_min=Decimal("50.00"),
            amount_max=Decimal("100.00"),
            type=SimpleNamespace(value="bill"),
            frequency=SimpleNamespace(value="monthly"),
            day_of_month=10,
            next_due_date=date(2026, 8, 10),
            auto_post=True,
            auto_match=True,
            keyword_match="POWER",
            is_active=True,
            notes=None,
            last_paid_date=date(2026, 7, 10),
            last_paid_amount=Decimal("72.40"),
            last_paid_transaction_id=transaction_id,
        )
        transaction = SimpleNamespace(
            id=transaction_id,
            account_id=account_id,
            account=account,
            category_id=category_id,
            category=SimpleNamespace(name="Utilities"),
            transfer_account_id=None,
            recurring_item_id=recurring_id,
            expense_account_id=expense_account_id,
            paired_transaction_id=paired_id,
            amount=Decimal("72.40"),
            type=TransactionType.expense,
            description="Power bill",
            notes=None,
            date=date(2026, 7, 10),
            is_hidden=True,
        )
        db = SimpleNamespace(
            execute=AsyncMock(
                side_effect=[
                    _Result(values=[account]),
                    _Result(values=[recurring]),
                    _Result(values=[transaction]),
                ]
            )
        )

        with patch(
            "app.routers.export.get_app_date",
            new=AsyncMock(return_value=date(2026, 7, 31)),
        ):
            response = await export_data(
                include_accounts=True,
                include_recurring=True,
                include_transactions=True,
                db=db,
                current_user=SimpleNamespace(),
            )
        payload = await _response_json(response)

        self.assertEqual(payload["version"], "1.1")
        self.assertEqual(
            payload["transaction_scope"],
            {"complete": True, "start_date": None, "end_date": None},
        )
        self.assertEqual(payload["accounts"][0]["account_number"], "1234")
        self.assertEqual(payload["accounts"][0]["initial_balance"], "100.00")
        self.assertEqual(payload["accounts"][0]["linked_mortgage_id"], str(mortgage_id))
        self.assertEqual(payload["recurring_items"][0]["expense_account_id"], str(expense_account_id))
        self.assertEqual(payload["recurring_items"][0]["last_paid_transaction_id"], str(transaction_id))
        self.assertEqual(payload["transactions"][0]["recurring_item_id"], str(recurring_id))
        self.assertEqual(payload["transactions"][0]["paired_transaction_id"], str(paired_id))
        self.assertTrue(payload["transactions"][0]["is_hidden"])

    def test_dashboard_preferences_use_portable_lists_and_remap_account_ids(self):
        old_id = str(uuid.uuid4())
        new_id = uuid.uuid4()
        encoded = json.dumps([old_id])

        self.assertEqual(_dashboard_hidden_accounts_for_export(encoded), [old_id])
        self.assertEqual(
            json.loads(_dashboard_hidden_accounts_for_import([old_id], {old_id: new_id})),
            [str(new_id)],
        )

    def test_snapshot_breakdown_account_ids_are_remapped(self):
        old_id = str(uuid.uuid4())
        new_id = uuid.uuid4()
        original = [{"account_id": old_id, "balance": "10.00"}]

        remapped = _remap_account_breakdown(original, {old_id: new_id})

        self.assertEqual(remapped[0]["account_id"], str(new_id))
        self.assertEqual(original[0]["account_id"], old_id)

    def test_portable_settings_include_the_key_used_by_budget_sync(self):
        self.assertIn("keep_for_next_month", PORTABLE_SETTING_KEYS)
        self.assertNotIn("budget_keep_categories", PORTABLE_SETTING_KEYS)


class ImportCompatibilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_v1_export_is_accepted_and_committed_once(self):
        db = _ImportDatabase()

        result = await import_data(
            file=_upload({"version": "1.0"}),
            db=db,
            current_user=SimpleNamespace(id=uuid.uuid4()),
        )

        self.assertEqual(result, {"imported": {}, "skipped": {}, "errors": []})
        self.assertEqual(db.commit_count, 1)

    async def test_invalid_item_rolls_back_only_its_savepoint_and_import_continues(self):
        db = _ImportDatabase()
        payload = {
            "version": "1.0",
            "categories": [
                {"id": str(uuid.uuid4()), "name": "Bad", "type": "invalid"},
                {"id": str(uuid.uuid4()), "name": "Food", "type": "expense"},
            ],
        }

        result = await import_data(
            file=_upload(payload),
            db=db,
            current_user=SimpleNamespace(id=uuid.uuid4()),
        )

        self.assertEqual(result["imported"]["categories"], 1)
        self.assertEqual(len(result["errors"]), 1)
        self.assertTrue(db.savepoints[0].rolled_back)
        self.assertTrue(db.savepoints[1].committed)
        self.assertEqual(db.commit_count, 1)

    async def test_duplicate_custom_category_names_preserve_distinct_source_ids(self):
        first_id = uuid.uuid4()
        second_id = uuid.uuid4()
        db = _ImportDatabase()

        result = await import_data(
            file=_upload(
                {
                    "version": "1.0",
                    "categories": [
                        {
                            "id": str(first_id),
                            "name": "Household",
                            "type": "expense",
                            "is_system": False,
                        },
                        {
                            "id": str(second_id),
                            "name": "Household",
                            "type": "expense",
                            "is_system": False,
                        },
                    ],
                }
            ),
            db=db,
            current_user=SimpleNamespace(id=uuid.uuid4()),
        )

        categories = [item for item in db.added if isinstance(item, Category)]
        self.assertEqual(result["imported"]["categories"], 2)
        self.assertEqual({item.id for item in categories}, {first_id, second_id})

    async def test_seeded_system_category_maps_by_name_and_type(self):
        seeded = Category(
            id=uuid.uuid4(),
            name="Groceries",
            type=CategoryType.expense,
            is_system=True,
        )
        db = _ImportDatabase(category=seeded)

        result = await import_data(
            file=_upload(
                {
                    "version": "1.0",
                    "categories": [
                        {
                            "id": str(uuid.uuid4()),
                            "name": "Groceries",
                            "type": "expense",
                            "is_system": True,
                        }
                    ],
                }
            ),
            db=db,
            current_user=SimpleNamespace(id=uuid.uuid4()),
        )

        self.assertEqual(result["imported"]["categories"], 0)
        self.assertEqual(result["skipped"]["categories"], 1)
        self.assertEqual(db.added, [])

    async def test_identical_transactions_with_distinct_export_ids_both_survive(self):
        account_id = uuid.uuid4()
        db = _ImportDatabase()
        common = {
            "account_id": str(account_id),
            "amount": "10.00",
            "type": "expense",
            "description": "Coffee",
            "date": "2026-07-31",
        }
        first_id = uuid.uuid4()
        second_id = uuid.uuid4()

        result = await import_data(
            file=_upload(
                {
                    "version": "1.0",
                    "accounts": [
                        {
                            "id": str(account_id),
                            "name": "Checking",
                            "type": "checking",
                            "current_balance": "100.00",
                        }
                    ],
                    "transactions": [
                        {"id": str(first_id), **common},
                        {"id": str(second_id), **common},
                    ],
                }
            ),
            db=db,
            current_user=SimpleNamespace(id=uuid.uuid4()),
        )

        transactions = [item for item in db.added if isinstance(item, Transaction)]
        self.assertEqual(result["imported"]["transactions"], 2)
        self.assertEqual({item.id for item in transactions}, {first_id, second_id})
        self.assertEqual(db.commit_count, 1)

    async def test_new_transactions_are_not_merged_into_an_existing_account(self):
        account = Account(
            id=uuid.uuid4(),
            name="Checking",
            type=AccountType.checking,
            current_balance=Decimal("90.00"),
            initial_balance=Decimal("100.00"),
        )
        db = _ImportDatabase(account=account)
        payload = {
            "version": "1.1",
            "accounts": [
                {
                    "id": str(account.id),
                    "name": account.name,
                    "type": account.type.value,
                    "current_balance": "80.00",
                    "initial_balance": "100.00",
                }
            ],
            "transactions": [
                {
                    "id": str(uuid.uuid4()),
                    "account_id": str(account.id),
                    "amount": "20.00",
                    "type": "expense",
                    "description": "Would desync balance",
                    "date": "2026-07-31",
                }
            ],
        }

        result = await import_data(
            file=_upload(payload),
            db=db,
            current_user=SimpleNamespace(id=uuid.uuid4()),
        )

        self.assertEqual(result["imported"]["transactions"], 0)
        self.assertEqual(result["skipped"]["transactions"], 1)
        self.assertIn("restore into a clean target", result["errors"][0])
        self.assertEqual(account.current_balance, Decimal("90.00"))
        self.assertFalse(any(isinstance(item, Transaction) for item in db.added))

    async def test_paired_and_recurring_transaction_links_round_trip(self):
        account_id = uuid.uuid4()
        recurring_id = uuid.uuid4()
        outgoing_id = uuid.uuid4()
        incoming_id = uuid.uuid4()
        db = _ImportDatabase()
        payload = {
            "version": "1.1",
            "accounts": [
                {
                    "id": str(account_id),
                    "name": "Checking",
                    "type": "checking",
                    "current_balance": "100.00",
                }
            ],
            "recurring_items": [
                {
                    "id": str(recurring_id),
                    "name": "Transfer",
                    "account_id": str(account_id),
                    "amount": "10.00",
                    "type": "bill",
                    "frequency": "monthly",
                    "next_due_date": "2026-08-01",
                    "last_paid_date": "2026-07-01",
                    "last_paid_amount": "10.00",
                    "last_paid_transaction_id": str(outgoing_id),
                }
            ],
            "transactions": [
                {
                    "id": str(outgoing_id),
                    "account_id": str(account_id),
                    "recurring_item_id": str(recurring_id),
                    "paired_transaction_id": str(incoming_id),
                    "amount": "10.00",
                    "type": "expense",
                    "description": "Transfer",
                    "date": "2026-07-01",
                },
                {
                    "id": str(incoming_id),
                    "account_id": str(account_id),
                    "paired_transaction_id": str(outgoing_id),
                    "amount": "10.00",
                    "type": "income",
                    "description": "Transfer",
                    "date": "2026-07-01",
                },
            ],
            "transaction_scope": {"complete": True},
        }

        result = await import_data(
            file=_upload(payload),
            db=db,
            current_user=SimpleNamespace(id=uuid.uuid4()),
        )

        transactions = {
            item.id: item for item in db.added if isinstance(item, Transaction)
        }
        recurring = next(item for item in db.added if isinstance(item, RecurringItem))
        self.assertEqual(result["errors"], [])
        self.assertEqual(transactions[outgoing_id].paired_transaction_id, incoming_id)
        self.assertEqual(transactions[incoming_id].paired_transaction_id, outgoing_id)
        self.assertEqual(transactions[outgoing_id].recurring_item_id, recurring_id)
        self.assertEqual(recurring.last_paid_transaction_id, outgoing_id)

    async def test_restored_timezone_reschedules_only_after_commit(self):
        db = _ImportDatabase()
        reschedule = Mock(side_effect=lambda _: self.assertEqual(db.commit_count, 1))

        with (
            patch(
                "app.routers.export.scheduler",
                SimpleNamespace(running=True),
            ),
            patch("app.routers.export.reschedule_jobs", reschedule),
        ):
            result = await import_data(
                file=_upload(
                    {"version": "1.1", "settings": {"timezone": "America/New_York"}}
                ),
                db=db,
                current_user=SimpleNamespace(id=uuid.uuid4()),
            )

        self.assertEqual(result["errors"], [])
        self.assertEqual(db.commit_count, 1)
        reschedule.assert_called_once_with("America/New_York")

    def test_payload_validation_rejects_future_versions_and_malformed_sections(self):
        self.assertEqual(_validate_import_payload({"version": "1.0"})["version"], "1.0")
        with self.assertRaises(HTTPException):
            _validate_import_payload({"version": "9.0"})
        with self.assertRaises(HTTPException):
            _validate_import_payload({"version": "1.1", "transactions": {}})
        with self.assertRaises(HTTPException):
            _validate_import_payload({"version": "1.1", "accounts": ["bad"]})
        with self.assertRaises(HTTPException) as caught:
            _validate_import_payload(
                {
                    "version": "1.1",
                    "transactions": [],
                    "transaction_scope": {
                        "complete": False,
                        "start_date": "2026-01-01",
                        "end_date": None,
                    },
                }
            )
        self.assertIn("archives", caught.exception.detail)


if __name__ == "__main__":
    unittest.main()
