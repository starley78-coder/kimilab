ALTER TABLE public.conversations
  ADD COLUMN system_prompt text CHECK (system_prompt IS NULL OR char_length(system_prompt) <= 20000),
  ADD COLUMN is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN is_archived boolean NOT NULL DEFAULT false;
CREATE INDEX conversations_user_flags_idx
  ON public.conversations (user_id, is_archived, is_pinned DESC, updated_at DESC);

CREATE TABLE public.user_settings (
  user_id uuid PRIMARY KEY DEFAULT auth.uid(),
  default_system_prompt text NOT NULL DEFAULT '' CHECK (char_length(default_system_prompt) <= 20000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own settings" ON public.user_settings
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners create own settings" ON public.user_settings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Owners update own settings" ON public.user_settings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners delete own settings" ON public.user_settings
  FOR DELETE TO authenticated USING (auth.uid() = user_id);