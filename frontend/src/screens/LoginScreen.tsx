import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { Icon } from '../components/Icon';
import { useAuth } from '../state/auth';

/** Экран входа: администратор вводит свой ID. */
export function LoginScreen() {
  const { status, notice, login, retry } = useAuth();
  const [id, setId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(id.trim());
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 429
            ? 'Слишком много попыток. Подождите минуту и попробуйте снова.'
            : err.detail
          : 'Не удалось войти. Попробуйте ещё раз.',
      );
      setBusy(false);
    }
  };

  if (status === 'checking') {
    return (
      <div className="login" aria-busy="true">
        <p className="login__wait">Проверка входа…</p>
      </div>
    );
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit} noValidate>
        <div className="login__brand">
          <span className="appnav__logo" aria-hidden>
            <Icon name="layers" />
          </span>
          <span>Флагман</span>
        </div>
        <h1>Вход администратора</h1>
        <p className="login__lead">Введите свой ID, чтобы открыть склад.</p>

        {status === 'offline' ? (
          <div className="login__msg login__msg--error" role="alert">
            Нет связи с сервером.{' '}
            <button type="button" className="login__link" onClick={retry}>
              Повторить
            </button>
          </div>
        ) : (
          (error || notice) && (
            <div className={`login__msg ${error ? 'login__msg--error' : ''}`} role={error ? 'alert' : 'status'}>
              {error ?? notice}
            </div>
          )
        )}

        <label className="field">
          ID администратора
          <input
            className="input"
            type="password"
            value={id}
            onChange={(e) => (setId(e.target.value), setError(null))}
            autoComplete="current-password"
            autoFocus
            spellCheck={false}
            aria-invalid={!!error}
          />
        </label>

        <button className="btn btn--blue" type="submit" disabled={!id.trim() || busy}>
          <Icon name="lock" /> {busy ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
