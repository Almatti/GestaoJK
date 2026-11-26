# Design System — Tangerine Rush

Tokens centralizados em `src/styles/index.css` (`@theme` do Tailwind v4). Mudar um token altera todas as telas.

## Cores
| Token | Hex | Uso |
|---|---|---|
| `tangerine-800` | #D64101 | Laranja profundo — gradiente de ações primárias, foco |
| `tangerine-700` | #FC6500 | Laranja vibrante — destaque, contorno de foco |
| `tangerine-500` | #FF8F2E | Intermediário — gráficos |
| `tangerine-400` | #FFA95E | Suave — gráficos/realces |
| `tangerine-200` | #FFCC97 | Pêssego — bordas, grades de gráfico |
| `tangerine-900` | #A63900 | Texto de destaque com alto contraste |
| `cream-200` / `cream-100` | #FDEADD / #FFF7F0 | Fundos quentes |
| `cocoa-900` / `cocoa-700` | #69351F / #92543A | Texto principal / secundário |
| `success/warning/danger/info-50/700` | — | Estados semânticos (sempre com texto + ícone) |

Contraste: texto `cocoa-900` sobre `cream-100` ≈ 10:1; `cocoa-700` ≈ 6:1; branco sobre `tangerine-800` ≈ 4.6:1 (botões usam fonte ≥ 15 px e peso 500).

## Tipografia
Manrope (títulos, indicadores — `font-display`) e Inter (texto, formulários, tabelas — `font-sans`), auto-hospedadas via `@fontsource` (funcionam offline). Valores financeiros com `num` (`font-variant-numeric: tabular-nums`).

## Superfícies
- `glass`: vidro fosco (cards de destaque, menus, dashboard).
- `surface`: branco opaco — **formulários, tabelas financeiras e informações críticas**.
- `card` (24 px) e `card-sm` (16 px). Sombras `--shadow-soft`, `--shadow-lift`, `--shadow-glow`.
- Microinterações 150–250 ms com `--ease-soft`; respeita `prefers-reduced-motion`.

## Componentes (`src/components/ui`)
`Button` (primary/secondary/soft/ghost/danger; sm/md/lg/icon; loading), `Badge` (tom + ícone + texto), `Alert`, `EmptyState`, `Skeleton`/`LoadingBlock`, `ErrorState` + `friendlyError` (mensagens compreensíveis), `Modal` (diálogo/gaveta, bloqueio de perda de dados), `ConfirmDialog`, `Toast`, `PageHeader` (breadcrumbs), `Card`, `Stat` (KPI clicável), `Tabs`, `KeyValue`, `TextInput`/`SelectInput`/`TextArea`/`Checkbox` (rótulo, dica, erro com `aria-describedby`), `Attachments`.

## Layout
Menu lateral agrupado e recolhível (desktop/tablet), gaveta + navegação inferior com botão central "Novo pedido" (celular), barra superior com busca global (Ctrl+K), criação rápida, notificações e usuário. Faixas de aviso: ambiente de demonstração e offline.

## Acessibilidade (objetivo WCAG 2.2 AA)
Link "pular para o conteúdo", foco visível de 3 px, rótulos em todos os campos, `aria-invalid`/`role="alert"` em erros, `aria-sort` em tabelas, `aria-pressed` em alternâncias, estados nunca só por cor, áreas de toque ≥ 36–44 px, `lang="pt-BR"`.
