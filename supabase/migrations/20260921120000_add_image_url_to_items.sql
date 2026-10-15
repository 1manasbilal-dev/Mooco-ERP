-- Add image_url column to items table for product photos
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS image_url text;
