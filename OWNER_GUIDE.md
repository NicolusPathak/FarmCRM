# Chaudhary Farm — Owner's guide

Plain English. Print this and keep it near the counter.

---

## 1. What this app does

This app is your customer book and your daily sales record, all in one place. Every customer who walks in can be saved with their name and phone number. Every order they make is tracked — what they bought, how much, how they paid. You can see at a glance what the shop made today, who's slipping away, and who hasn't come back in a while.

Your staff can take orders and update customer information. Only you can delete a customer, change a payment after the fact, or pull data out as a spreadsheet. Every change your staff makes is recorded so you can check exactly what happened later.

---

## 2. Logging in

- **Your PIN (the owner login):** 4 digits. You set it when the app was installed. Enter it on the sign-in screen.
- **If you forget your PIN:** call your developer. They can reset it.
- **Staff PINs:** you create them. Each staff member gets their own 4-digit PIN.
  1. Sign in as owner.
  2. Click **Staff PINs** in the left menu.
  3. Type their name and the 4 digits you want to give them.
  4. Click **Create PIN**.
  5. To remove a staff member: find them in the list and click **Revoke**.

> **Never share your owner PIN with staff.** If you share it, everything they do shows up as if *you* did it, and the audit log loses meaning.

---

## 3. The four things you'll do most often

### Add a new customer
1. Click **Customers** in the left menu.
2. Click **New customer**.
3. Type their name and phone number. The rest is optional.
4. Click **Create customer**.

### Take an order
1. Click **New order** at the top of the dashboard.
2. Search for the customer by name or phone (or click **New customer** if they're new).
3. Add each item — name, quantity, price.
4. **Pick payment method — Cash, Card, or Zelle. Cash is the default.**
5. Click **Save order**. Done.

### Find a customer by phone number
1. On the dashboard, click the big **Search** bar.
2. Type the digits — `8175559111` works fine. Punctuation isn't needed.
3. Click the customer in the dropdown.

### See today's sales
- Sign in. The top of the dashboard shows four boxes: **Today, Yesterday, This week, This month.** Each shows the total revenue and number of orders.
- Voided orders are excluded — only money you actually took home.

---

## 4. Checking what your staff did

- Click **Activity** in the left menu. You'll see every change in time order — who did what, when, and from where (IP address).
- What's recorded: new customers, edited customers, deleted customers, new orders, edited orders, voided orders, payment method changes, staff PINs created or removed, every CSV export, every change to retention settings.
- For each change you can see what the field was *before* and what it became *after*.
- **Records nearly every action.** In rare network problems an edit might happen without a log entry. If something looks off — a customer's points dropped, an order is missing, a balance doesn't match — call the developer within 24 hours. Don't try to fix it yourself.
- Scroll to find what you need. For big searches (e.g. "what did Ram do last month?"), use the **Export** page to download the audit log as a CSV and open it in Excel — much easier to filter and sort there.

---

## 5. Getting your data out

Click **Export** in the left menu. You'll see three buttons:

- **Download customers CSV** — every customer, with their order history totals.
- **Download orders CSV** — every order in a date range you pick.
- **Download audit CSV** — every change in a date range you pick.

These open directly in Excel or Google Sheets. **You own this data.** Run them weekly and save the files to your computer or to Google Drive — that's your real backup.

---

## 6. About the payment method field

- **Every order has a payment method. Cash is the default. Staff can pick Card or Zelle at the counter.**
- **All orders before May 14, 2026 are marked Cash by default** — that's because the field was added on that day and historical orders had to be filled in with something. It's not real history for those older orders. Orders from May 14 onward show what staff actually picked at the counter.
- **If a staff member picks the wrong one, only you (admin) can change it after the sale.** Open the order, click **Edit**, pick the right payment, click **Save**. Every change is recorded in the audit log so you can show exactly what was changed and when.
- **Staff cannot change payment method after they save the order.** If they need a correction, they have to come to you.

---

## 7. When something goes wrong

| What you see | What to do |
|---|---|
| App won't load | Check your internet. If internet is fine, call the developer. |
| I can't log in | Try once more carefully. If still no, call the developer — they can reset your PIN. |
| Staff PIN needs to be removed | Sign in → **Staff PINs** → find the name → **Revoke**. |
| Something looks wrong in the data (missing order, weird balance) | **Don't fix it yourself.** Call the developer within 24 hours. They can see the audit log and figure out what happened. |

**Developer contact:**
- Name: ___________________________
- Phone: ___________________________
- Email: ___________________________
- Hours: ___________________________

*(Fill these in before you hand the printed copy to your owner.)*

---

## 8. What the app does NOT do

- Does not print thermal receipts (uses your browser's print dialog instead).
- Does not send SMS or WhatsApp.
- Does not work when internet is down.
- Does not predict future sales or run reports beyond the simple "today / yesterday / this week / this month" numbers.
- Does not replace your accountant. Use the CSV exports to give your accountant the actual numbers.

---

## 9. If the developer disappears

This app is yours. The data lives at Supabase, a database company independent of your developer. The code lives in this repository.

If you ever lose touch with your current developer:
1. Your data is safe — you've been saving the weekly CSVs to your computer or Drive. Open them in Excel; that's your customer list and your sales history.
2. To get a new developer running on this app, hire someone with these skills: **"Next.js and Supabase developer"** (search those exact words on Upwork or Toptal). Show them this guide and the `DEVELOPER_NOTES.md` file.
3. Worst case: even with no developer at all, you still have years of customer and order data in your saved CSVs. The app is a convenience; the data is the asset.
