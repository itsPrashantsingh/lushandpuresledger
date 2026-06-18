-- GST fields + customer GSTIN

alter table customers add column if not exists gstin text;

alter table bills add column if not exists subtotal numeric;
alter table bills add column if not exists cgst numeric default 0;
alter table bills add column if not exists sgst numeric default 0;
alter table bills add column if not exists igst numeric default 0;
alter table bills add column if not exists gst_rate numeric default 0;

-- Backfill subtotal for existing bills
update bills set subtotal = total_amount where subtotal is null;
