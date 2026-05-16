-- Repoint point_events.src_tx from legacy buys -> trades, drop legacy table.
ALTER TABLE point_events DROP CONSTRAINT IF EXISTS point_events_src_tx_fkey;
ALTER TABLE point_events
  ADD CONSTRAINT point_events_src_tx_fkey
  FOREIGN KEY (src_tx) REFERENCES trades(tx_sig);

DROP TABLE IF EXISTS buys;
