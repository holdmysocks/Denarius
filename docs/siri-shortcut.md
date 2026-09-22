# Siri: "Add Transaction" shortcut

Say **"Hey Siri, add transaction"**, answer a couple of questions, and the
transaction lands in Denarius.

The shortcut is generic. Every time it runs it asks Denarius what to prompt
for (Settings → Shortcuts), so you build it once and change its behaviour from
the app. It authenticates with an API key that can only add transactions and
read account/category names — never your password.

## 1. Prepare Denarius (on the iPhone, in Safari)

1. Open Denarius → **Settings → Shortcuts** (the tab only appears on Apple devices).
2. Under **Defaults**, pick a default **Account**.
3. Under **API keys**, tap **Create key** and **Copy** it — it is shown once.
   Paste it into Notes for a minute; you need it in step 2 below.
4. Note the **Denarius address** shown in the same tab (e.g. `http://100.101.102.103:9724`).

## 2. Build the shortcut (Shortcuts app → **+**)

Name it **Add Transaction** (tap the name at the top). That name is the Siri phrase.

Add these actions in order. "Variable" means *Set Variable*; to insert a
variable into a field, tap the field and pick it from the bar above the keyboard.

**Setup**

| # | Action | Settings |
|---|--------|----------|
| 1 | **Text** | your Denarius address, e.g. `http://100.101.102.103:9724` (no trailing `/`) |
| 2 | **Set Variable** | `Server` |
| 3 | **Text** | your API key (`dnr_…`) |
| 4 | **Set Variable** | `Key` |

**Ask Denarius what to ask**

| # | Action | Settings |
|---|--------|----------|
| 5 | **Get Contents of URL** | URL: `Server` + `/api/v1/shortcuts/config`. Expand ▸ **Headers**: `Authorization` = `Bearer ` + `Key` (with the space) |
| 6 | **Set Variable** | `Config` |
| 7 | **Get Dictionary Value** | Get **Value** for `message` in `Config` |
| 8 | **If** | *Dictionary Value* **has any value** |
| 9 | ↳ **Show Notification** | *Dictionary Value* |
| 10 | ↳ **Stop This Shortcut** | |
| 11 | **End If** | (delete the empty *Otherwise* if you like) |
| 12 | **Get Dictionary Value** | Get **Value** for `ask` in `Config` |
| 13 | **Set Variable** | `Ask` |

Step 7–11 only fire when something is wrong (bad key, server down) and show why.

**Questions**

| # | Action | Settings |
|---|--------|----------|
| 14 | **Ask for Input** | Type **Number**, prompt `How much?` |
| 15 | **Set Variable** | `Amount` |
| 16 | **If** | `Ask` **contains** `description` |
| 17 | ↳ **Ask for Input** | Type **Text**, prompt `What for?` |
| 18 | ↳ **Set Variable** | `Description` |
| 19 | **Otherwise** | |
| 20 | ↳ **Text** | *(leave empty)* |
| 21 | ↳ **Set Variable** | `Description` |
| 22 | **End If** | |
| 23 | **If** | `Ask` **contains** `type` |
| 24 | ↳ **Get Dictionary Value** | Get **Value** for `types` in `Config` |
| 25 | ↳ **Choose from List** | *Dictionary Value*, prompt `Expense or income?` |
| 26 | ↳ **Set Variable** | `Type` |
| 27 | **Otherwise** | |
| 28 | ↳ **Get Dictionary Value** | Get **Value** for `default_type` in `Config` |
| 29 | ↳ **Set Variable** | `Type` |
| 30 | **End If** | |
| 31 | **If** | `Ask` **contains** `category` |
| 32 | ↳ **Get Dictionary Value** | Get **Value** for `categories` in `Config` |
| 33 | ↳ **Get Dictionary Value** | Get **Value** for `Type` in *Dictionary Value* |
| 34 | ↳ **Choose from List** | *Dictionary Value*, prompt `Which category?` |
| 35 | ↳ **Set Variable** | `Category` |
| 36 | **Otherwise** | |
| 37 | ↳ **Text** | `Auto` |
| 38 | ↳ **Set Variable** | `Category` |
| 39 | **End If** | |
| 40 | **If** | `Ask` **contains** `account` |
| 41 | ↳ **Get Dictionary Value** | Get **Value** for `accounts` in `Config` |
| 42 | ↳ **Choose from List** | *Dictionary Value*, prompt `Which account?` |
| 43 | ↳ **Set Variable** | `Account` |
| 44 | **Otherwise** | |
| 45 | ↳ **Text** | *(leave empty)* |
| 46 | ↳ **Set Variable** | `Account` |
| 47 | **End If** | |

**Save and confirm**

| # | Action | Settings |
|---|--------|----------|
| 48 | **Get Contents of URL** | URL: `Server` + `/api/v1/shortcuts/add`. **Method** POST. **Headers**: `Authorization` = `Bearer ` + `Key`. **Request Body** JSON: `amount` (Number) = `Amount`, `description` (Text) = `Description`, `type` (Text) = `Type`, `category` (Text) = `Category`, `account` (Text) = `Account` |
| 49 | **Set Variable** | `Result` |
| 50 | **Get Dictionary Value** | Get **Value** for `message` in `Result` |
| 51 | **Set Variable** | `Message` |
| 52 | **Get Dictionary Value** | Get **Value** for `confirmation` in `Result` |
| 53 | **If** | *Dictionary Value* **contains** `speak` |
| 54 | ↳ **Speak Text** | `Message` |
| 55 | **Otherwise** | |
| 56 | ↳ **If** | *Dictionary Value* **contains** `notify` |
| 57 | ↳↳ **Show Notification** | `Message` |
| 58 | ↳ **End If** | |
| 59 | **End If** | |

Errors always come back with `confirmation: notify`, so you see them even if
you chose "Nothing".

## 3. Try it

Run it once from the Shortcuts app (it will ask permission to talk to your
server — allow it). Then: **"Hey Siri, add transaction."**

## 4. Share it (optional — enables the Import button)

The iCloud link includes the contents of the Text actions, **so remove your
API key first**:

1. Long-press the shortcut → **Duplicate**. In the copy, clear the Text in
   step 3 (and the address in step 1 if others use a different one).
2. Share the copy → **Copy iCloud Link**.
3. Denarius → Settings → Shortcuts → paste into **Shortcut iCloud link (admin)** → Save.

Anyone on an Apple device can then tap **Import shortcut**, and paste their
own address and API key into the first two Text actions.

## API reference

Both endpoints take `Authorization: Bearer dnr_…` and always return a
`message` on failure.

`GET /api/v1/shortcuts/config`

```json
{
  "ok": true,
  "ask": "amount,description,category",
  "types": ["Expense", "Income"],
  "default_type": "Expense",
  "categories": {"Expense": ["Auto", "Groceries", "…"], "Income": ["Auto", "Salary / Wages", "…"]},
  "accounts": ["Checking", "Visa"],
  "confirmation": "notify"
}
```

`POST /api/v1/shortcuts/add`

```json
{"amount": "12.50", "description": "lunch", "type": "Expense", "category": "Auto", "account": ""}
```

Blank or `Auto` fields fall back to Settings → Shortcuts: the default account,
a guessed category (last transaction with the same description, then a
category named in the description), then the default category. The date is
today in the app's timezone.

```json
{"ok": true, "message": "Added $12.50 expense for lunch (Dining Out, Checking).", "confirmation": "notify"}
```
