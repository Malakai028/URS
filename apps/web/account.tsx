import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  marks,
  passwordPair,
  registration,
  validateNewPassword,
} from "../../packages/shared/phase2.ts";
import {
  assessRegistrationPassword,
  passwordMax,
  registrationPasswordChecks,
  type RegistrationCheck,
} from "../../packages/shared/registration-password.ts";
export type Api = (p: string, b?: unknown) => Promise<any>;
export const formData = (form: HTMLFormElement) =>
  Object.fromEntries(new FormData(form)) as Record<string, string>;
export function Password({
  name = "password",
  label = "Пароль",
  strong = false,
  describedBy,
  invalid,
}: {
  name?: string;
  label?: string;
  strong?: boolean;
  describedBy?: string;
  invalid?: boolean;
}) {
  const [show, S] = useState(false),
    [caps, C] = useState(false),
    [v, V] = useState("");
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef<
    [number, number, "forward" | "backward" | "none"] | null
  >(null);
  useLayoutEffect(() => {
    if (selection.current)
      input.current?.setSelectionRange(...selection.current);
    selection.current = null;
  }, [show]);
  return (
    <div className="pw">
      <label htmlFor={id}>{label}</label>
      <div className="pw-field">
        <input
          id={id}
          ref={input}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          type={show ? "text" : "password"}
          name={name}
          value={v}
          onChange={(e) => V(e.target.value)}
          onKeyUp={(e) => C(e.getModifierState("CapsLock"))}
          onBlur={() => C(false)}
          autoComplete={strong ? "new-password" : "current-password"}
          required
        />
        <button
          type="button"
          aria-label={"Показать: " + label}
          aria-pressed={show}
          aria-controls={id}
          onPointerDown={(e) => {
            if (document.activeElement === input.current) e.preventDefault();
          }}
          onClick={() => {
            const el = input.current;
            if (el && el.selectionStart !== null && el.selectionEnd !== null)
              selection.current = [
                el.selectionStart,
                el.selectionEnd,
                el.selectionDirection ?? "none",
              ];
            S(!show);
          }}
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z" />
            <circle cx="12" cy="12" r="2.5" />
            {show && <path d="m3 3 18 18" />}
          </svg>
        </button>
      </div>
      {caps && <small>Включён Caps Lock</small>}
    </div>
  );
}

const strength = [
  "Очень слабый",
  "Слабый",
  "Средний",
  "Сильный",
  "Очень сильный",
];
function RegistrationRequirements({
  id,
  assessment,
  started,
  confirmationTouched,
  identityKnown = true,
}: {
  id: string;
  assessment: ReturnType<typeof assessRegistrationPassword>;
  started: boolean;
  confirmationTouched: boolean;
  identityKnown?: boolean;
}) {
  return (
    <section
      className="password-checks"
      id={id}
      aria-label="Требования к паролю"
    >
      <p>
        Длина {assessment.length}/{passwordMax} ·{" "}
        {assessment.score === null
          ? "Стойкость ещё не оценена"
          : strength[assessment.score]}
      </p>
      {assessment.score !== null && (
        <meter
          min={0}
          max={4}
          value={assessment.score}
          aria-label="Стойкость пароля"
          aria-valuetext={strength[assessment.score]}
        />
      )}
      {assessment.score !== null && assessment.score < 2 && (
        <p>
          Попробуйте несколько несвязанных слов или пароль из менеджера паролей.
        </p>
      )}
      <ul>
        {(Object.keys(registrationPasswordChecks) as RegistrationCheck[]).map(
          (rule) => {
            if (rule === "identity" && !identityKnown)
              return (
                <li key={rule}>
                  ○ Данные аккаунта проверит сервер при сохранении
                </li>
              );
            const value =
              rule === "confirmation"
                ? confirmationTouched && started
                  ? assessment.checks.confirmation
                  : null
                : started
                  ? assessment.checks[rule]
                  : null;
            const pending = value === null || (rule === "min" && !value);
            const status = pending
              ? started && value === null && rule !== "confirmation"
                ? "Ожидает корректного ввода"
                : "Ещё не выполнено"
              : value
                ? "Выполнено"
                : "Не выполнено";
            return (
              <li
                key={rule}
                data-state={pending ? "pending" : value ? "pass" : "fail"}
              >
                <span aria-hidden="true">
                  {pending ? "○" : value ? "✓" : "×"}
                </span>{" "}
                {registrationPasswordChecks[rule][0]} <small>· {status}</small>
              </li>
            );
          },
        )}
      </ul>
    </section>
  );
}
function usePasswordFeedback(name = "", email = "") {
  const [pair, setPair] = useState({ password: "", confirmation: "" });
  const [touched, touch] = useState(false);
  return {
    update(form: Record<string, string>, submitted = false) {
      setPair({
        password: form.password || "",
        confirmation: form.confirmation || "",
      });
      if (form.confirmation || submitted) touch(true);
    },
    clear() {
      setPair({ password: "", confirmation: "" });
      touch(false);
    },
    started: !!pair.password,
    touched,
    assessment: useMemo(
      () =>
        assessRegistrationPassword(
          pair.password,
          pair.confirmation,
          name,
          email,
        ),
      [pair, name, email],
    ),
    mismatch: touched && pair.password !== pair.confirmation,
  };
}

