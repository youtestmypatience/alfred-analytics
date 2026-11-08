# OAuth без собственного домена — Alfred Analytics Data Vault

## Сайт
- Сайт: https://youtestmypatience.github.io/alfred-analytics/data-vault/
- Supabase: https://supabase.com/dashboard/project/njrdzjzhqcxbsvldwrkp
- Прогресс сохраняется в localStorage (гость) или в Supabase под авторизованным user_id.
- Страница проверяет публичные настройки Supabase по `/auth/v1/settings`. Пока провайдер не активен, кнопка заблокирована.
- Секреты OAuth ни в GitHub, ни в браузерный код добавлять нельзя.

## Включение GitHub OAuth

1. Откройте https://github.com/settings/developers → OAuth Apps → New OAuth App.
2. Application name: `Alfred Analytics Data Vault`.
3. Homepage URL: `https://youtestmypatience.github.io/alfred-analytics/data-vault/`.
4. Authorization callback URL: `https://njrdzjzhqcxbsvldwrkp.supabase.co/auth/v1/callback`.
5. Создайте OAuth App и сгенерируйте Client Secret.
6. Введите Client ID и Client Secret на https://supabase.com/dashboard/project/njrdzjzhqcxbsvldwrkp/auth/providers → GitHub → Enabled → Save.
7. Обновите сайт и проверьте, что кнопка GitHub активировалась.

Документация: https://supabase.com/docs/guides/auth/social-sign-in/auth-github

## Включение Google OAuth

1. Создайте Google Cloud проект: https://console.cloud.google.com/auth/overview
2. Настройте Google Auth Platform → Branding, Audience и нужные scopes (`openid`, email, profile). Для публичного запуска проверьте публикацию приложения из Testing.
3. Clients → Create Client → Web application.
4. Authorized JavaScript origins: `https://youtestmypatience.github.io`.
5. Authorized redirect URIs: `https://njrdzjzhqcxbsvldwrkp.supabase.co/auth/v1/callback`.
6. Добавьте Client ID и Client Secret в https://supabase.com/dashboard/project/njrdzjzhqcxbsvldwrkp/auth/providers → Google → Enabled → Save.
7. Обновите сайт; активируется Google-кнопка.

Документация: https://supabase.com/docs/guides/auth/social-sign-in/auth-google

## Проверка синхронизации

1. Поставьте отметку в гостевом режиме и перезагрузите страницу.
2. Войдите через активированный OAuth-провайдер.
3. Согласитесь на перенос гостевого прогресса.
4. Проверьте запись в `public.study_topic_progress` в Supabase.
5. Войдите в тот же аккаунт с другого устройства: отметка должна появиться.
6. Выйдите: гостевой прогресс не должен исчезнуть.

Тесты реального OAuth, переноса и синхронизации требуют активного OAuth-провайдера. GitHub Pages и публичный ключ Supabase достаточны для фронтенда. SMTP и собственный домен не нужны при входе через социальную учётную запись.
