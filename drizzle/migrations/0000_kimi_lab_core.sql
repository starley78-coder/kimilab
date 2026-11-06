-- Roles: the first account to open the app becomes the workspace owner (personal app)
CREATE TYPE public.app_role AS ENUM ('owner');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Grants access to the caller only when no owner exists yet. Returns the caller's access state.
CREATE OR REPLACE FUNCTION public.claim_workspace_access()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF public.has_role(_uid, 'owner') THEN
    RETURN jsonb_build_object('has_access', true, 'role', 'owner');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('kimi_lab_owner_claim'));
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'owner') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'owner');
    RETURN jsonb_build_object('has_access', true, 'role', 'owner', 'claimed', true);
  END IF;
  RETURN jsonb_build_object('has_access', false);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_workspace_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_workspace_access() TO authenticated;

-- Conversations
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  title text NOT NULL DEFAULT 'Новый диалог' CHECK (char_length(title) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_user_updated_idx ON public.conversations (user_id, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own conversations" ON public.conversations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners create own conversations" ON public.conversations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Owners update own conversations" ON public.conversations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners delete own conversations" ON public.conversations
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Messages (text history only; images live in private storage, referenced by path)
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL DEFAULT '' CHECK (char_length(content) <= 400000),
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'complete' CHECK (status IN ('complete', 'stopped')),
  model text,
  reasoning_effort text CHECK (reasoning_effort IS NULL OR reasoning_effort IN ('low', 'high', 'max')),
  finish_reason text,
  prompt_tokens integer,
  completion_tokens integer,
  reasoning_tokens integer,
  total_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_seq_idx ON public.messages (conversation_id, seq);
CREATE INDEX messages_user_idx ON public.messages (user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read own messages" ON public.messages
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owners create messages in own conversations" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id
    AND public.has_role(auth.uid(), 'owner')
    AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())
  );
CREATE POLICY "Owners update own messages" ON public.messages
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners delete own messages" ON public.messages
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Keep conversation ordering fresh when a message arrives
CREATE OR REPLACE FUNCTION public.touch_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER messages_touch_conversation
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_on_message();

-- Server-side rate limit: request log is only reachable through the function below
CREATE TABLE public.request_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_log_user_created_idx ON public.request_log (user_id, created_at DESC);
GRANT ALL ON public.request_log TO service_role;
ALTER TABLE public.request_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_chat_quota()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _per_minute constant int := 10;
  _per_day constant int := 500;
  _minute_count int;
  _oldest timestamptz;
  _day_count int;
  _oldest_day timestamptz;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('chat_quota:' || _uid::text));

  SELECT count(*), min(created_at) INTO _minute_count, _oldest
  FROM public.request_log
  WHERE user_id = _uid AND created_at > now() - interval '1 minute';
  IF _minute_count >= _per_minute THEN
    RETURN jsonb_build_object(
      'allowed', false, 'scope', 'minute', 'limit', _per_minute,
      'retry_after', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_oldest + interval '1 minute' - now())))::int)
    );
  END IF;

  SELECT count(*), min(created_at) INTO _day_count, _oldest_day
  FROM public.request_log
  WHERE user_id = _uid AND created_at > now() - interval '1 day';
  IF _day_count >= _per_day THEN
    RETURN jsonb_build_object(
      'allowed', false, 'scope', 'day', 'limit', _per_day,
      'retry_after', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_oldest_day + interval '1 day' - now())))::int)
    );
  END IF;

  INSERT INTO public.request_log (user_id) VALUES (_uid);
  DELETE FROM public.request_log WHERE user_id = _uid AND created_at < now() - interval '2 days';
  RETURN jsonb_build_object('allowed', true, 'remaining_minute', _per_minute - _minute_count - 1);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_chat_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_chat_quota() TO authenticated;

-- Private image storage: each user can only touch files in their own folder
CREATE POLICY "Chat images: read own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'chat-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Chat images: upload own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-images' AND (storage.foldername(name))[1] = auth.uid()::text AND public.has_role(auth.uid(), 'owner'));
CREATE POLICY "Chat images: delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'chat-images' AND (storage.foldername(name))[1] = auth.uid()::text);
