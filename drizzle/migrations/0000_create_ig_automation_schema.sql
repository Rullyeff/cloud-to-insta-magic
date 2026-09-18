CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TYPE public.media_kind AS ENUM ('REELS', 'STORIES');
CREATE TYPE public.post_status AS ENUM ('queued', 'copying', 'copied', 'processing', 'published', 'failed', 'cancelled');

-- Instagram accounts discovered from Meta
CREATE TABLE public.ig_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ig_user_id text NOT NULL,
  username text NOT NULL,
  display_name text,
  profile_picture_url text,
  page_id text,
  page_name text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, ig_user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ig_accounts TO authenticated;
GRANT ALL ON public.ig_accounts TO service_role;
ALTER TABLE public.ig_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ig_accounts" ON public.ig_accounts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Watched Google Drive folders
CREATE TABLE public.watched_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  folder_id text NOT NULL,
  folder_name text NOT NULL,
  account_ids uuid[] NOT NULL DEFAULT '{}',
  media_type public.media_kind NOT NULL DEFAULT 'REELS',
  caption_template text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  last_scanned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, folder_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watched_folders TO authenticated;
GRANT ALL ON public.watched_folders TO service_role;
ALTER TABLE public.watched_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own watched_folders" ON public.watched_folders FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Files already picked up from watched folders
CREATE TABLE public.seen_drive_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  folder_id text NOT NULL,
  file_id text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (folder_id, file_id)
);
GRANT SELECT ON public.seen_drive_files TO authenticated;
GRANT ALL ON public.seen_drive_files TO service_role;
ALTER TABLE public.seen_drive_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own seen_drive_files" ON public.seen_drive_files FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Upload queue / history
CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.ig_accounts(id) ON DELETE CASCADE,
  drive_file_id text NOT NULL,
  drive_file_name text NOT NULL,
  drive_file_size bigint,
  media_type public.media_kind NOT NULL DEFAULT 'REELS',
  caption text NOT NULL DEFAULT '',
  scheduled_at timestamptz,
  status public.post_status NOT NULL DEFAULT 'queued',
  storage_path text,
  public_url text,
  ig_container_id text,
  ig_media_id text,
  permalink text,
  error text,
  attempts int NOT NULL DEFAULT 0,
  locked_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX posts_status_idx ON public.posts (status, scheduled_at);
CREATE INDEX posts_user_created_idx ON public.posts (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT ALL ON public.posts TO service_role;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own posts" ON public.posts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER posts_touch BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER ig_accounts_touch BEFORE UPDATE ON public.ig_accounts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Public read for the temporary video bucket (Instagram must fetch the file by URL)
CREATE POLICY "public read videos" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'ig-videos');