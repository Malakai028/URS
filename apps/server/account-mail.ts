type Mail = { to: string; subject: string; text: string };

export type AccountMail = {
  origin: string;
  deliver: (mail: Mail) => Promise<void>;
};

function httpsUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

export function configuredAccountMail(): AccountMail | undefined {
  const gateway = httpsUrl(process.env.ACCOUNT_MAIL_URL);
  const origin = httpsUrl(process.env.PUBLIC_ORIGIN);
  const key = process.env.ACCOUNT_MAIL_KEY;
  if (!gateway || !origin || !key) return;
  return {
    origin: origin.origin,
    async deliver(mail) {
      const response = await fetch(gateway, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + key,
        },
        body: JSON.stringify(mail),
      });
      if (!response.ok) throw Error("Mail gateway rejected the request");
      await response.body?.cancel();
    },
  };
}
