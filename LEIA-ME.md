# Cara a Cara — Instruções de Configuração

## 1. Banco de Dados (Supabase SQL Editor)

Acesse: https://mccnhiphlvzezkztpexr.supabase.co → SQL Editor → Cole e execute **setup.sql**.

## 2. Storage (Supabase Dashboard)

Storage → **New bucket** → Nome: `character-photos` → marque **Public** → Criar.

Adicione as políticas de storage:
- Vá em Storage → Policies → `character-photos`
- Adicione política "INSERT" para usuários autenticados:
  ```
  (auth.role() = 'authenticated')
  ```

## 3. Realtime (Supabase Dashboard)

Database → Replication → Verifique se `games` e `game_events` estão na publicação `supabase_realtime`.
(O setup.sql já faz isso, mas confirme na interface.)

## 4. Rodar o Projeto

Como são arquivos HTML/CSS/JS puro, use qualquer servidor local:

**Opção A — VS Code:**
Instale a extensão "Live Server" → clique com botão direito em `index.html` → "Open with Live Server"

**Opção B — Python:**
```bash
cd CaraCara
python -m http.server 8080
# Acesse: http://localhost:8080
```

**Opção C — Node.js:**
```bash
npx serve .
```

## 5. Fluxo de Uso

1. Acesse `index.html` → Crie sua conta
2. Crie um tabuleiro (`editor.html`) com os personagens e fotos
3. No painel, escolha o tabuleiro e o modo de jogo
4. **Online:** Compartilhe o link gerado com seu oponente
5. **Local:** Os dois jogadores usam o mesmo dispositivo
6. A partida começa quando ambos escolhem seus personagens secretos

## Modos de Jogo

- **Online:** Perguntas via lista predefinida (seleciona e envia para o oponente responder)
- **Local:** Joguem na vida real — use o tabuleiro só para eliminar personagens e clique "Próximo Turno"