function NewPasswordFields({
  feedback,
  invalidField,
  identityKnown,
}: {
  feedback: ReturnType<typeof usePasswordFeedback>;
  invalidField: string;
  identityKnown: boolean;
}) {
  const id = useId();
  return (
    <>
      <Password strong describedBy={id} invalid={invalidField === "password"} />
      <RegistrationRequirements
        id={id}
        started={feedback.started}
        assessment={feedback.assessment}
        confirmationTouched={feedback.touched}
        identityKnown={identityKnown}
      />
      <Password
        name="confirmation"
        label="Подтверждение пароля"
        strong
        invalid={feedback.mismatch || invalidField === "confirmation"}
        describedBy={id + "-match"}
      />
      <p id={id + "-match"} className="password-match" aria-live="polite">
        {feedback.mismatch
          ? "Пароли не совпадают"
          : feedback.touched && feedback.started
            ? "Пароли совпадают"
            : ""}
      </p>
    </>
  );
}

function passwordIssue(form: Record<string, string>, name = "", email = "") {
  const pair = passwordPair.safeParse({
    password: form.password,
    confirmation: form.confirmation,
  });
  return pair.success
    ? validateNewPassword(pair.data, name, email)[0]
    : pair.error.issues[0];
}

function authError(error: unknown) {
  const failure = error as Error & { status?: number; retryAfter?: number };
  if (failure.status === 429 && failure.retryAfter && failure.retryAfter > 0)
    return (
      "Слишком много запросов. Повторите через " + failure.retryAfter + " сек."
    );
  return failure.status && failure.status < 500
    ? failure.message
    : "Не удалось завершить запрос. Проверьте соединение и попробуйте снова.";
}

function focusField(form: HTMLFormElement, field: string) {
  const control = form.elements.namedItem(field);
  if (control instanceof HTMLElement) control.focus();
}

function removeAccountLink() {
  history.replaceState(null, "", location.pathname + location.search);
}

