-- Lock down data: only logged-in users can read/write.
-- Run this in Supabase SQL Editor after enabling Auth and creating your admin user.

drop policy if exists "Allow all on customers" on customers;
drop policy if exists "Allow all on daily_entries" on daily_entries;
drop policy if exists "Allow all on milk_production" on milk_production;
drop policy if exists "Allow all on bills" on bills;
drop policy if exists "Allow all on payments" on payments;
drop policy if exists "Allow all on expenses" on expenses;
drop policy if exists "Allow all on reminders" on reminders;

create policy "Auth users on customers" on customers
  for all to authenticated using (true) with check (true);

create policy "Auth users on daily_entries" on daily_entries
  for all to authenticated using (true) with check (true);

create policy "Auth users on milk_production" on milk_production
  for all to authenticated using (true) with check (true);

create policy "Auth users on bills" on bills
  for all to authenticated using (true) with check (true);

create policy "Auth users on payments" on payments
  for all to authenticated using (true) with check (true);

create policy "Auth users on expenses" on expenses
  for all to authenticated using (true) with check (true);

create policy "Auth users on reminders" on reminders
  for all to authenticated using (true) with check (true);
