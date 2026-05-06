-- ============================================================
-- Cara a Cara - Database Setup
-- Cole e execute no Supabase SQL Editor
-- ============================================================

-- Perfis de usuário
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Tabuleiros
CREATE TABLE IF NOT EXISTS public.boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "boards_select" ON public.boards FOR SELECT USING (true);
CREATE POLICY "boards_insert" ON public.boards FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "boards_update" ON public.boards FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "boards_delete" ON public.boards FOR DELETE USING (auth.uid() = user_id);

-- Personagens do tabuleiro
CREATE TABLE IF NOT EXISTS public.characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  photo_url TEXT,
  position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 24),
  UNIQUE (board_id, position)
);
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "characters_select" ON public.characters FOR SELECT USING (true);
CREATE POLICY "characters_manage" ON public.characters FOR ALL USING (
  EXISTS (SELECT 1 FROM public.boards WHERE boards.id = characters.board_id AND boards.user_id = auth.uid())
);

-- Partidas
CREATE TABLE IF NOT EXISTS public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES public.boards(id),
  player1_id UUID NOT NULL REFERENCES auth.users(id),
  player2_id UUID REFERENCES auth.users(id),
  player1_name TEXT NOT NULL,
  player2_name TEXT,
  player1_character SMALLINT,
  player2_character SMALLINT,
  player1_ready BOOLEAN NOT NULL DEFAULT FALSE,
  player2_ready BOOLEAN NOT NULL DEFAULT FALSE,
  current_turn SMALLINT NOT NULL DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'online' CHECK (mode IN ('online', 'local')),
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'selecting', 'selecting_p2', 'playing', 'finished')),
  winner SMALLINT CHECK (winner IN (1, 2)),
  pending_question TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
CREATE POLICY "games_select" ON public.games FOR SELECT USING (true);
CREATE POLICY "games_insert" ON public.games FOR INSERT WITH CHECK (auth.uid() = player1_id);
CREATE POLICY "games_update" ON public.games FOR UPDATE USING (
  auth.uid() = player1_id OR auth.uid() = player2_id
);

-- Eventos da partida (log de perguntas, respostas, palpites)
CREATE TABLE IF NOT EXISTS public.game_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  player_num SMALLINT NOT NULL CHECK (player_num IN (1, 2)),
  player_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('question', 'answer', 'guess', 'pass_turn')),
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.game_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events_select" ON public.game_events FOR SELECT USING (true);
CREATE POLICY "events_insert" ON public.game_events FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.games
    WHERE games.id = game_events.game_id
      AND (games.player1_id = auth.uid() OR games.player2_id = auth.uid())
  )
);

-- Ativar Realtime nas tabelas necessárias
ALTER PUBLICATION supabase_realtime ADD TABLE public.games;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_events;

-- ============================================================
-- STORAGE: Crie o bucket manualmente no Supabase Dashboard
-- Storage > New bucket > Nome: "character-photos" > Public: ON
-- ============================================================

-- Políticas de acesso ao bucket (rode APÓS criar o bucket)
CREATE POLICY "storage_select_public"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'character-photos');

CREATE POLICY "storage_insert_auth"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'character-photos');

CREATE POLICY "storage_update_auth"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'character-photos');

CREATE POLICY "storage_delete_auth"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'character-photos');
