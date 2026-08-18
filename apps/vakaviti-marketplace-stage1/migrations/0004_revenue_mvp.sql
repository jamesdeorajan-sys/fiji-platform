ALTER TABLE operators ADD COLUMN image_url TEXT;
ALTER TABLE products ADD COLUMN image_url TEXT;

CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  product_id TEXT,
  channel TEXT NOT NULL DEFAULT 'WHATSAPP',
  source_page TEXT,
  referrer TEXT,
  status TEXT NOT NULL DEFAULT 'SENT',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operator_id) REFERENCES operators(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_enquiries_operator ON enquiries(operator_id, created_at);
CREATE INDEX IF NOT EXISTS idx_enquiries_product ON enquiries(product_id, created_at);
