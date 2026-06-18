-- Prevent duplicate bills per customer per month
-- (PostgreSQL does not support ADD CONSTRAINT IF NOT EXISTS — use DO block)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bills_customer_period_unique'
  ) THEN
    ALTER TABLE bills
      ADD CONSTRAINT bills_customer_period_unique
      UNIQUE (customer_id, period_start, period_end);
  END IF;
END $$;

-- Prevent duplicate Razorpay payment records
CREATE UNIQUE INDEX IF NOT EXISTS payments_razorpay_id_unique
  ON payments (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;
