ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS search_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS tool_runs jsonb NOT NULL DEFAULT '[]'::jsonb;