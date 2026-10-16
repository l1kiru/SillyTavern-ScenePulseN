# Аудит модельных пресетов и возможностей

Дата: 2026-10-15. Объём: 39 bundled presets, matcher/applier, OpenRouter connector,
ST API inventory, обычные и параллельные extraction requests. Это аудит кода и
выборочная сверка документации, не сертификация всех 39 моделей или их провайдеров.
Реальные LLM не вызывались, пользовательские настройки не изменялись.

## Устройство и фактический контракт

- `built-in.js`: 39 шаблонов подсказок, ролей, справочных размеров контекста и
  sampler hints. 18 шаблонов содержат специальные ChatML/Mistral/Llama/Gemma/Alpaca
  delimiters. Их пригодность зависит от серверного chat template и instruct mode.
- `registry.js`: подбор и применение только promptOverrides/systemPromptRole.
  Ни Native JSON, ни reasoning effort, ни sampler values при применении не меняются.
- `st-capabilities.js`: возможности API клиента ST, не свойства модели.
- `or-connector.js`: opt-in обновление pricing/contextLength, TTL 24 часа.
  supported_parameters и max_completion_tokens не сохраняются. Модельного capability
  registry с привязкой к endpoint в текущем проекте нет.
- Native включается пользователем; schema передаётся ST. Результат валидируется.
  Наличие generateRawData/ConnectionManagerRequestService не доказывает поддержку
  structured output конкретным провайдером.

## Исправлено в текущем шаге

1. Выбор модели игнорировал mainApi: сохранённый Chat Completion мог побеждать
   активный text completion. Неизвестный source брал первый чужой *_model, а DOM
   fallback просматривал скрытые селекторы. Теперь приоритет у публичного
   getChatCompletionModel для CC, затем только у текущего source; неоднозначные
   старые контексты возвращают пустую строку. mainApi/getChatCompletionModel
   подтверждены в st-context.js обоих локальных ST (1.18/1.19).
2. Matcher объявлял longest match, но break пропускал более длинные patterns того
   же пресета. Теперь сравнивает все patterns. Равные совпадения сохраняют порядок.
3. DeepSeek V4: удалено устаревшее утверждение, что top_p всегда игнорируется
   в thinking; для Flash убран универсальный numeric sampler рецепт.
4. Claude 4.7: устранена противоречивая подсказка «IGNORES / HTTP 400», убраны
   неподтверждённые tracker-specific effort рекомендации, ссылка на переехавшую
   страницу заменена на документацию deprecations. Превосходство user-role
   больше не заявляется как доказанный факт. Сами роли/сохранённые профили не менялись.

## Решение пользователя

Реестр возможностей моделей/endpoint не нужен и исключён из дальнейшей работы.
Не добавлять discovery возможностей, диагностические предупреждения о совместимости
модели или автоматическую подстройку Native, reasoning и бюджетов по данным провайдера.
Пользователь самостоятельно выбирает настройки по уже отображаемому необходимому
бюджету токенов расширения. Существующий расчёт/отображение бюджета сохраняется.

## Результаты проверки Native, reasoning и бюджета

| Область | Найдено | Решение / дальнейшая проверка |
| --- | --- | --- |
| Native support | Сейчас нет endpoint-aware данных; JSON mode и schema enforcement нельзя считать одним свойством | Режим выбирает пользователь; реестр и новая диагностика не планируются |
| Бюджет обычного запроса | Full 16384; delta/section минимум 8192, максимум 16384; estimate по длине JSON | Сохранить расчёт и отображение потребности в токенах; лимиты выбирает пользователь |
| Reasoning | Настройки приходят из ST/Connection Profile; отдельного резерва reasoning нет | Настройки выбирает пользователь; автоматический резерв не добавлять |
| Parallel | Базовые lane budgets 2048/4096/6144/8192; capability-aware ограничений нет | Сохранить текущие бюджеты и их отображение без provider-aware ограничений |
| Context hints | Поля карточек справочные; не являются ограничителем запроса | Не использовать contextWindow как max_output; учитывать вход и reasoning |
| Local finetunes | 18 шаблонов вставляют специальные токены внутрь инструкции | Проверить с реальными instruct templates; не удалять шаблоны массово без сравнения |
| Matching | Некоторые patterns широкие: sao10k, steelskull, grok-4, deepseek-v4 | В дальнейшем привязать проверенные aliases к моделям; не приписывать способности всему семейству |
| OR stats | getOrStats допускает обратное substring-сопоставление | Оставить статистику справочной; не использовать её для выбора транспорта или лимитов |

Эти пункты — результаты аудита; предложение capability registry отклонено пользователем. Новые модели,
автоматические sampler values и миграция пользовательских профилей не добавлялись.
Полнота/актуальность всех маркетинговых описаний, context windows и советов 39 моделей
не подтверждена; они не должны становиться источником исполняемых ограничений.

## Первичные источники

- [OpenRouter Models](https://openrouter.ai/docs/guides/overview/models):
  supported_parameters различает reasoning, structured_outputs и response_format;
  top_provider.max_completion_tokens — потолок ответа, context_length — общий
  контекст. Метаданные каталога не подтверждают поведение конкретного ответа.
- [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs):
  JSON schema требует поддержки моделью/провайдером.
- [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/):
  direct API игнорирует temperature и frequency/presence penalties в thinking;
  top_p работает в thinking в диапазоне 0.95–1.0, вне thinking фиксирован на 1.0.
- [Claude deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations):
  для 4.7 и новее non-default temperature/top_p/top_k дают 400. Это ограничение
  direct API, не проверка каждого посредника и не benchmark tracker effort.
- [Gemini 2.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite):
  input/output limits и thinking/structured outputs указаны раздельно. Нельзя
  выводить output budget из одного справочного размера контекста карточки.

## Проверки

Новый preset-selection test сначала воспроизвёл выбор stale GPT вместо local model.
Покрывает public resolver, source fallback, неизвестный source, отсутствующий ID,
другой mainApi, исключение resolver, ambiguous legacy context, longest pattern и
отсутствие sampler/Native writes в preset patch. Все 95 bundled matchPatterns
проверены на возврат собственного пресета. Старые preset tests сохранены.


## Итог ревью

Независимое fresh-context review: actionable findings нет, Signal Medium.
Reviewer повторил новый selection test и 738 assertions существующего registry test,
проверил публичные функции обоих локальных ST и официальные sampler docs.
Полный набор: 128/128 source files, 105/105 test files. После добавления проверки всех
95 aliases целевой тест прошёл повторно; git diff --check без ошибок.
Ограничения: реальный UI selector и LLM не проверены, все 39 карточек не сертифицированы.
