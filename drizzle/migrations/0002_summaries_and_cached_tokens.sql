ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS cached_tokens integer;

CREATE TABLE public.conversation_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  summary text NOT NULL CHECK (char_length(summary) <= 20000),
  action_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text NOT NULL,
  messages_used integer NOT NULL DEFAULT 0,
  truncated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_summaries_conv_idx ON public.conversation_summaries (conversation_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.conversation_summaries TO authenticated;
GRANT ALL ON public.conversation_summaries TO service_role;
ALTER TABLE public.conversation_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read own summaries" ON public.conversation_summaries
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners create own summaries" ON public.conversation_summaries
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id AND public.has_role(auth.uid(), 'owner')
    AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())
  );
CREATE POLICY "Owners delete own summaries" ON public.conversation_summaries
  FOR DELETE TO authenticated USING (auth.uid() = user_id);