export function Access({
  api,
  login,
  initialMessage = "",
}: {
  api: Api;
  login: (u: any) => void;
  initialMessage?: string;
}) {
  const [mode, M] = useState("login"),
    [error, E] = useState(initialMessage),
    [busy, B] = useState(false),
    [mail, A] = useState<boolean | null>(null);
  const [link, setLink] = useState(() => {
    const v = new URLSearchParams(location.hash.slice(1));
    for (const purpose of ["reset", "verify"])
      if (v.has(purpose)) return { purpose, code: v.get(purpose)! };
    return null;
  });
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (link) {
      removeAccountLink();
      M(link.purpose);
      heading.current?.focus();
    }
  }, [link]);
  useEffect(() => {
    api("recovery")
      .then((r) => A(r.enabled))
      .catch(() => A(false));
  }, [api]);
  const registering = mode === "register";
  const editingPassword = registering || mode === "reset";
  const submitting = useRef(false);
  const [identity, setIdentity] = useState({ name: "", email: "" });
  const feedback = usePasswordFeedback(identity.name, identity.email);
  const [invalidField, setInvalidField] = useState("");
  function switchMode(next: string, message = "") {
    E(message);
    setInvalidField("");
    setIdentity({ name: "", email: "" });
    feedback.clear();
    if (link) setLink(null);
    M(next);
    heading.current?.focus();
  }
  return (
    <section className="login card">
      <small>Личный кабинет</small>
      <h2 ref={heading} tabIndex={-1}>
        {
          {
            login: "Вход в атлас",
            register: "Новый аккаунт",
            recover: "Восстановление",
            reset: "Новый пароль",
            verify: "Подтвердить почту",
          }[mode]
        }
      </h2>
      <form
        key={mode}
        noValidate={editingPassword}
        aria-busy={busy}
        onChange={(e) => {
          if (!editingPassword) return;
          const f = formData(e.currentTarget);
          if (registering)
            setIdentity({ name: f.name || "", email: f.email || "" });
          feedback.update(f);
          if (error) E("");
          if (invalidField) setInvalidField("");
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current) return;
          const f = formData(e.currentTarget);
          if (editingPassword) {
            const valid = registering
              ? registration.safeParse({
                  ...f,
                  accepted: !!f.accepted,
                })
              : null;
            const issue = valid
              ? valid.success
                ? undefined
                : valid.error.issues[0]
              : passwordIssue(f);
            if (registering)
              setIdentity({ name: f.name || "", email: f.email || "" });
            feedback.update(f, true);
            if (issue) {
              const field = String(issue.path[0] || "");
              setInvalidField(field);
              E(issue.message);
              focusField(e.currentTarget, field);
              return;
            }
          }
          submitting.current = true;
          B(true);
          E("");
          try {
            if (mode === "recover") {
              await api("recovery", { email: f.email });
              E(
                "Запрос принят. Если восстановление доступно для этого адреса, проверьте входящие письма.",
              );
            } else if (mode === "verify" || mode === "reset") {
              await api("account/link", { ...link, ...f });
              switchMode(
                "login",
                mode === "reset"
                  ? "Пароль изменён. Прежние сеансы завершены. Войдите с новым паролем."
                  : "Адрес подтверждён. Войдите в аккаунт.",
              );
            } else {
              const payload = registering
                ? { ...f, accepted: !!f.accepted }
                : f;
              login(await api("auth/" + mode, payload));
            }
          } catch (e) {
            E(authError(e));
          } finally {
            submitting.current = false;
            B(false);
          }
        }}
      >
        {["login", "register"].includes(mode) && (
          <label>
            Имя игрока
            <input
              name="name"
              aria-invalid={invalidField === "name" || undefined}
              minLength={3}
              maxLength={32}
              required
              autoComplete="username"
            />
          </label>
        )}
        {registering && (
          <>
            <label>
              Отображаемое имя
              <input
                name="display"
                aria-invalid={invalidField === "display" || undefined}
                required
                minLength={2}
                maxLength={40}
              />
            </label>
            <Avatar />
          </>
        )}
        {(registering || mode === "recover") && (
          <label>
            Электронная почта
            <input
              name="email"
              type="email"
              aria-invalid={invalidField === "email" || undefined}
              required
              maxLength={254}
              autoComplete="email"
            />
          </label>
        )}
        {mode === "login" && <Password />}
        {editingPassword && (
          <NewPasswordFields
            feedback={feedback}
            invalidField={invalidField}
            identityKnown={registering}
          />
        )}
        {registering && (
          <>
            <details>
              <summary>Условия экспедиции и приватность</summary>
              <p>
                Аккаунт хранит сессии, email для восстановления и игровые
                сохранения. Участники мира видят сообщения общего чата и видимых
                персонажей. Публичный профиль включается в настройках.
              </p>
            </details>
            <label className="inline">
              <input type="checkbox" name="accepted" required />
              Принимаю условия экспедиции
            </label>
          </>
        )}
        <button className="primary" disabled={busy}>
          {busy
            ? "Отправка…"
            : registering
              ? "Создать аккаунт →"
              : mode === "login"
                ? "Войти →"
                : mode === "recover"
                  ? "Отправить письмо"
                  : "Подтвердить"}
        </button>
      </form>
      {error && <p role="status">{error}</p>}
      <button
        className="link"
        disabled={busy}
        onClick={() => switchMode(mode === "login" ? "register" : "login")}
      >
        {registering
          ? "Уже есть аккаунт? Войти"
          : mode === "login"
            ? "Зарегистрироваться"
            : "Вернуться ко входу"}
      </button>
      {mail && ["login", "reset"].includes(mode) && (
        <button
          className="link"
          disabled={busy}
          onClick={() => switchMode("recover")}
        >
          Забыли пароль?
        </button>
      )}
      {mail === false && mode === "login" && (
        <p>Восстановление по почте недоступно.</p>
      )}
    </section>
  );
}
export function Avatar({ value = "leaf" }: { value?: string }) {
  return (
    <label>
      Аватар
      <select name="avatar" defaultValue={value}>
        {Object.entries(marks).map(([id, v]) => (
          <option key={id} value={id}>
            {v} ·{" "}
            {
              { leaf: "Лист", moon: "Луна", flame: "Пламя", peak: "Вершина" }[
                id
              ]
            }
          </option>
        ))}
      </select>
    </label>
  );
}
export function Profile({
  api,
  logout,
  saved,
}: {
  api: Api;
  logout: (message: string) => void;
  saved: (profile: { display: string; avatar: string }) => void;
}) {
  const [v, V] = useState<any>(),
    [msg, M] = useState(""),
    [busy, B] = useState(false);
  const submitting = useRef(false);
  const feedback = usePasswordFeedback(v?.name, v?.email || "");
  const [invalidField, setInvalidField] = useState("");
  const [passwordVersion, bumpPasswordVersion] = useState(0);
  const changedPassword = useRef<HTMLElement>(null);
  const submit = async (fn: () => Promise<void>) => {
    if (submitting.current) return;
    submitting.current = true;
    B(true);
    M("");
    try {
      await fn();
    } catch (e) {
      M(authError(e));
    } finally {
      submitting.current = false;
      B(false);
    }
  };
  useEffect(() => {
    api("profile")
      .then(V)
      .catch((e) => M(e.message));
  }, [api]);
  if (!v) return <p>{msg || "Открываем профиль…"}</p>;
  return (
    <fieldset className="interaction" disabled={busy}>
      <h2>
        {marks[v.avatar as keyof typeof marks]} {v.display}
      </h2>
      <p>
        {v.name} · {v.email || "Адрес не указан"} {v.verified ? "✓" : ""}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = formData(e.currentTarget);
          await submit(async () => {
            await api("profile", { ...f, publicProfile: !!f.publicProfile });
            const next = await api("profile");
            V(next);
            saved(next);
            M("Профиль сохранён");
          });
        }}
      >
        <label>
          Отображаемое имя
          <input
            name="display"
            defaultValue={v.display}
            minLength={2}
            required
          />
        </label>
        <Avatar value={v.avatar} />
        <label>
          О себе
          <textarea name="bio" defaultValue={v.bio} maxLength={360} />
        </label>
        <label className="inline">
          <input
            type="checkbox"
            name="publicProfile"
            defaultChecked={!!v.public_profile}
          />
          Публичный профиль
        </label>
        <button>Сохранить профиль</button>
      </form>
      {v.mail && !v.verified && (
        <button
          onClick={() =>
            submit(async () => {
              await api("profile/verify", {});
              M("Почтовый шлюз принял запрос. Проверьте входящие письма.");
            })
          }
        >
          Подтвердить email
        </button>
      )}
      <details>
        <summary ref={changedPassword}>Изменить пароль</summary>
        <form
          key={passwordVersion}
          onChange={(e) => {
            feedback.update(formData(e.currentTarget));
            if (!submitting.current) M("");
            setInvalidField("");
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = formData(form);
            feedback.update(data, true);
            const issue = passwordIssue(data, v.name, v.email || "");
            if (issue) {
              const field = String(issue.path[0] || "");
              setInvalidField(field);
              M(issue.message);
              focusField(form, field);
              return;
            }
            await submit(async () => {
              await api("profile/password", data);
              feedback.clear();
              bumpPasswordVersion((value) => value + 1);
              M(
                "Пароль изменён. Другие сеансы завершены, текущий сеанс обновлён.",
              );
              changedPassword.current?.focus();
            });
          }}
        >
          <Password name="old" label="Текущий пароль" />
          <NewPasswordFields
            feedback={feedback}
            invalidField={invalidField}
            identityKnown
          />
          <button>Сменить пароль</button>
        </form>
      </details>
      <details>
        <summary>Выйти со всех устройств</summary>
        <p>Будут завершены все сеансы аккаунта, включая этот.</p>
        <button
          type="button"
          onClick={() =>
            submit(async () => {
              await api("logout/all", {});
              logout("Вы вышли со всех устройств.");
            })
          }
        >
          Завершить все сеансы
        </button>
      </details>
      <p role="status">{busy ? "Сохранение…" : msg}</p>
    </fieldset>
  );
}
