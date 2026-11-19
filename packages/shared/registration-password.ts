import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import { adjacencyGraphs, dictionary } from "@zxcvbn-ts/language-common";

export const registrationPasswordMin = 15;
export const passwordMax = 128;
export const passwordLength = (value: string) => Array.from(value).length;

const commonPasswords = new Set(dictionary["passwords-common"]);
const estimator = new ZxcvbnFactory({
  dictionary,
  graphs: adjacencyGraphs,
  maxLength: passwordMax * 2,
});

export const registrationPasswordChecks = {
  min: ["Не менее 15 символов", "Пароль должен содержать не менее 15 символов"],
  max: [
    "Не более 128 символов",
    "Пароль должен содержать не более 128 символов",
  ],
  format: [
    "Корректный Unicode, без переводов строки",
    "Введите корректный пароль без переводов строки",
  ],
  predictable: [
    "Без очевидных повторов и последовательностей",
    "Замените предсказуемый пароль фразой из нескольких несвязанных слов",
  ],
  identity: [
    "Без легко угадываемых вариантов имени или почты",
    "Выберите пароль, который сложнее угадать по имени игрока или адресу почты",
  ],
  common: [
    "Пароль отсутствует в локальном списке распространённых",
    "Этот пароль есть в списке распространённых паролей. Выберите другой",
  ],
  confirmation: ["Пароли совпадают", "Пароли не совпадают"],
} as const;

export type RegistrationCheck = keyof typeof registrationPasswordChecks;
export function assessRegistrationPassword(
  password: string,
  confirmation: string,
  name: string,
  email: string,
) {
  const length = passwordLength(password);
  const min = length >= registrationPasswordMin,
    max = length <= passwordMax;
  const format = !/[\r\n\uD800-\uDFFF]/u.test(password);
  const accountTerms = [name, email.split("@")[0]]
    .map((value) => value.trim().normalize("NFC").toLowerCase())
    .filter((value) => passwordLength(value) >= 3);
  const candidate = max && format && password ? password.normalize("NFC") : "";
  const result = candidate ? estimator.check(candidate, accountTerms) : null;
  const weak = result !== null && result.score <= 1;
  const folded = candidate.toLowerCase();
  return {
    score: result?.score ?? null,
    length,
    checks: {
      min,
      max,
      format,
      predictable: result
        ? !(
            weak &&
            result.sequence.some(
              (match) =>
                ["repeat", "sequence", "spatial"].includes(match.pattern) ||
                (match.pattern === "dictionary" &&
                  match.dictionaryName === "passwords-common"),
            )
          )
        : null,
      identity: result
        ? !(weak && accountTerms.some((term) => folded.includes(term)))
        : null,
      common: result ? !commonPasswords.has(folded) : null,
      confirmation: confirmation === password,
    } satisfies Record<RegistrationCheck, boolean | null>,
  };
}
