-- Add source_preset column to track which preset a connection was created from
ALTER TABLE connections ADD COLUMN source_preset TEXT;
